import type { CheckoutCommand, CheckoutLineCommand } from './checkout.ts'

export class CheckoutValidationError extends Error {
 code: string
 constructor(code: string, message: string) { super(message); this.code = code }
}
function reject(code: string, message: string): never { throw new CheckoutValidationError(code,message) }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject('INVALID_CHECKOUT', 'Objet de commande invalide.')
  return value as Record<string, unknown>
}
function fields(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) reject('INVALID_CHECKOUT', 'Champ de commande non autorisé.')
}
function text(value: unknown, name: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) reject('INVALID_CHECKOUT', `${name} invalide.`)
  return value.trim()
}
function integer(value: unknown, name: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) reject('INVALID_CHECKOUT_AMOUNT', `${name} doit être un entier positif ou nul, dans la limite des entiers sûrs.`)
  return value
}

export function validateCheckoutCommand(input: unknown): CheckoutCommand {
  const body = record(input)
  fields(body, ['idempotencyKey', 'lines', 'payments', 'discount', 'amountTendered', 'expectedTotal', 'cashSessionId', 'clientName'])
  const key = text(body.idempotencyKey, 'Clé d’idempotence', 128)
  if (!/^[a-zA-Z0-9:_-]{16,128}$/.test(key)) reject('INVALID_CHECKOUT', 'Clé d’idempotence invalide (16 à 128 caractères).')
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 100) reject('INVALID_CHECKOUT', 'Un ticket doit contenir entre 1 et 100 lignes.')
  const lines: CheckoutLineCommand[] = body.lines.map((raw) => {
    const line = record(raw); fields(line, ['kind', 'catalogId', 'variantId', 'employeeId', 'quantity', 'expectedUnitPrice'])
    if (line.kind !== 'service' && line.kind !== 'product') reject('INVALID_CHECKOUT', 'Type de ligne inconnu.')
    const quantity = integer(line.quantity, 'Quantité', 1)
    if (quantity > 1_000_000) reject('INVALID_CHECKOUT', 'Quantité par ligne trop élevée.')
    if (line.kind === 'product' && line.variantId !== undefined) reject('INVALID_CHECKOUT', 'Une variante ne concerne que les prestations.')
    return { kind: line.kind, catalogId: text(line.catalogId, 'Référence catalogue'), quantity,
      ...(line.variantId !== undefined ? { variantId: text(line.variantId, 'Variante') } : {}),
      ...(line.employeeId !== undefined ? { employeeId: text(line.employeeId, 'Employé') } : {}),
      ...(line.expectedUnitPrice !== undefined ? { expectedUnitPrice: integer(line.expectedUnitPrice, 'Prix attendu') } : {}),
    }
  })
  if (!Array.isArray(body.payments) || body.payments.length > 20) reject('INVALID_CHECKOUT', 'Répartition de paiement invalide.')
  const methods = new Set<string>()
  const payments = body.payments.map((raw) => {
    const payment = record(raw); fields(payment, ['method', 'amount'])
    const method = text(payment.method, 'Mode de paiement', 80)
    if (methods.has(method)) reject('INVALID_CHECKOUT_PAYMENT', 'Regroupez les montants d’un même mode de paiement.')
    methods.add(method)
    return { method, amount: integer(payment.amount, 'Paiement', 1) }
  })
  let discount: CheckoutCommand['discount']
  if (body.discount !== undefined) {
    const value = record(body.discount); fields(value, ['amount', 'reason'])
    discount = { amount: integer(value.amount, 'Remise'), reason: text(value.reason, 'Motif de remise', 500) }
  }
  return { idempotencyKey: key, lines, payments, ...(discount ? { discount } : {}),
    ...(body.amountTendered !== undefined ? { amountTendered: integer(body.amountTendered, 'Espèces remises') } : {}),
    ...(body.expectedTotal !== undefined ? { expectedTotal: integer(body.expectedTotal, 'Total attendu') } : {}),
    ...(body.cashSessionId !== undefined ? { cashSessionId: text(body.cashSessionId, 'Session de caisse') } : {}),
    ...(body.clientName !== undefined ? { clientName: text(body.clientName, 'Nom client', 160) } : {}),
  }
}
