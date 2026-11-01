import { beforeEach, expect, it } from 'vitest'
import { setup, command } from './checkoutTestFixtures'
import { apiTestClient } from './apiTestClient'
import { runMigrations } from '../../server/migrations'
import type { CheckoutResult } from '../domain/checkout'
import type { CheckoutRefundResult } from '../domain/checkoutRefund'

let context: Awaited<ReturnType<typeof setup>>
// Fresh isolated database per scenario. Fixture creation is not part of the business assertion budget.
beforeEach(async () => {
 context=await setup(true)
 await runMigrations(context.pool,{includeRefunds:true})
})

it('recette financière : ACK perdu, reprise sur une seconde session, remboursement et rapprochement sans doublons',async () => {
 const {pool,manager,cashier,financialState}=context
 const login=await apiTestClient(pool,'POST','/api/auth/login',{email:'quote-manager@example.invalid',password:'Password2026'})
 expect(login.status).toBe(200)
 const secondSession=login.body.sessionToken as string
 expect(secondSession).not.toBe(manager)
 const sold=await apiTestClient(pool,'POST','/api/checkout/commit',command(),manager)
 expect(sold.status).toBe(200)
 const sale=sold.body.result as CheckoutResult
 const afterSale=await financialState()
 // First response is assumed lost to the workstation: recover by the original key, never re-key.
 const key={idempotencyKey:command().idempotencyKey}
 const recovered=await apiTestClient(pool,'POST','/api/checkout/status',key,secondSession)
 expect(recovered.body).toEqual({ok:true,status:'confirmed',result:sale})
 const replay=await apiTestClient(pool,'POST','/api/checkout/commit',command(),secondSession)
 expect(replay.body).toEqual({ok:true,result:sale,replayed:true})
 expect(await financialState()).toEqual(afterSale)
 const refund={idempotencyKey:'acceptance-refund-stable-0001',originalTicketId:sale.ticketId,reason:'Retour intégral autorisé',returnLineIds:[sale.records.revenues[1].id],cashSessionId:'cash-quote',paymentReferences:[{method:'wave',reference:'Attestation externe de recette'}]}
 expect((await apiTestClient(pool,'POST','/api/checkout/refund',refund,cashier)).status).toBe(403)
 expect(await financialState()).toEqual(afterSale)
 const response=await apiTestClient(pool,'POST','/api/checkout/refund',refund,secondSession)
 expect(response.status).toBe(200)
 const result=response.body.result as CheckoutRefundResult
 expect(result).toMatchObject({confirmed:true,total:10000,originalTicketId:sale.ticketId,paymentExecution:'cash_ledger_and_external_attestation'})
 const afterRefund=await financialState()
 const refundedAgain=await apiTestClient(pool,'POST','/api/checkout/refund',refund,manager)
 expect(refundedAgain.body).toEqual({ok:true,result,replayed:true})
 expect(await financialState()).toEqual(afterRefund)
 const reconciliation=(await pool.query<{revenues:number;cash:number;quantity:number;commands:number;refunds:number}>(`SELECT
  (SELECT COALESCE(sum(amount),0)::int FROM revenues) AS revenues,
  (SELECT COALESCE(sum(CASE WHEN type='in' THEN amount ELSE -amount END),0)::int FROM cash_movements) AS cash,
  (SELECT quantity FROM products WHERE id='product-quote') AS quantity,
  (SELECT count(*)::int FROM checkout_commands) AS commands,
  (SELECT count(*)::int FROM checkout_refunds) AS refunds`)).rows[0]
 expect(reconciliation).toEqual({revenues:0,cash:0,quantity:6,commands:1,refunds:1})
 // Only resale is returned; consumed service supplies remain consumed. No simulated Wave transfer.
 expect(result.records.cashSession?.theoreticalClosingBalance).toBe(1000)
 expect(sale.quote.payments).toEqual(command().payments)
})
