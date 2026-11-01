export const BOOKING_STATUSES=['planned','confirmed','arrived','completed','cancelled','no_show'] as const
export type BookingStatus=typeof BOOKING_STATUSES[number]
export interface Booking {
 id:string;tenantId:string;kind:'appointment'|'unavailable';employeeId:string;employeeName:string
 serviceId?:string;serviceName?:string;customerName:string;customerContact:string;note:string
 startAt:string;endAt:string;status:BookingStatus;version:number;createdAt:string;updatedAt:string
}
export interface CreateBooking {
 idempotencyKey:string;kind:'appointment'|'unavailable';employeeId:string;serviceId?:string
 customerName:string;customerContact:string;note:string;startAt:string;endAt:string
}
export function bookingTransitions(booking:Pick<Booking,'kind'|'status'>):BookingStatus[] {
 if(booking.kind==='unavailable') return booking.status==='planned' ? ['cancelled'] : []
 const transitions:Record<BookingStatus,BookingStatus[]>={planned:['confirmed','arrived','cancelled','no_show'],confirmed:['arrived','cancelled','no_show'],arrived:['completed','cancelled'],completed:[],cancelled:[],no_show:[]}
 return transitions[booking.status]
}
export const BOOKING_LABELS:Record<BookingStatus,string>={planned:'Prévu',confirmed:'Confirmé',arrived:'Arrivé',completed:'Terminé',cancelled:'Annulé',no_show:'Absent'}
