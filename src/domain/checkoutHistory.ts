import type { CheckoutResult } from './checkout'
export type TicketRefundStatus='refunded'|'not_refunded'|'unavailable'
export interface CheckoutHistoryQuery {
 receiptNumber?:string
 from?:string
 to?:string
 cursor?:{createdAt:string;ticketId:string}
}
export interface CheckoutHistoryRow {
 ticketId:string;receiptNumber:string;confirmedAt:string;actorId:string;total:number
 refundStatus:TicketRefundStatus
}
export interface CheckoutHistoryPage {
 tenantId:string;rows:CheckoutHistoryRow[]
 nextCursor:{createdAt:string;ticketId:string}|null
}
export interface CheckoutHistoryDetail {
 tenantId:string;result:CheckoutResult;refundStatus:TicketRefundStatus
}
