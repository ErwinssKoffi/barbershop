import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setup } from './checkoutTestFixtures'
import { runMigrations } from '../../server/migrations'
import { createBooking, listBookings, updateBooking } from '../../server/booking'
import { withTenantClient } from '../../server/tenantContext'
import { apiTestClient } from './apiTestClient'
import type { Employee } from '../domain/models'
import { syncWithNeonDatabase } from '../../server/syncEngine'

let context:Awaited<ReturnType<typeof setup>>
const input=() => ({idempotencyKey:'booking-stable-test-key-0001',kind:'appointment' as const,employeeId:'booking-employee',serviceId:'service-quote',customerName:'Client inscrit',customerContact:'',note:'',startAt:'2026-11-05T10:00:00.000Z',endAt:'2026-11-05T10:30:00.000Z'})
const period={from:'2026-11-05T00:00:00.000Z',to:'2026-11-06T00:00:00.000Z'}
beforeEach(async () => {
 vi.stubEnv('SALON_BOOKING_ENABLED','true')
 context=await setup(false)
 await runMigrations(context.pool,{includeBooking:true})
 const time=new Date().toISOString()
 const employee:Employee={id:'booking-employee',fullName:'Employé de recette',firstName:'Employé',lastName:'Recette',roleTitle:'Coiffure',phone:'',hireDate:'2026-11-01',baseSalary:0,remunerationType:'fixed',defaultBonus:0,commissionEnabled:false,commissionBasis:'total_revenue',commissionRate:0,adminNote:'',isActive:true,createdAt:time,updatedAt:time}
 await syncWithNeonDatabase(context.pool,{payload:{...context.snapshot,employees:[employee]}},context.tenant,'manager')
})
afterEach(() => vi.unstubAllEnvs())
it('008 indépendante de 006/007, création idempotente, snapshots immuables et aucun effet financier',async () => {
 const {pool,tenant,actorId,financialState}=context
 expect((await pool.query("SELECT to_regclass('checkout_commands') AS name")).rows[0].name).toBeNull()
 const before=await financialState()
 const first=await createBooking(pool,tenant,actorId,input())
 const second=await createBooking(pool,tenant,actorId,input())
 expect(second).toEqual({...first,replayed:true})
 expect(first.booking).toMatchObject({employeeName:'Employé de recette',serviceName:'Prestation',status:'planned',version:1,tenantId:tenant})
 expect((await pool.query('SELECT * FROM booking_events')).rows).toHaveLength(1)
 expect(await financialState()).toEqual(before)
 await expect(createBooking(pool,tenant,actorId,{...input(),customerName:'Autre'})).rejects.toMatchObject({code:'BOOKING_KEY_CONFLICT'})
})
it('rejette les chevauchements, accepte les bornes adjacentes et bloque aussi les pauses',async () => {
 const {pool,tenant,actorId}=context
 await createBooking(pool,tenant,actorId,input())
 await expect(createBooking(pool,tenant,actorId,{...input(),idempotencyKey:'booking-overlap-test-key-0002',startAt:'2026-11-05T10:15:00.000Z'})).rejects.toMatchObject({code:'BOOKING_CONFLICT'})
 const adjacent=await createBooking(pool,tenant,actorId,{...input(),idempotencyKey:'booking-adjacent-key-0003',kind:'unavailable',serviceId:undefined,customerName:'',startAt:'2026-11-05T10:30:00.000Z',endAt:'2026-11-05T11:00:00.000Z'})
 expect(adjacent.booking.kind).toBe('unavailable')
 await expect(createBooking(pool,tenant,actorId,{...input(),idempotencyKey:'booking-overlap-pause-0004',startAt:'2026-11-05T10:45:00.000Z',endAt:'2026-11-05T11:15:00.000Z'})).rejects.toMatchObject({code:'BOOKING_CONFLICT'})
})
it('annulation auditée libère le créneau, ancienne version et réouverture refusées',async () => {
 const {pool,tenant,actorId}=context
 const original=(await createBooking(pool,tenant,actorId,input())).booking
 const cancelled=await updateBooking(pool,tenant,actorId,{id:original.id,expectedVersion:1,status:'cancelled'})
 expect(cancelled.booking.version).toBe(2)
 await expect(updateBooking(pool,tenant,actorId,{id:original.id,expectedVersion:1,status:'confirmed'})).rejects.toMatchObject({code:'BOOKING_VERSION_CONFLICT'})
 await expect(updateBooking(pool,tenant,actorId,{id:original.id,expectedVersion:2,status:'confirmed'})).rejects.toMatchObject({code:'BOOKING_TRANSITION_INVALID'})
 expect((await createBooking(pool,tenant,actorId,{...input(),idempotencyKey:'replacement-booking-key-0002'})).replayed).toBe(false)
 expect((await pool.query('SELECT * FROM booking_events')).rows).toHaveLength(3)
})
it('déplace un créneau avec contrôle de version et conserve l’historique',async () => {
 const {pool,tenant,actorId}=context
 const original=(await createBooking(pool,tenant,actorId,input())).booking
 const updated=await updateBooking(pool,tenant,actorId,{id:original.id,expectedVersion:1,status:'confirmed',startAt:'2026-11-05T11:00:00.000Z',endAt:'2026-11-05T11:30:00.000Z'})
 expect(updated.booking).toMatchObject({version:2,startAt:'2026-11-05T11:00:00.000Z'})
 const event=(await pool.query<{payload_json:{before:{startAt:string};after:{startAt:string}}}>('SELECT payload_json FROM booking_events ORDER BY at DESC')).rows[0].payload_json
 expect(event.before.startAt).toBe(original.startAt);expect(event.after.startAt).toBe(updated.booking.startAt)
 await createBooking(pool,tenant,actorId,{...input(),idempotencyKey:'booking-new-free-slot-0002'})
 await expect(updateBooking(pool,tenant,actorId,{id:original.id,expectedVersion:2,status:'confirmed',startAt:input().startAt,endAt:input().endAt})).rejects.toMatchObject({code:'BOOKING_CONFLICT'})
})
it('statuts arrivé puis terminé sans vente automatique et sans suppression',async () => {
 const {pool,tenant,actorId,financialState}=context
 const original=(await createBooking(pool,tenant,actorId,input())).booking;const before=await financialState()
 await expect(updateBooking(pool,tenant,actorId,{id:original.id,expectedVersion:1,status:'completed'})).rejects.toMatchObject({code:'BOOKING_TRANSITION_INVALID'})
 await updateBooking(pool,tenant,actorId,{id:original.id,expectedVersion:1,status:'arrived'})
 await updateBooking(pool,tenant,actorId,{id:original.id,expectedVersion:2,status:'completed'})
 expect(await financialState()).toEqual(before)
 await expect(withTenantClient(pool,tenant,(db) => db.query('DELETE FROM bookings'))).rejects.toThrow()
 await expect(withTenantClient(pool,tenant,(db) => db.query('UPDATE booking_events SET payload_json=payload_json'))).rejects.toThrow()
})
it('Caissier lecture seule, Gérant actif pour écrire, POST/session obligatoires',async () => {
 const {pool,tenant,actorId,cashierId,manager,cashier}=context
 expect((await apiTestClient(pool,'POST','/api/booking/create',input())).status).toBe(401)
 expect((await apiTestClient(pool,'GET','/api/booking/list',period,manager)).status).toBe(405)
 expect((await apiTestClient(pool,'POST','/api/booking/create',input(),cashier)).status).toBe(403)
 expect((await apiTestClient(pool,'POST','/api/booking/list',period,cashier)).status).toBe(200)
 await expect(createBooking(pool,tenant,cashierId,input())).rejects.toMatchObject({status:403})
 expect((await apiTestClient(pool,'POST','/api/booking/create',input(),manager)).status).toBe(200)
 await pool.query('UPDATE memberships SET is_active=false WHERE tenant_id=$1 AND user_id=$2',[tenant,actorId])
 await expect(listBookings(pool,tenant,actorId,period)).rejects.toMatchObject({status:403})
})
it('isole le même identifiant et la même clé dans un autre salon',async () => {
 const {pool,tenant,actorId}=context
 const original=(await createBooking(pool,tenant,actorId,input())).booking
 const other=(await pool.query<{id:string}>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id',[tenant])).rows[0].id
 await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'manager')",[other,actorId])
 expect((await listBookings(pool,other,actorId,period)).bookings).toHaveLength(0)
 await expect(updateBooking(pool,other,actorId,{id:original.id,expectedVersion:1,status:'cancelled'})).rejects.toMatchObject({status:404})
 await expect(createBooking(pool,other,actorId,input())).rejects.toMatchObject({code:'BOOKING_EMPLOYEE_UNAVAILABLE'})
})
it('un défaut d’audit annule la création entière et permet la même clé ensuite',async () => {
 const {pool,tenant,actorId}=context
 const broken={...pool,connect:async () => {
  const db=await pool.connect();return {...db,query:async <R>(sql:string,values?:unknown[]) => {
   if(sql.startsWith('INSERT INTO booking_events')) throw new Error('audit failure')
   return db.query<R>(sql,values)
  }}
 }}
 await expect(createBooking(broken,tenant,actorId,input())).rejects.toThrow('audit failure')
 expect((await pool.query('SELECT * FROM bookings')).rows).toHaveLength(0)
 expect((await createBooking(pool,tenant,actorId,input())).replayed).toBe(false)
})
it('reste désactivé côté serveur et refuse les services/employés inactifs',async () => {
 const {pool,tenant,actorId}=context
 vi.stubEnv('SALON_BOOKING_ENABLED','false')
 await expect(createBooking(pool,tenant,actorId,input())).rejects.toMatchObject({code:'BOOKING_DISABLED'})
 vi.stubEnv('SALON_BOOKING_ENABLED','true')
 await pool.query("UPDATE employees SET payload_json=jsonb_set(payload_json,'{isActive}','false')")
 await expect(createBooking(pool,tenant,actorId,input())).rejects.toMatchObject({code:'BOOKING_EMPLOYEE_UNAVAILABLE'})
 await pool.query("UPDATE employees SET payload_json=jsonb_set(payload_json,'{isActive}','true')")
 await pool.query("UPDATE services_catalog SET payload_json=jsonb_set(payload_json,'{isActive}','false')")
 await expect(createBooking(pool,tenant,actorId,input())).rejects.toMatchObject({code:'BOOKING_SERVICE_UNAVAILABLE'})
})
it('prend le verrou de planification avant de consulter les conflits ou écrire',async () => {
 const {pool,tenant,actorId}=context;const calls:string[]=[]
 const observed={...pool,connect:async () => {
  const db=await pool.connect();return {...db,query:async <R>(sql:string,values?:unknown[]) => {calls.push(sql);return db.query<R>(sql,values)}}
 }}
 await createBooking(observed,tenant,actorId,input())
 const lock=calls.findIndex((sql) => sql.includes('pg_advisory_xact_lock'))
 expect(lock).toBeGreaterThan(-1)
 expect(lock).toBeLessThan(calls.findIndex((sql) => sql.startsWith('SELECT id FROM bookings WHERE employee_id')))
 expect(lock).toBeLessThan(calls.findIndex((sql) => sql.startsWith('INSERT INTO bookings')))
})
it('ne tente pas de migrer à la volée si 008 est absente',async () => {
 const {pool,tenant,actorId}=context
 await pool.query('DROP TABLE booking_events; DROP TABLE bookings')
 await expect(createBooking(pool,tenant,actorId,input())).rejects.toMatchObject({code:'BOOKING_MIGRATION_REQUIRED',status:503})
 expect((await pool.query("SELECT to_regclass('bookings') AS name")).rows[0].name).toBeNull()
})
