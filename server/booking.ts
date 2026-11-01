import { createHash, randomUUID } from 'node:crypto'
import { AuthApiError } from './authEngine.ts'
import { withTenantClient } from './tenantContext.ts'
import type { SqlPoolLike, SqlQueryable } from './neonClient.ts'
import { bookingTransitions, type Booking, type BookingStatus, type CreateBooking } from '../src/domain/booking.ts'
import type { Employee, ServiceCatalogItem } from '../src/domain/models/index.ts'

function fail(code:string,message:string,status=400):never {throw new AuthApiError(status,code,message)}
function object(input:unknown,keys:string[]) {
 if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some((key) => !keys.includes(key))) fail('INVALID_BOOKING','Champs de réservation invalides.')
 return input as Record<string,unknown>
}
function text(input:unknown,max=200,required=true):string {
 if(typeof input!=='string' || input.length>max || (required && !input.trim())) fail('INVALID_BOOKING','Texte de réservation invalide.')
 return input.trim()
}
function instant(input:unknown):string {
 if(typeof input!=='string' || !Number.isFinite(Date.parse(input)) || new Date(input).toISOString()!==input) fail('INVALID_BOOKING','Date UTC ISO invalide.')
 return input
}
function interval(start:unknown,end:unknown) {
 const startAt=instant(start),endAt=instant(end);const duration=Date.parse(endAt)-Date.parse(startAt)
 if(duration<5*60000 || duration>8*3600000) fail('INVALID_BOOKING','Durée requise : de 5 minutes à 8 heures.')
 return {startAt,endAt}
}
export function parseCreateBooking(input:unknown):CreateBooking {
 const row=object(input,['idempotencyKey','kind','employeeId','serviceId','customerName','customerContact','note','startAt','endAt'])
 const idempotencyKey=text(row.idempotencyKey,128)
 if(!/^[a-zA-Z0-9:_-]{16,128}$/.test(idempotencyKey) || !['appointment','unavailable'].includes(String(row.kind))) fail('INVALID_BOOKING','Clé ou type de réservation invalide.')
 const kind=row.kind as CreateBooking['kind']
 const serviceId=kind==='appointment' ? text(row.serviceId) : undefined
 if(kind==='unavailable' && row.serviceId!==undefined) fail('INVALID_BOOKING','Une indisponibilité ne contient pas de prestation.')
 return {idempotencyKey,kind,employeeId:text(row.employeeId),...(serviceId ? {serviceId} : {}),customerName:text(row.customerName ?? '',160,kind==='appointment'),customerContact:text(row.customerContact ?? '',100,false),note:text(row.note ?? '',1000,false),...interval(row.startAt,row.endAt)}
}
async function ready(db:SqlQueryable) {
 if(process.env.SALON_BOOKING_ENABLED!=='true') fail('BOOKING_DISABLED','Module rendez-vous désactivé.',503)
 if(!(await db.query<{ready:boolean}>("SELECT to_regclass('bookings') IS NOT NULL AND to_regclass('booking_events') IS NOT NULL AS ready")).rows[0]?.ready) fail('BOOKING_MIGRATION_REQUIRED','Migration volontaire 008 requise.',503)
}
async function actor(db:SqlQueryable,tenantId:string,actorId:string,write:boolean) {
 const row=(await db.query<{role:string}>(`SELECT m.role FROM memberships m JOIN salon_users u ON u.id=m.user_id
 WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.is_active AND u.is_active FOR SHARE OF m,u`,[tenantId,actorId])).rows[0]
 if(!row || (write && row.role!=='manager')) fail('BOOKING_ACCESS_DENIED',write ? 'Gestion des rendez-vous réservée au Gérant actif.' : 'Appartenance active requise.',403)
}
async function lock(db:SqlQueryable,tenantId:string) {
 await db.query("SET LOCAL lock_timeout='5000ms'")
 await db.query("SET LOCAL statement_timeout='10000ms'")
 // Serialize scheduling mutations BEFORE reading availability. Commit/rollback releases the lock.
 await db.query("SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':booking:' || $1))",[tenantId])
}
async function employee(db:SqlQueryable,id:string) {
 const row=(await db.query<{payload_json:Employee}>('SELECT payload_json FROM employees WHERE id=$1 FOR SHARE',[id])).rows[0]?.payload_json
 if(!row?.isActive) fail('BOOKING_EMPLOYEE_UNAVAILABLE','Employé actif requis.',409)
 return row
}
async function free(db:SqlQueryable,employeeId:string,startAt:string,endAt:string,id='') {
 if((await db.query(`SELECT id FROM bookings WHERE employee_id=$1 AND id<>$4 AND status NOT IN ('cancelled','no_show')
 AND start_at<$3::timestamptz AND end_at>$2::timestamptz LIMIT 1`,[employeeId,startAt,endAt,id])).rows.length) fail('BOOKING_CONFLICT','Cet employé est déjà occupé sur ce créneau.',409)
}
async function event(db:SqlQueryable,tenantId:string,actorId:string,before:Booking|null,after:Booking) {
 await db.query('INSERT INTO booking_events(tenant_id,id,booking_id,actor_id,payload_json) VALUES($1,$2,$3,$4,$5::jsonb)',[tenantId,randomUUID(),after.id,actorId,JSON.stringify({before,after})])
}
export async function createBooking(pool:SqlPoolLike,tenantId:string,actorId:string,input:unknown) {
 const command=parseCreateBooking(input);const hash=createHash('sha256').update(JSON.stringify(command)).digest('hex')
 return withTenantClient(pool,tenantId,async (db) => {
  await ready(db);await lock(db,tenantId);await actor(db,tenantId,actorId,true)
  const previous=(await db.query<{request_hash:string;created_by:string;payload_json:Booking}>('SELECT request_hash,created_by,payload_json FROM bookings WHERE request_key=$1',[command.idempotencyKey])).rows[0]
  if(previous) {
   if(previous.request_hash!==hash || previous.created_by!==actorId) fail('BOOKING_KEY_CONFLICT','Clé déjà utilisée ; consultez l’agenda avant toute nouvelle réservation.',409)
   return {booking:previous.payload_json,replayed:true}
  }
  const staff=await employee(db,command.employeeId)
  let service:ServiceCatalogItem|undefined
  if(command.serviceId) {
   service=(await db.query<{payload_json:ServiceCatalogItem}>('SELECT payload_json FROM services_catalog WHERE id=$1 FOR SHARE',[command.serviceId])).rows[0]?.payload_json
   if(!service?.isActive) fail('BOOKING_SERVICE_UNAVAILABLE','Prestation active requise.',409)
  }
  await free(db,command.employeeId,command.startAt,command.endAt)
  const now=new Date().toISOString()
  const booking:Booking={id:randomUUID(),tenantId,kind:command.kind,employeeId:staff.id,employeeName:staff.fullName,...(service ? {serviceId:service.id,serviceName:service.name} : {}),customerName:command.customerName,customerContact:command.customerContact,note:command.note,startAt:command.startAt,endAt:command.endAt,status:'planned',version:1,createdAt:now,updatedAt:now}
  await db.query(`INSERT INTO bookings(tenant_id,id,employee_id,start_at,end_at,status,request_key,request_hash,created_by,payload_json)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,[tenantId,booking.id,booking.employeeId,booking.startAt,booking.endAt,booking.status,command.idempotencyKey,hash,actorId,JSON.stringify(booking)])
  await event(db,tenantId,actorId,null,booking)
  return {booking,replayed:false}
 })
}
export async function updateBooking(pool:SqlPoolLike,tenantId:string,actorId:string,input:unknown) {
 const row=object(input,['id','expectedVersion','status','startAt','endAt']);const id=text(row.id)
 if(!Number.isSafeInteger(row.expectedVersion) || Number(row.expectedVersion)<1) fail('INVALID_BOOKING','Version requise.')
 return withTenantClient(pool,tenantId,async (db) => {
  await ready(db);await lock(db,tenantId);await actor(db,tenantId,actorId,true)
  const previous=(await db.query<{payload_json:Booking}>('SELECT payload_json FROM bookings WHERE id=$1',[id])).rows[0]?.payload_json
  if(!previous) fail('BOOKING_NOT_FOUND','Rendez-vous introuvable.',404)
  if(previous.version!==row.expectedVersion) fail('BOOKING_VERSION_CONFLICT','Agenda modifié sur un autre poste : rechargez-le.',409)
  const status=row.status as BookingStatus
  if(!bookingTransitions(previous).includes(status) && status!==previous.status) fail('BOOKING_TRANSITION_INVALID','Changement de statut interdit.',409)
  const moving=row.startAt!==undefined || row.endAt!==undefined
  if(moving && (!['planned','confirmed'].includes(previous.status) || !['planned','confirmed'].includes(status))) fail('BOOKING_TRANSITION_INVALID','Seuls les rendez-vous prévus/confirmés peuvent être déplacés.',409)
  const dates=moving ? interval(row.startAt,row.endAt) : {startAt:previous.startAt,endAt:previous.endAt}
  if(!['cancelled','no_show'].includes(status)) {
   if(moving) await employee(db,previous.employeeId)
   await free(db,previous.employeeId,dates.startAt,dates.endAt,id)
  }
  if(status===previous.status && dates.startAt===previous.startAt && dates.endAt===previous.endAt) return {booking:previous}
  const booking:Booking={...previous,...dates,status,version:previous.version+1,updatedAt:new Date().toISOString()}
  await db.query('UPDATE bookings SET start_at=$2,end_at=$3,status=$4,version=$5,payload_json=$6::jsonb WHERE id=$1',[id,booking.startAt,booking.endAt,status,booking.version,JSON.stringify(booking)])
  await event(db,tenantId,actorId,previous,booking)
  return {booking}
 })
}
export async function listBookings(pool:SqlPoolLike,tenantId:string,actorId:string,input:unknown) {
 const row=object(input,['from','to','employeeId']);const from=instant(row.from),to=instant(row.to)
 if(Date.parse(to)<=Date.parse(from) || Date.parse(to)-Date.parse(from)>31*86400000) fail('INVALID_BOOKING','Recherche limitée à 31 jours.')
 const employeeId=row.employeeId===undefined ? null : text(row.employeeId)
 return withTenantClient(pool,tenantId,async (db) => {
  await ready(db);await db.query("SET LOCAL statement_timeout='5000ms'");await actor(db,tenantId,actorId,false)
  const rows=(await db.query<{payload_json:Booking}>(`SELECT payload_json FROM bookings WHERE start_at<$2::timestamptz AND end_at>$1::timestamptz
   AND ($3::text IS NULL OR employee_id=$3) ORDER BY start_at,id LIMIT 201`,[from,to,employeeId])).rows
  return {tenantId,bookings:rows.slice(0,200).map((r) => r.payload_json),truncated:rows.length>200}
 })
}
