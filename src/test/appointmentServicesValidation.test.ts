import { expect, it } from 'vitest'
import { appointmentServiceDto, appointmentServiceTotals, type AppointmentServiceSnapshot } from '../domain/appointmentServices'
import { marketplaceMigrationOptions } from '../../server/migrationOptions'
const row=():AppointmentServiceSnapshot=>({position:1,sourceServiceId:'service',sourceVariantId:null,serviceName:'Prestation',variantLabel:null,priceXof:1000,durationMinutes:30})
it('DTO privé explicite sans tenant, acteur ou champ injecté',()=>{
  expect(appointmentServiceDto({...row(),tenantId:'private',actorId:'private',customerContact:'private'} as AppointmentServiceSnapshot)).toEqual(row())
})
it('total historique entier, sans calcul financier implicite',()=>{
  expect(appointmentServiceTotals([row(),{...row(),position:2,priceXof:2000,durationMinutes:45}])).toEqual({priceXof:3000,durationMinutes:75})
  expect(appointmentServiceTotals([{...row(),priceXof:Number.MAX_SAFE_INTEGER}]).priceXof).toBe(Number.MAX_SAFE_INTEGER)
  expect(()=>appointmentServiceTotals([{...row(),priceXof:Number.MAX_SAFE_INTEGER},{...row(),position:2}])).toThrow(/bounds/)
  expect(()=>appointmentServiceTotals([{...row(),durationMinutes:480},{...row(),position:2}])).toThrow(/bounds/)
})
it.each([{priceXof:1.5},{priceXof:-1},{priceXof:Infinity},{position:0},{position:101},{durationMinutes:4},{durationMinutes:481},{durationMinutes:30.5},{serviceName:' '},{sourceServiceId:''},{sourceVariantId:'variant',variantLabel:null}])('rejette snapshot invalide %j',change=>{
  expect(()=>appointmentServiceDto({...row(),...change})).toThrow()
})
it('variantes cohérentes, cardinalité et unicité des positions',()=>{
  expect(appointmentServiceDto({...row(),sourceVariantId:'variant',variantLabel:'Variante'}).variantLabel).toBe('Variante')
  expect(()=>appointmentServiceTotals([])).toThrow(/count/)
  expect(()=>appointmentServiceTotals(Array.from({length:101},()=>row()))).toThrow(/count/)
  expect(()=>appointmentServiceTotals([row(),row()])).toThrow(/position/)
})
it('opt-in exige les deux approbations backup/restore, sans activer Marketplace',()=>{
  expect(()=>marketplaceMigrationOptions(['--include-appointment-services'],undefined)).toThrow(/Booking backup/)
  expect(()=>marketplaceMigrationOptions(['--include-appointment-services'],'true')).toThrow(/Booking backup/)
  expect(()=>marketplaceMigrationOptions(['--include-appointment-services'],undefined,'true')).toThrow(/snapshot backup/)
  expect(marketplaceMigrationOptions(['--include-appointment-services'],'true','true')).toEqual({includeMarketplace:false,includeAppointmentServices:true})
})
