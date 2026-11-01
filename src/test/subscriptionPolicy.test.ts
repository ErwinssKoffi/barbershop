import { expect,it } from 'vitest'
import { ESSENTIEL_V1,effectiveSubscription,parsePlanEntitlements,subscriptionMonthEnd } from '../domain/subscriptions'
import { marketplaceMigrationOptions } from '../../server/migrationOptions'
const window=()=>({startsAt:'2027-01-31T10:00:00.000Z',endsAt:'2027-02-28T10:00:00.000Z',graceEndsAt:'2027-03-03T10:00:00.000Z',revokedAt:null,entitlements:{...ESSENTIEL_V1.entitlements}})
it('forfait exact approuvé, sans réservation automatique',()=>{
 expect(ESSENTIEL_V1.priceXof).toBe(4900)
 expect(parsePlanEntitlements(ESSENTIEL_V1.entitlements)).toMatchObject({users:2,managers:1,cashiers:1,employees:5,galleryImages:3,publicServices:10,appointmentRequests:true,onlineBooking:false})
})
it('ancrage original : janvier vers février puis mars, année bissextile',()=>{
 const anchor='2027-01-31T10:00:00.000Z'
 expect(subscriptionMonthEnd(anchor,1,'Africa/Abidjan')).toBe('2027-02-28T10:00:00.000Z')
 expect(subscriptionMonthEnd(anchor,2,'Africa/Abidjan')).toBe('2027-03-31T10:00:00.000Z')
 expect(subscriptionMonthEnd('2028-01-31T10:00:00.000Z',1,'Africa/Abidjan')).toBe('2028-02-29T10:00:00.000Z')
 expect(subscriptionMonthEnd('2026-12-31T10:00:00.000Z',1,'Africa/Abidjan')).toBe('2027-01-31T10:00:00.000Z')
})
it('heure locale conservée avec DST normal ; ambiguïtés/trous refusés',()=>{
 expect(subscriptionMonthEnd('2026-02-15T09:00:00.000Z',2,'Europe/Paris')).toBe('2026-04-15T08:00:00.000Z')
 expect(()=>subscriptionMonthEnd('2026-01-29T01:30:00.000Z',2,'Europe/Paris')).toThrow(/Ambiguous/)
 expect(()=>subscriptionMonthEnd('2026-08-25T00:30:00.000Z',2,'Europe/Paris')).toThrow(/Ambiguous/)
 expect(()=>subscriptionMonthEnd('2027-01-31T10:00:00.000Z',0,'Africa/Abidjan')).toThrow()
})
it('bornes temporelles exclusives, grâce lecture seule, refus par défaut',()=>{
 const row=window()
 expect(effectiveSubscription(null,row.startsAt,true)).toMatchObject({state:'absent',canPublish:false})
 expect(effectiveSubscription(row,'2027-01-31T09:59:59.999Z',true).state).toBe('scheduled')
 expect(effectiveSubscription(row,row.startsAt,true)).toMatchObject({state:'active',canPublish:true,canUpload:true,canAppointmentRequest:true,canBook:false})
 expect(effectiveSubscription(row,row.endsAt,true)).toMatchObject({state:'grace',canKeepVisible:true,canPublish:false,canUpload:false,canContactRequest:false,canAppointmentRequest:false,quotas:null})
 expect(effectiveSubscription(row,row.graceEndsAt,true)).toMatchObject({state:'expired',canKeepVisible:false,canPublish:false})
 expect(effectiveSubscription({...row,revokedAt:row.startsAt},row.endsAt,true)).toMatchObject({state:'revoked',canKeepVisible:false})
 expect(effectiveSubscription(row,row.startsAt,false)).toMatchObject({state:'suspended',canPublish:false,canKeepVisible:false})
})
it.each([{galleryImages:'3'},{users:-1},{publicProfile:'true'},{onlineBooking:null},{employees:1.5},{unknown:true}])('quotas/droits mal typés refusés %j',change=>{
 expect(()=>parsePlanEntitlements({...ESSENTIEL_V1.entitlements,...change})).toThrow()
})
it('opt-in abonnements sans activation Marketplace implicite',()=>{
 expect(()=>marketplaceMigrationOptions(['--include-subscriptions'],undefined)).toThrow(/backup/)
 expect(marketplaceMigrationOptions(['--include-subscriptions'],'true')).toEqual({includeMarketplace:false,includeSubscriptions:true})
})
