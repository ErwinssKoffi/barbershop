import { expect, it } from 'vitest'
import { parseCreateBooking } from '../../server/booking'
const input=() => ({idempotencyKey:'booking-stable-test-key-0001',kind:'appointment' as const,employeeId:'booking-employee',serviceId:'service-quote',customerName:'Client inscrit',customerContact:'',note:'',startAt:'2026-11-05T10:00:00.000Z',endAt:'2026-11-05T10:30:00.000Z'})
it.each([null,[],{...input(),tenantId:'forged'},{...input(),idempotencyKey:'short'},{...input(),startAt:'2026-11-05T10:00'},{...input(),endAt:'2026-11-05T10:00:00.000Z'},{...input(),endAt:'2026-11-06T10:00:00.000Z'},{...input(),customerName:''}])('refuse une commande invalide sans SQL : %j',value => {
 expect(() => parseCreateBooking(value)).toThrow()
})
it('la migration SQL optionnelle correspond au registre sans données préremplies',async () => {
 const {BOOKING_SQL}=await import('../../server/bookingSchema')
 const {readFileSync}=await import('node:fs')
 expect(readFileSync('supabase/optional/008_booking.sql','utf8')).toBe(BOOKING_SQL.trim()+'\n')
 expect(BOOKING_SQL).toContain('FORCE ROW LEVEL SECURITY')
 expect(BOOKING_SQL).not.toMatch(/INSERT INTO bookings/i)
})
