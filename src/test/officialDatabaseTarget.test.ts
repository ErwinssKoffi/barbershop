import { afterEach,expect,it,vi } from 'vitest'
import { assertOfficialDatabaseTarget,OFFICIAL_DATABASE_TARGET } from '../../server/officialDatabaseTarget'
import { databasePoolConfig } from '../../server/neonClient'
afterEach(()=>vi.unstubAllEnvs())
it('cible officielle sans secret, URL API distincte de la connexion PostgreSQL',()=>{
 expect(OFFICIAL_DATABASE_TARGET).toEqual({projectRef:'pfiuujyybxtpoetdkmbc',apiUrl:'https://pfiuujyybxtpoetdkmbc.supabase.co',schema:'salon_pro'})
 expect(()=>databasePoolConfig(OFFICIAL_DATABASE_TARGET.apiUrl)).toThrow(/PostgreSQL/)
})
it('connexion directe ou pooler du projet acceptés ; schéma privé et TLS conservés',()=>{
 vi.stubEnv('SALON_SUPABASE_PROJECT_REF',OFFICIAL_DATABASE_TARGET.projectRef)
 for(const url of ['postgresql://operator@db.pfiuujyybxtpoetdkmbc.supabase.co/postgres','postgresql://operator.pfiuujyybxtpoetdkmbc@aws-0-eu-west-1.pooler.supabase.com:5432/postgres']) {
  expect(databasePoolConfig(url)).toMatchObject({options:'-c search_path=salon_pro',ssl:{rejectUnauthorized:true}})
 }
})
it('mauvais projet, faux domaine, mauvais login pooler et référence erronée refusés',()=>{
 vi.stubEnv('SALON_SUPABASE_PROJECT_REF',OFFICIAL_DATABASE_TARGET.projectRef)
 for(const url of ['postgresql://operator@localhost/postgres','postgresql://operator@db.other.supabase.co/postgres','postgresql://operator.other@aws-0-eu-west-1.pooler.supabase.com/postgres','postgresql://operator.pfiuujyybxtpoetdkmbc@pooler.supabase.com.evil.invalid/postgres'])expect(()=>databasePoolConfig(url)).toThrow(/officiel/)
 expect(()=>assertOfficialDatabaseTarget(new URL('postgresql://operator@localhost/postgres'),'other')).toThrow(/officiel/)
})
it('tests isolés sans verrou de cible conservent la connexion locale',()=>{
 vi.stubEnv('SALON_SUPABASE_PROJECT_REF','')
 expect(databasePoolConfig('postgresql://operator@localhost/postgres')).toMatchObject({ssl:false})
})
