import { expect, it } from 'vitest'
import { parseScheduleBlock, scheduleBlockInstant, scheduleBlockOverlaps, type PrivateBusyBlock } from '../domain/scheduleBlocks'
import { marketplaceMigrationOptions } from '../../server/migrationOptions'
const input=()=>({scope:'salon',employeeId:null,startAt:'2026-11-04T10:00:00Z',endAt:'2026-11-08T12:00:00Z',privateNote:''})
const busy=():PrivateBusyBlock=>({scope:'salon',employeeId:null,employeeRef:null,startAt:input().startAt,endAt:input().endAt,state:'active'})
it('intervalle UTC multijours canonique sans limite artificielle de huit heures',()=>{
  expect(parseScheduleBlock(input())).toEqual({...input(),startAt:'2026-11-04T10:00:00.000Z',endAt:'2026-11-08T12:00:00.000Z'})
  expect(parseScheduleBlock({...input(),scope:'employee',employeeId:'employee'}).employeeId).toBe('employee')
})
it.each(['2026-02-30T00:00:00Z','2026-11-01','2026-11-01T12:00:00','2026-11-01T12:00:00+00:00','infinity','2026-11-01T24:00:00Z','0000-01-01T00:00:00Z','2026-11-01T12:00:00.01Z'])('refuse instant ambigu/non canonique %s',value=>{
  expect(()=>scheduleBlockInstant(value)).toThrow()
})
it.each([{scope:'all'},{scope:'employee',employeeId:null},{scope:'salon',employeeId:'employee'},{scope:'employee',employeeId:''},{startAt:input().endAt},{endAt:input().startAt},{privateNote:'a'.repeat(1001)},{actorId:'forged'},{tenantId:'forged'},{state:'cancelled'}])('refuse entrée invalide %j',change=>{
  expect(()=>parseScheduleBlock({...input(),...change})).toThrow()
})
it('demi-ouvert : adjacence autorisée, intersection multijours réelle bloquée',()=>{
  expect(scheduleBlockOverlaps(busy(),'employee','2026-11-04T09:00:00Z','2026-11-04T10:00:00Z')).toBe(false)
  expect(scheduleBlockOverlaps(busy(),'employee','2026-11-08T12:00:00Z','2026-11-08T13:00:00Z')).toBe(false)
  expect(scheduleBlockOverlaps(busy(),'employee','2026-11-05T09:00:00Z','2026-11-05T10:00:00Z')).toBe(true)
  expect(scheduleBlockOverlaps({...busy(),state:'cancelled'},'employee','2026-11-05T09:00:00Z','2026-11-05T10:00:00Z')).toBe(false)
})
it('périmètre employé exact ; historique détaché jamais converti en bloc salon',()=>{
  const employee={...busy(),scope:'employee' as const,employeeId:'employee',employeeRef:'employee'}
  const from='2026-11-05T09:00:00Z',to='2026-11-05T10:00:00Z'
  expect(scheduleBlockOverlaps(employee,'employee',from,to)).toBe(true)
  expect(scheduleBlockOverlaps(employee,'another',from,to)).toBe(false)
  expect(scheduleBlockOverlaps({...employee,employeeId:null},'employee',from,to)).toBe(false)
  expect(()=>scheduleBlockOverlaps({...employee,employeeId:'forged'},'employee',from,to)).toThrow(/reference/)
  expect(()=>scheduleBlockOverlaps(employee,'employee',to,from)).toThrow(/interval/)
})
it('opt-in 015 isolé et approbation backup/restore obligatoire',()=>{
  expect(()=>marketplaceMigrationOptions(['--include-schedule-blocks'],undefined)).toThrow(/backup/)
  expect(marketplaceMigrationOptions(['--include-schedule-blocks'],'true')).toEqual({includeMarketplace:false,includeScheduleBlocks:true})
  expect(marketplaceMigrationOptions([],'true')).toEqual({includeMarketplace:false})
})
