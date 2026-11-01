import type { PublicSalonUser } from '../domain/models'
import type { Booking, CreateBooking } from '../domain/booking'
import { BOOKING_STATUSES } from '../domain/booking'
import { workspaceKey } from '../db/accountWorkspace'
import { accessClaims, currentAccessToken, readStoredSession } from './sessionClient'
import { fetchWithCapturedSession } from './scopedSyncClient'
export const bookingEnabled=() => import.meta.env.VITE_BOOKING_ENABLED==='true'
export function validateBooking(value:unknown,tenantId:string):Booking {
 const row=value as Booking
 const instant=(v:unknown) => typeof v==='string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v
 if(!row || row.tenantId!==tenantId || typeof row.id!=='string' || !row.id || !['appointment','unavailable'].includes(row.kind) || !BOOKING_STATUSES.includes(row.status) || !Number.isSafeInteger(row.version) || row.version<1 || typeof row.employeeId!=='string' || !row.employeeId || typeof row.employeeName!=='string' || typeof row.customerName!=='string' || typeof row.customerContact!=='string' || typeof row.note!=='string' || !instant(row.startAt) || !instant(row.endAt) || !instant(row.createdAt) || !instant(row.updatedAt) || Date.parse(row.endAt)-Date.parse(row.startAt)<5*60000 || Date.parse(row.endAt)-Date.parse(row.startAt)>8*3600000 || (row.kind==='appointment' && (typeof row.serviceId!=='string' || !row.serviceId || typeof row.serviceName!=='string')) || (row.kind==='unavailable' && !['planned','cancelled'].includes(row.status))) throw new Error('Réponse agenda incohérente.')
 return row
}
async function request(user:PublicSalonUser,action:'list'|'create'|'update',input:unknown) {
 if(!bookingEnabled()) throw new Error('Module rendez-vous désactivé.')
 const token=await currentAccessToken();const session=readStoredSession();const claims=accessClaims(token)
 if(!user.isActive || !user.tenantId || !session.user?.isActive || workspaceKey(session.user)!==workspaceKey(user) || !token || claims?.uid!==user.id || claims.tid!==user.tenantId || (action!=='list' && user.role!=='manager')) throw new Error('Reconnectez le compte autorisé de cet espace.')
 const controller=new AbortController();const timeout=window.setTimeout(() => controller.abort(),20_000)
 try {
  const response=await fetchWithCapturedSession(`/api/booking/${action}`,token,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})
  const body=await response.json();const latest=readStoredSession()
  if(!latest.user?.isActive || workspaceKey(latest.user)!==workspaceKey(user) || latest.token!==token) throw new Error('Session modifiée : agenda non affiché.')
  if(!response.ok || body?.ok!==true || body.tenantId!==user.tenantId) {
   const messages:Record<string,string>={BOOKING_CONFLICT:'Créneau déjà occupé. Rechargez l’agenda.',BOOKING_VERSION_CONFLICT:'Rendez-vous modifié ailleurs. Rechargez l’agenda.',BOOKING_KEY_CONFLICT:'Cette intention existe déjà. Consultez l’agenda avant de recommencer.',BOOKING_DISABLED:'Module désactivé sur le serveur.',BOOKING_MIGRATION_REQUIRED:'Module non installé sur le serveur (migration 008 requise).'}
   throw new Error(messages[body?.code] ?? 'Opération indisponible ou refusée. Consultez l’agenda avant toute nouvelle tentative ; aucun rendez-vous local de remplacement.')
  }
  return body
 } finally {window.clearTimeout(timeout)}
}
export async function readBookings(user:PublicSalonUser,input:{from:string;to:string;employeeId?:string}) {
 const body=await request(user,'list',input)
 if(!Array.isArray(body.bookings) || body.bookings.length>200 || typeof body.truncated!=='boolean') throw new Error('Réponse agenda incohérente.')
 return {bookings:body.bookings.map((row:unknown) => validateBooking(row,user.tenantId!)),truncated:body.truncated as boolean}
}
export async function sendBooking(user:PublicSalonUser,input:CreateBooking) {return validateBooking((await request(user,'create',input)).booking,user.tenantId!)}
export async function changeBooking(user:PublicSalonUser,input:{id:string;expectedVersion:number;status:Booking['status'];startAt?:string;endAt?:string}) {return validateBooking((await request(user,'update',input)).booking,user.tenantId!)}
