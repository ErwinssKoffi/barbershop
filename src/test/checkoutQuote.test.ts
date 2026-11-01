import { command, setup } from './checkoutTestFixtures'
import { describe, expect, it } from 'vitest'
import { parseCheckoutCommand, quoteCheckout } from '../../server/checkoutQuote'
import { syncWithNeonDatabase } from '../../server/syncEngine'
import { withTenantClient } from '../../server/tenantContext'
import { apiTestClient } from './apiTestClient'
import type { CheckoutCommand } from '../domain/checkout'

describe('Contrat CheckoutCommand strict', () => {
  it('normalise une commande et exige une clé stable sans accepter un tenant ni des totaux imposés', () => {
    expect(parseCheckoutCommand(command())).toEqual(command())
    for (const value of [{ ...command(), tenantId: 'forged' }, { ...command(), total: 1 }, { ...command(), receiptNumber: 'forged' }, { ...command(), idempotencyKey: 'short' }, null, []]) {
      expect(() => parseCheckoutCommand(value)).toThrow()
    }
  })
  it.each([0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '2'])('refuse une quantité invalide : %s', (quantity) => {
    const value = command(); Object.assign(value.lines[0], { quantity })
    expect(() => parseCheckoutCommand(value)).toThrow()
  })
  it.each([-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '10000'])('refuse un paiement invalide : %s', (amount) => {
    const value = command(); Object.assign(value.payments[0], { amount })
    expect(() => parseCheckoutCommand(value)).toThrow()
  })
  it('refuse les champs de prix arbitraires, les doublons de modes et les limites de volume', () => {
    const value = command()
    expect(() => parseCheckoutCommand({ ...value, lines: [{ ...value.lines[0], unitPrice: 1 }] })).toThrow()
    expect(() => parseCheckoutCommand({ ...value, payments: [value.payments[0], value.payments[0]] })).toThrow()
    expect(() => parseCheckoutCommand({ ...value, lines: Array.from({ length: 101 }, () => value.lines[0]) })).toThrow()
    expect(() => parseCheckoutCommand({ ...value, discount: { amount: 100, reason: '' } })).toThrow()
  })
})

describe('Préparation serveur Checkout — API et PostgreSQL', () => {
  it('applique le même calcul aux deux rôles, sans écrire de vente, reçu, stock ni caisse', async () => {
    const { call, cashier, manager: managerToken, pool, financialState } = await setup()
    const before = await financialState()
    const manager = await call(command()); const clerk = await call(command(), cashier)
    expect(manager.status).toBe(200); expect(clerk.status).toBe(200)
    for (const response of [manager, clerk]) {
      expect(response.body.quote).toMatchObject({ status: 'quoted', confirmed: false, currency: 'XOF', subtotal: 10000, discount: 0, total: 10000, cashAmount: 4000, change: 1000, stockRequired: [{ productId: 'product-quote', quantity: 6 }] })
      expect(JSON.stringify(response.body)).not.toContain('costPrice')
      expect(response.body.quote).not.toHaveProperty('receiptNumber')
    }
    expect(await financialState()).toEqual(before)
    expect((await call(command())).status).toBe(200)
    expect(await financialState()).toEqual(before) // Quote never consumes the idempotency key.
    for (const path of ['/api/sync/pull', '/api/sync/pull?since=0']) {
      const projection = await apiTestClient(pool, 'GET', path, undefined, cashier)
      expect(projection.status).toBe(200)
      expect(JSON.stringify(projection.body)).not.toContain('commissionOverride')
    }
    const complete = await apiTestClient(pool, 'GET', '/api/sync/pull', undefined, managerToken)
    expect(JSON.stringify(complete.body)).toContain('commissionOverride')
  })
  it('rejette les prix manipulés, les paiements incohérents et les remises Caissier', async () => {
    const { call, cashier } = await setup()
    const price = command(); price.lines[0].expectedUnitPrice = 1
    expect((await call(price)).body.code).toBe('CHECKOUT_PRICE_CHANGED')
    const underpaid = command(); underpaid.payments[1].amount--
    expect((await call(underpaid)).body.code).toBe('CHECKOUT_PAYMENT_MISMATCH')
    const overpaid = command(); overpaid.payments[1].amount++
    expect((await call(overpaid)).body.code).toBe('CHECKOUT_PAYMENT_MISMATCH')
    const discounted: CheckoutCommand = { ...command(), discount: { amount: 1001, reason: 'Geste commercial autorisé' }, payments: [{ method: 'wave', amount: 8999 }], expectedTotal: 8999 }
    delete discounted.cashSessionId; delete discounted.amountTendered
    expect((await call(discounted, cashier)).status).toBe(403)
    const response = await call(discounted)
    expect(response.status).toBe(200)
    const quote = response.body.quote as { total: number; lines: { net: number; discount: number }[] }
    expect(quote.lines.reduce((sum, line) => sum + line.net, 0)).toBe(8999)
    expect(quote.lines.reduce((sum, line) => sum + line.discount, 0)).toBe(1001)
  })
  it('contrôle les consommables cumulés, variantes, employés, modes et session espèces', async () => {
    const { call, pool, tenant } = await setup()
    const excessive = command(); excessive.lines[0].quantity = 5; excessive.expectedTotal = 23500; excessive.payments = [{ method: 'wave', amount: 23500 }]; delete excessive.amountTendered
    expect((await call(excessive)).body.code).toBe('INSUFFICIENT_STOCK')
    const variant = command(); variant.lines[0].variantId = 'foreign-variant'
    expect((await call(variant)).body.code).toBe('VARIANT_UNAVAILABLE')
    const employee = command(); employee.lines[0].employeeId = 'foreign-employee'
    expect((await call(employee)).body.code).toBe('EMPLOYEE_UNAVAILABLE')
    const method = command(); method.payments[0].method = 'not-configured'
    expect((await call(method)).body.code).toBe('PAYMENT_METHOD_UNAVAILABLE')
    const absent = command(); delete absent.cashSessionId
    expect((await call(absent)).body.code).toBe('CASH_SESSION_REQUIRED')
    const tender = command(); tender.amountTendered = 3999
    expect((await call(tender)).body.code).toBe('INVALID_CASH_TENDER')
    await withTenantClient(pool, tenant, (db) => db.query("UPDATE cash_sessions SET status = 'closed', payload_json = jsonb_set(payload_json, '{status}', '\"closed\"'::jsonb) WHERE id = 'cash-quote'"))
    expect((await call(command())).body.code).toBe('CASH_SESSION_UNAVAILABLE')
  })
  it('refuse une session absente, le tenant forgé et les références d’un autre salon', async () => {
    const { call, pool, tenant, snapshot } = await setup()
    expect((await apiTestClient(pool, 'POST', '/api/checkout/quote', command())).status).toBe(401)
    expect((await call({ ...command(), tenantId: 'arbitrary' })).status).toBe(400)
    expect((await call(null)).status).toBe(400)
    const other = (await pool.query<{ id: string }>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id = $1 RETURNING id', [tenant])).rows[0].id
    snapshot.services[0].id = 'other-service'
    await syncWithNeonDatabase(pool, { payload: snapshot }, other, 'manager')
    const foreign = command(); foreign.lines[0].catalogId = 'other-service'
    expect((await call(foreign)).body.code).toBe('CATALOG_ITEM_UNAVAILABLE')
    // A valid command in this tenant still uses its own prices and stock.
    expect((await quoteCheckout(pool, tenant, 'cashier', command())).total).toBe(10000)
  })
})
