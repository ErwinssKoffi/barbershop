import { expect, it } from 'vitest'
import { openingWindowsForDate, openingWindowsSqlValue, parseOpeningWindows, parseScheduleDate, publicScheduleDto } from '../domain/scheduling'
import { marketplaceMigrationOptions } from '../../server/migrationOptions'

it.each([null, {}, [null], [{ startMinute: -1, endMinute: 20 }], [{ startMinute: 60, endMinute: 60 }], [{ startMinute: 0, endMinute: 1441 }], [{ startMinute: '60', endMinute: 120 }], [{ startMinute: 0.5, endMinute: 2 }], [{ startMinute: 0, endMinute: Infinity }], [{ startMinute: 60, endMinute: 120, tenantId: 'forged' }]])('refuse les horaires invalides : %j', input => {
  expect(() => parseOpeningWindows(input)).toThrow()
})
it('canonise sans muter, conserve la pause, refuse chevauchements et doubles fenêtres', () => {
  const input = [{ startMinute: 780, endMinute: 1020 }, { startMinute: 600, endMinute: 720 }, { startMinute: 540, endMinute: 600 }]
  const before = JSON.stringify(input)
  expect(parseOpeningWindows(input)).toEqual([{ startMinute: 540, endMinute: 720 }, { startMinute: 780, endMinute: 1020 }])
  expect(openingWindowsSqlValue(input)).toBe('{[540,720),[780,1020)}')
  expect(JSON.stringify(input)).toBe(before)
  expect(openingWindowsSqlValue([])).toBe('{}')
  expect(openingWindowsSqlValue([{ startMinute: 0, endMinute: 1440 }])).toBe('{[0,1440)}')
  for (const next of [{ startMinute: 550, endMinute: 650 }, { startMinute: 540, endMinute: 600 }]) {
    expect(() => parseOpeningWindows([{ startMinute: 540, endMinute: 600 },next])).toThrow(/Overlapping/)
  }
})
it.each(['2026-02-30','2026-13-01','2026-11-01T00:00:00Z','0000-01-01','infinity','2026-1-1',null])('refuse les fausses dates locales : %j', date => {
  expect(() => parseScheduleDate(date)).toThrow()
})
it('exception remplace la journée entière et une fermeture ne retombe jamais sur la semaine', () => {
  const weekly = [{ isoWeekday: 1, windows: [{ startMinute: 540, endMinute: 1020 }] }]
  expect(openingWindowsForDate('2026-11-09',weekly,[])).toEqual(weekly[0].windows)
  expect(openingWindowsForDate('2026-11-09',weekly,[{ localDate: '2026-11-09', windows: [] }])).toEqual([])
  expect(openingWindowsForDate('2026-11-09',weekly,[{ localDate: '2026-11-09', windows: [{ startMinute: 600,endMinute: 720 }] }])).toEqual([{ startMinute: 600,endMinute: 720 }])
  expect(openingWindowsForDate('2026-11-10',weekly,[])).toEqual([])
  expect(() => openingWindowsForDate('2026-11-09',[...weekly,...weekly],[])).toThrow(/Duplicate/)
  expect(() => openingWindowsForDate('2026-11-09',weekly,[{ localDate: '2026-11-09', windows: [] },{ localDate: '2026-11-09', windows: [] }])).toThrow(/Duplicate/)
  expect(parseScheduleDate('2028-02-29')).toBe('2028-02-29')
})
it('jours ISO : dimanche=7 et horaires locaux indépendants du fuseau de l’appareil', () => {
  expect(openingWindowsForDate('2026-11-08',[{ isoWeekday: 7,windows: [{ startMinute: 0,endMinute: 60 }] }],[])).toEqual([{ startMinute: 0,endMinute: 60 }])
})
it('DTO public retire notes/identités et valide fuseau, révision et cardinalités', () => {
  const input = { timezone: 'Africa/Abidjan', revision: 1, tenantId: 'not-public', weekly: [{ isoWeekday: 1,windows: [], authorId: 'secret' }], exceptions: [{ localDate: '2026-11-09',windows: [],privateNote: 'Raison confidentielle' }] }
  expect(publicScheduleDto(input)).toEqual({ timezone: 'Africa/Abidjan',revision: 1,weekly: [{ isoWeekday: 1,windows: [] }],exceptions: [{ localDate: '2026-11-09',windows: [] }] })
  expect(() => publicScheduleDto({ ...input,timezone: 'Not/A-Timezone' })).toThrow(/timezone/)
  expect(() => publicScheduleDto({ ...input,revision: 0 })).toThrow()
  expect(() => publicScheduleDto({ ...input,weekly: [...input.weekly,...input.weekly] })).toThrow()
  expect(() => publicScheduleDto({ ...input,exceptions: [...input.exceptions,...input.exceptions] })).toThrow()
})
it('opt-in horaires exige backup/restore et implique le profil sans activer les autres modules', () => {
  expect(() => marketplaceMigrationOptions(['--include-scheduling'],undefined)).toThrow(/backup/)
  expect(() => marketplaceMigrationOptions(['--include-scheduling'],'false')).toThrow(/backup/)
  expect(marketplaceMigrationOptions(['--include-scheduling'],'true')).toEqual({ includeMarketplace: true,includeScheduling: true })
  expect(marketplaceMigrationOptions(['--include-marketplace'],'true')).toEqual({ includeMarketplace: true })
  expect(marketplaceMigrationOptions([],'true')).toEqual({ includeMarketplace: false })
})
