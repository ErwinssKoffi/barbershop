import { expect, it } from 'vitest'
import type { ServiceCatalogItem } from '../domain/models'
import { bookingWithinPolicy, cancellationWithinPolicy, deriveServicePublication, parseBookingRules, publicBookingRulesDto, publicServiceDto, serviceFitsOpeningWindow } from '../domain/publicCatalog'
import { marketplaceMigrationOptions } from '../../server/migrationOptions'

const source = (): ServiceCatalogItem => ({ id:'real-source-in-test',name:'Prestation',description:'Description',referencePrice:1000,durationMinutes:30,isActive:true,variants:[{id:'variant-a',label:'Variante',price:1500,durationMinutes:45}],createdAt:'2026-11-01T00:00:00.000Z',updatedAt:'2026-11-01T00:00:00.000Z',commissionOverride:{mode:'rate',value:50},defaultConsumables:[{productId:'private-product',quantity:1}],categoryCode:'service' })
const rules = () => ({ onlineBookingEnabled:true,slotStepMinutes:15,minimumNoticeMinutes:60,horizonDays:30,bufferBeforeMinutes:5,bufferAfterMinutes:5,cancellationAllowed:true,cancellationNoticeMinutes:60,employeeChoiceAllowed:false,revision:1 })
it('prix et durée dérivés de la source réelle ou variante, sans commissions ni consommables',() => {
  const base=deriveServicePublication(source(),null,true)
  expect(base.priceXof).toBe(1000); expect(base.durationMinutes).toBe(30)
  const variant=deriveServicePublication(source(),'variant-a',true)
  expect(variant.priceXof).toBe(1500); expect(variant.durationMinutes).toBe(45)
  const dto=publicServiceDto({...variant,id:'opaque-offer'},rules(),true)
  expect(dto).toEqual({id:'opaque-offer',displayName:'Prestation — Variante',description:'Description',priceXof:1500,currency:'XOF',durationMinutes:45,bookable:true})
  expect(JSON.stringify(dto)).not.toMatch(/source|commission|Consumable|private-product/)
  expect(deriveServicePublication({...source(),variants:[{id:'variant-a',label:'Variante',price:1500}]},'variant-a',true).durationMinutes).toBe(30)
})
it('refuse source inactive, variante étrangère/ambiguë, prix invalide et durée absente pour booking',() => {
  expect(() => deriveServicePublication({...source(),isActive:false},null,true)).toThrow()
  expect(() => deriveServicePublication(source(),'foreign',true)).toThrow()
  const s=source(); s.variants=[s.variants![0],s.variants![0]]
  expect(() => deriveServicePublication(s,'variant-a',true)).toThrow()
  for (const price of [-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) expect(() => deriveServicePublication({...source(),referencePrice:price},null,true)).toThrow()
  for (const duration of [0,4,481,30.5]) expect(() => deriveServicePublication({...source(),durationMinutes:duration},null,true)).toThrow()
  expect(() => deriveServicePublication({...source(),durationMinutes:undefined},null,true)).toThrow()
  const listing=deriveServicePublication({...source(),durationMinutes:undefined},null,false)
  expect(listing.durationMinutes).toBeNull()
  expect(publicServiceDto({...listing,id:'opaque-offer'},rules(),true).bookable).toBe(false)
})
it('réservation indisponible si flag, intention ou règles absents/désactivés',() => {
  const row={...deriveServicePublication(source(),null,true),id:'offer'}
  expect(publicServiceDto(row,rules(),false).bookable).toBe(false)
  expect(publicServiceDto(row,null,true).bookable).toBe(false)
  expect(publicServiceDto(row,{...rules(),onlineBookingEnabled:false},true).bookable).toBe(false)
  expect(publicServiceDto({...row,bookingRequested:false},rules(),true).bookable).toBe(false)
})
it.each([null,{},[],{...rules(),slotStepMinutes:0},{...rules(),slotStepMinutes:1441},{...rules(),minimumNoticeMinutes:-1},{...rules(),horizonDays:0},{...rules(),bufferBeforeMinutes:-1},{...rules(),bufferAfterMinutes:1441},{...rules(),employeeChoiceAllowed:'true'},{...rules(),cancellationNoticeMinutes:Infinity},{...rules(),revision:0},{...rules(),tenantId:'forged'}])('règles explicites strictes : %j',input => {
  expect(() => parseBookingRules(input)).toThrow()
})
it('DTO des règles ne transmet pas les métadonnées/identités supplémentaires',() => {
  expect(publicBookingRulesDto({...rules(),tenantId:'not-public',privateNote:'secret'} as ReturnType<typeof rules>)).toEqual(rules())
})
it('pas de créneau ancré à minuit et durée + buffers dans la même fenêtre, pas à travers une pause',() => {
  const windows=[{startMinute:540,endMinute:720},{startMinute:780,endMinute:1020}]
  expect(serviceFitsOpeningWindow(555,30,windows,rules())).toBe(true)
  expect(serviceFitsOpeningWindow(540,30,windows,rules())).toBe(false)
  expect(serviceFitsOpeningWindow(556,30,windows,rules())).toBe(false)
  expect(serviceFitsOpeningWindow(690,30,windows,rules())).toBe(false)
  expect(serviceFitsOpeningWindow(690,120,windows,rules())).toBe(false)
  expect(serviceFitsOpeningWindow(555,30,[],rules())).toBe(false)
  expect(serviceFitsOpeningWindow(555,30,windows,{...rules(),onlineBookingEnabled:false})).toBe(false)
  expect(serviceFitsOpeningWindow(555,30,windows,{...rules(),bufferBeforeMinutes:1440})).toBe(false)
})
it('délai minimum inclusif en UTC, horizon inclusif en dates locales sans confondre DST et 24 heures',() => {
  const now='2026-11-01T10:00:00.000Z'
  expect(bookingWithinPolicy('2026-11-01T11:00:00.000Z',now,'2026-11-01','2026-11-01',rules())).toBe(true)
  expect(bookingWithinPolicy('2026-11-01T10:59:59.999Z',now,'2026-11-01','2026-11-01',rules())).toBe(false)
  expect(bookingWithinPolicy('2026-12-01T11:00:00.000Z',now,'2026-12-01','2026-11-01',rules())).toBe(true)
  expect(bookingWithinPolicy('2026-12-02T11:00:00.000Z',now,'2026-12-02','2026-11-01',rules())).toBe(false)
  expect(bookingWithinPolicy('2026-11-01T11:00:00.000Z',now,'2026-10-31','2026-11-01',rules())).toBe(false)
  expect(bookingWithinPolicy('2026-11-01T11:00:00.000Z',now,'2026-11-01','2026-11-01',{...rules(),onlineBookingEnabled:false})).toBe(false)
  expect(() => bookingWithinPolicy('2026-11-01T11:00',now,'2026-11-01','2026-11-01',rules())).toThrow()
  expect(bookingWithinPolicy('2026-11-01T11:00:00.000Z',now,'2026-11-01','2026-11-01',{...rules(),minimumNoticeMinutes:2147483647})).toBe(false)
})
it('annulation : politique explicite et seuil inclusif ; pas de dépendance au flag nouvelles réservations',() => {
  const now='2026-11-01T10:00:00.000Z'
  expect(cancellationWithinPolicy('2026-11-01T11:00:00.000Z',now,{...rules(),onlineBookingEnabled:false})).toBe(true)
  expect(cancellationWithinPolicy('2026-11-01T10:59:59.999Z',now,rules())).toBe(false)
  expect(cancellationWithinPolicy('2026-11-01T11:00:00.000Z',now,{...rules(),cancellationAllowed:false})).toBe(false)
})
it('opt-in catalogue indépendant, protégé par backup/restore sans changer les opt-ins existants',() => {
  expect(() => marketplaceMigrationOptions(['--include-public-catalog'],undefined)).toThrow(/backup/)
  expect(marketplaceMigrationOptions(['--include-public-catalog'],'true')).toEqual({includeMarketplace:true,includePublicCatalog:true})
  expect(marketplaceMigrationOptions(['--include-scheduling'],'true')).toEqual({includeMarketplace:true,includeScheduling:true})
  expect(marketplaceMigrationOptions(['--include-marketplace'],'true')).toEqual({includeMarketplace:true})
})
