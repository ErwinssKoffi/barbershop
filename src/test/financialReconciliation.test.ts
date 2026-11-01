import { expect, it } from 'vitest'
import { setup, command } from './checkoutTestFixtures'
import { runMigrations } from '../../server/migrations'
import { commitCheckout } from '../../server/checkoutCommit'
import { refundCheckout } from '../../server/checkoutRefund'
import { reconcileFinancialState } from '../../server/financialReconciliation'
import { apiTestClient } from './apiTestClient'
import { withTenantClient } from '../../server/tenantContext'

it('rapproche vente puis remboursement dans une transaction en lecture seule sans modifier les journaux',async () => {
 const {pool,tenant,actorId,financialState}=await setup(true)
 await runMigrations(pool,{includeRefunds:true})
 const sale=(await commitCheckout(pool,tenant,actorId,command())).result
 const before=await financialState()
 const report=await reconcileFinancialState(pool,tenant,actorId,{})
 expect(report).toMatchObject({status:'balanced',readOnly:true,documentsChecked:1,cashSessionsChecked:1,refundsAvailable:true})
 expect(Object.values(report.checks).every((n) => n===0)).toBe(true)
 expect(await financialState()).toEqual(before)
 await refundCheckout(pool,tenant,actorId,{idempotencyKey:'reconciliation-refund-0001',originalTicketId:sale.ticketId,reason:'Retour',returnLineIds:[sale.records.revenues[1].id],cashSessionId:'cash-quote',paymentReferences:[{method:'wave',reference:'Attestation externe'}]})
 const after=await financialState()
 expect(await reconcileFinancialState(pool,tenant,actorId,{})).toMatchObject({status:'balanced',documentsChecked:2})
 expect(await financialState()).toEqual(after)
})
it('signale une couverture incomplète sans 007, jamais un bilan complet vert',async () => {
 const {pool,tenant,actorId}=await setup(true)
 expect(await reconcileFinancialState(pool,tenant,actorId,{})).toMatchObject({status:'incomplete',refundsAvailable:false,documentsChecked:0})
})
it('détecte les écarts de caisse et les mouvements orphelins sans les réparer',async () => {
 const {pool,tenant,actorId}=await setup(true)
 await withTenantClient(pool,tenant,async (db) => {
  await db.query("UPDATE cash_sessions SET theoretical_closing_balance=42 WHERE id='cash-quote'")
  await db.query(`INSERT INTO cash_movements(id,session_id,type,amount,occurred_at,updated_at,payload_json)
   VALUES('orphan','absent','in',10,'2026-11-01','2026-11-01',$1::jsonb)`,[JSON.stringify({id:'orphan',sessionId:'absent',type:'in',amount:10})])
 })
 const report=await reconcileFinancialState(pool,tenant,actorId,{})
 expect(report.status).toBe('discrepancies')
 expect(report.checks).toMatchObject({cashSessionBalances:1,orphanCashMovements:1})
 expect((await pool.query("SELECT theoretical_closing_balance FROM cash_sessions WHERE id='cash-quote'")).rows[0].theoretical_closing_balance).toBe(42)
})
it('détecte une projection scalaire canonique altérée sans affaiblir les protections applicatives',async () => {
 const {pool,tenant,actorId}=await setup(true)
 await commitCheckout(pool,tenant,actorId,command())
 // Simulate privileged database corruption in a disposable fixture only.
 await pool.query('ALTER TABLE revenues DISABLE TRIGGER protect_checkout')
 await pool.query('UPDATE revenues SET amount=amount+1')
 await pool.query('ALTER TABLE revenues ENABLE TRIGGER protect_checkout')
 const report=await reconcileFinancialState(pool,tenant,actorId,{})
 expect(report.checks.documentTotals).toBe(1)
 expect(report.checks.canonicalRecords).toBe(2)
 expect(report.status).toBe('discrepancies')
})
it('impose session, POST et Gérant actif, sans accepter de salon forgé',async () => {
 const {pool,tenant,actorId,cashierId,manager,cashier}=await setup(true)
 expect((await apiTestClient(pool,'POST','/api/checkout/reconciliation',{})).status).toBe(401)
 expect((await apiTestClient(pool,'GET','/api/checkout/reconciliation',{},manager)).status).toBe(405)
 expect((await apiTestClient(pool,'POST','/api/checkout/reconciliation',{},cashier)).status).toBe(403)
 await expect(reconcileFinancialState(pool,tenant,cashierId,{})).rejects.toMatchObject({status:403})
 expect((await apiTestClient(pool,'POST','/api/checkout/reconciliation',{tenantId:tenant},manager)).status).toBe(400)
 const ok=await apiTestClient(pool,'POST','/api/checkout/reconciliation',{},manager)
 expect(ok.status).toBe(200);expect(ok.headers['cache-control']).toBe('no-store')
 await pool.query('UPDATE memberships SET is_active=false WHERE tenant_id=$1 AND user_id=$2',[tenant,actorId])
 await expect(reconcileFinancialState(pool,tenant,actorId,{})).rejects.toMatchObject({status:403})
})
it('isole un autre salon sans consulter ses écritures ou exposer les erreurs SQL',async () => {
 const {pool,tenant,actorId}=await setup(true)
 await commitCheckout(pool,tenant,actorId,command())
 const other=(await pool.query<{id:string}>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id',[tenant])).rows[0].id
 await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'manager')",[other,actorId])
 expect(await reconcileFinancialState(pool,other,actorId,{})).toMatchObject({documentsChecked:0,cashSessionsChecked:0})
 const broken={...pool,connect:async () => {
  const db=await pool.connect()
  return {...db,query:async <R>(sql:string,values?:unknown[]) => {
   if(sql.includes('WITH documents')) throw new Error('postgresql://private.invalid')
   return db.query<R>(sql,values)
  }}
 }}
 await expect(reconcileFinancialState(broken,tenant,actorId,{})).rejects.toMatchObject({status:503,code:'RECONCILIATION_UNAVAILABLE'})
 const result=await reconcileFinancialState(pool,tenant,actorId,{})
 expect(result.documentsChecked).toBe(1)
})
it('refuse sans migration 006 et ne la crée pas',async () => {
 const {pool,tenant,actorId}=await setup(false)
 await expect(reconcileFinancialState(pool,tenant,actorId,{})).rejects.toMatchObject({status:503,code:'CHECKOUT_MIGRATION_REQUIRED'})
 expect((await pool.query("SELECT to_regclass('checkout_commands') AS table")).rows[0].table).toBeNull()
})
it('détecte les rattachements orphelins, mouvements invalides et projections de stock altérées',async () => {
 const {pool,tenant,actorId}=await setup(true)
 const sale=(await commitCheckout(pool,tenant,actorId,command())).result
 await withTenantClient(pool,tenant,async (db) => {
  await db.query("INSERT INTO checkout_records(tenant_id,ticket_id,table_name,row_id) VALUES($1,$2,'revenues','missing-row')",[tenant,sale.ticketId])
  await db.query(`INSERT INTO cash_movements(id,session_id,type,amount,occurred_at,updated_at,payload_json)
   VALUES('invalid','cash-quote','unknown',0,'2026-11-01','2026-11-01',$1::jsonb)`,[JSON.stringify({id:'invalid',sessionId:'cash-quote',type:'unknown',amount:0})])
 })
 await pool.query('ALTER TABLE stock_movements DISABLE TRIGGER protect_checkout')
 await pool.query('UPDATE stock_movements SET quantity_delta=quantity_delta+1')
 await pool.query('ALTER TABLE stock_movements ENABLE TRIGGER protect_checkout')
 const report=await reconcileFinancialState(pool,tenant,actorId,{})
 expect(report.checks).toMatchObject({recordOwnership:1,invalidCashMovements:1,canonicalRecords:2})
})
it('une tentative d’écriture injectée est refusée par PostgreSQL READ ONLY puis entièrement annulée',async () => {
 const {pool,tenant,actorId,financialState}=await setup(true)
 const before=await financialState();let denied=''
 const probing={...pool,connect:async () => {
  const db=await pool.connect()
  return {...db,query:async <R>(sql:string,values?:unknown[]) => {
   if(sql.includes('WITH documents')) {
    try {await db.query('UPDATE products SET quantity=0')}
    catch(error) {denied=(error as {code:string}).code;throw error}
   }
   return db.query<R>(sql,values)
  }}
 }}
 await expect(reconcileFinancialState(probing,tenant,actorId,{})).rejects.toMatchObject({code:'RECONCILIATION_UNAVAILABLE'})
 expect(denied).toBe('25006')
 expect(await financialState()).toEqual(before)
})
it('limite la route à six contrôles par minute et compte Gérant',async () => {
 const {pool,manager,financialState}=await setup(true)
 const before=await financialState()
 for(let i=0;i<6;i++) expect((await apiTestClient(pool,'POST','/api/checkout/reconciliation',{},manager)).status).toBe(200)
 const limited=await apiTestClient(pool,'POST','/api/checkout/reconciliation',{},manager)
 expect(limited.status).toBe(429);expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0)
 expect(await financialState()).toEqual(before)
})
it('rapproche aussi une clôture et son écart de comptage',async () => {
 const {pool,tenant,actorId}=await setup(true)
 await withTenantClient(pool,tenant,async (db) => {
  await db.query(`UPDATE cash_sessions SET status='closed',counted_closing_balance=900,discrepancy=-100,
   payload_json=payload_json || '{"status":"closed","countedClosingBalance":900,"discrepancy":-100}'::jsonb WHERE id='cash-quote'`)
 })
 expect((await reconcileFinancialState(pool,tenant,actorId,{})).checks.cashSessionBalances).toBe(0)
 await withTenantClient(pool,tenant,(db) => db.query("UPDATE cash_sessions SET discrepancy=0 WHERE id='cash-quote'"))
 expect((await reconcileFinancialState(pool,tenant,actorId,{})).checks.cashSessionBalances).toBe(1)
})
