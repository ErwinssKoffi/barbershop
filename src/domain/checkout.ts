/** Command DTO, not a Dexie row. No price, stock balance, receipt or tenant supplied as authority. */
export interface CheckoutLineCommand {
  kind: 'service' | 'product'
  catalogId: string
  variantId?: string
  employeeId?: string
  quantity: number
  expectedUnitPrice?: number
}
export interface CheckoutCommand {
  idempotencyKey: string
  lines: CheckoutLineCommand[]
  payments: { method: string; amount: number }[]
  discount?: { amount: number; reason: string }
  amountTendered?: number
  expectedTotal?: number
  cashSessionId?: string
  clientName?: string
}
export interface CheckoutQuote {
  status: 'quoted'
  confirmed: false
  currency: 'XOF'
  idempotencyKey: string
  quotedAt: string
  lines: {
    kind: 'service' | 'product'; catalogId: string; label: string; categoryCode: string
    variantId?: string; variantLabel?: string; employeeId?: string
    quantity: number; unitPrice: number; gross: number; discount: number; net: number
  }[]
  subtotal: number
  discount: number
  total: number
  payments: { method: string; amount: number }[]
  cashAmount: number
  change: number
  stockRequired: { productId: string; quantity: number }[]
}

export interface CheckoutResult {
  tenantId: string
  status: 'confirmed'
  confirmed: true
  ticketId: string
  receiptNumber: string
  actorId: string
  confirmedAt: string
  command: CheckoutCommand
  quote: CheckoutQuote
  records: {
    revenues: import('./models/index.ts').RevenueEntry[]
    products: import('./models/index.ts').ProductItem[]
    stockMovements: import('./models/index.ts').StockMovement[]
    cashMovements: import('./models/index.ts').CashMovement[]
    cashSession?: import('./models/index.ts').CashSession
  }
}
