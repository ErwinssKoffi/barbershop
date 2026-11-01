import type { CheckoutResult } from './checkout'

/** Full ticket only. Non-cash references attest external execution; this API sends no money. */
export interface CheckoutRefundCommand {
 idempotencyKey:string
 originalTicketId:string
 reason:string
 returnLineIds:string[]
 cashSessionId?:string
 paymentReferences:{method:string;reference:string}[]
}
export interface CheckoutRefundResult {
 status:'refunded'; confirmed:true; tenantId:string; actorId:string; confirmedAt:string
 ticketId:string; receiptNumber:string; originalTicketId:string; originalReceiptNumber:string
 command:CheckoutRefundCommand
 total:number
 payments:{method:string;amount:number}[]
 paymentExecution:'cash_ledger_and_external_attestation'
 records:CheckoutResult['records']
}

/** Compare-and-execute precondition; not a payment authorization or reservation. */
export interface RefundPrecondition {
 total:number
 originalReceiptNumber:string
 fingerprint:string
}
export interface CheckoutRefundReview {
 status:'reviewed'
 tenantId:string
 actorId:string
 command:CheckoutRefundCommand
 originalTicketId:string
 originalReceiptNumber:string
 total:number
 payments:{method:string;amount:number}[]
 lines:{id:string;label:string;quantity:number;amount:number;productId?:string;returned:boolean}[]
 precondition:RefundPrecondition
}

export interface CheckoutRefundDiagnostic {
 status:'diagnosed';tenantId:string;actorId:string;checkedAt:string
 command:CheckoutRefundCommand;originalReceiptNumber:string;total:number
 cashRequired:number;cashBalance:number|null
 blockers:{code:'CASH_SESSION_MISSING'|'CASH_SESSION_CLOSED'|'CASH_DATA_INVALID'|'CASH_INSUFFICIENT'|'PRODUCT_UNAVAILABLE'|'STOCK_SNAPSHOT_MISSING'|'STOCK_DATA_INVALID'|'RETURN_QUANTITY_OVERFLOW';message:string;entityId:string}[]
}
