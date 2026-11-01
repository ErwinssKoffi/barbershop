import { expect,it } from 'vitest'
import { emptyVisibilityWeek,parseVisibilityConfig,parseWindowText,windowText } from '../domain/visibilityConfig'
import { marketplaceMigrationOptions } from '../../server/migrationOptions'
const config=()=>({expectedVersion:1,services:[],weekly:emptyVisibilityWeek(),exceptions:[]})
it('sept journées fermées par défaut, pas d’horaires inventés',()=>{expect(parseVisibilityConfig(config())).toEqual(config())})
it('horaires texte, coupures, adjacences fusionnées et 24:00',()=>{
 expect(parseWindowText('')).toEqual([])
 expect(windowText(parseWindowText('09:00-12:00,12:00-14:00,18:00-24:00'))).toBe('09:00-14:00,18:00-24:00')
})
it.each(['09:00-08:00','24:00-24:00','09:60-12:00','9:00-12:00','09:00-12:00,11:00-13:00','09:00','09:00-12:00-13:00'])('refuse horaire invalide %s',text=>{expect(()=>parseWindowText(text)).toThrow()})
it('refuse champs et doublons de sélection ou de journée',()=>{
 const choice={serviceId:'service',variantId:null}
 for(const change of [{tenantId:'forged'},{expectedVersion:0},{weekly:[]},{weekly:Array(7).fill({isoWeekday:1,windows:[]})},{services:[choice,choice]},{services:[{...choice,priceXof:1}]},{exceptions:[{localDate:'2026-02-30',windows:[]}]},{exceptions:[{localDate:'2026-01-01',windows:[]},{localDate:'2026-01-01',windows:[]}]}])expect(()=>parseVisibilityConfig({...config(),...change})).toThrow()
})
it('opt-in éditeur exige sauvegarde/restauration',()=>{
 expect(()=>marketplaceMigrationOptions(['--include-visibility-editor'],undefined)).toThrow(/backup/)
 expect(marketplaceMigrationOptions(['--include-visibility-editor'],'true')).toEqual({includeMarketplace:true,includeVisibilityEditor:true})
})
