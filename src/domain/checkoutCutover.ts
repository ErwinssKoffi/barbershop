export interface CheckoutCutoverReport {
 mode:'legacy'|'enforced'
 checkoutSchemaReady:boolean
 activationApproved:boolean
 canSync:boolean
 blockedCount:number
 blockers:{table:'revenues'|'cashMovements'|'stockMovements';id:string;operation:'write'|'delete';code:'LEGACY_SALE_WRITE_BLOCKED'}[]
 truncated:boolean
}
