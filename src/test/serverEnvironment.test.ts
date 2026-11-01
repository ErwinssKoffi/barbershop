import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadServerEnvironment, resolveServerEnvironment } from '../../server/serverEnvironment'
import { checkDatabase } from '../../server/checkDatabase'
import type { SqlPoolLike } from '../../server/neonClient'
import { createPostgresTestPool } from './postgresTestPool'
import { runMigrations } from '../../server/migrations'

const directories:string[]=[]
function directory() {const root=mkdtempSync(join(tmpdir(),'salon-env-'));directories.push(root);return root}
afterEach(() => {for(const root of directories) rmSync(root,{recursive:true,force:true});directories.length=0})
it('charge .env.local côté serveur, sans ajouter les variables VITE publiques',() => {
 const root=directory();const environment:NodeJS.ProcessEnv={}
 writeFileSync(join(root,'.env'),'SUPABASE_DATABASE_URL=postgresql://account@base.invalid/db\nVITE_SERVER_CHECKOUT=true\n')
 writeFileSync(join(root,'.env.local'),'SUPABASE_DATABASE_URL=postgresql://account@local.invalid/db\n')
 loadServerEnvironment({root,environment,mode:'development'})
 expect(environment.SUPABASE_DATABASE_URL).toBe('postgresql://account@local.invalid/db')
 expect(environment.VITE_SERVER_CHECKOUT).toBeUndefined()
})
it('respecte la priorité des modes et des variables injectées par l’hébergement, même vides',() => {
 const root=directory();const environment:NodeJS.ProcessEnv={DATABASE_URL:'',SALON_CHECKOUT_SYNC_MODE:'legacy'}
 writeFileSync(join(root,'.env'),'DATABASE_URL=postgresql://account@base.invalid/db\nSUPABASE_DATABASE_URL=base\n')
 writeFileSync(join(root,'.env.local'),'SUPABASE_DATABASE_URL=local\n')
 writeFileSync(join(root,'.env.production'),'SUPABASE_DATABASE_URL=production\n')
 writeFileSync(join(root,'.env.production.local'),'SUPABASE_DATABASE_URL=production-local\nSALON_CHECKOUT_SYNC_MODE=enforced\n')
 loadServerEnvironment({root,environment,mode:'production'})
 expect(environment).toMatchObject({DATABASE_URL:'',SUPABASE_DATABASE_URL:'production-local',SALON_CHECKOUT_SYNC_MODE:'legacy'})
})
it('sans fichier, aucune valeur ou donnée n’est inventée ; refuse les modes chemins',() => {
 const root=directory();const environment:NodeJS.ProcessEnv={}
 loadServerEnvironment({root,environment});expect(environment).toEqual({})
 expect(() => loadServerEnvironment({root,environment,mode:'../private'})).toThrow()
 expect(() => loadServerEnvironment({root,environment,mode:'local'})).toThrow()
})
it('db:check distingue configuration absente, connexion inaccessible et absence du schéma',async () => {
 expect(await checkDatabase(null)).toEqual({status:'missing_configuration',checkoutReady:false,refundsReady:false})
 const failed:SqlPoolLike={query:async () => {throw new Error('private URL must never be returned')},connect:async () => {throw new Error('private URL must never be returned')}}
 expect(await checkDatabase(failed)).toEqual({status:'check_failed',checkoutReady:false,refundsReady:false})
 const {pool}=createPostgresTestPool()
 expect((await checkDatabase(pool)).status).toBe('schema_missing')
 expect((await pool.query("SELECT to_regclass('schema_migrations') AS name")).rows[0]).toEqual({name:null})
})
it('db:check vérifie les migrations existantes en lecture seule, sans activer 006 ou 007',async () => {
 const {pool}=createPostgresTestPool();await runMigrations(pool)
 const before=(await pool.query('SELECT id FROM schema_migrations ORDER BY id')).rows
 expect(await checkDatabase(pool)).toEqual({status:'ready',checkoutReady:false,refundsReady:false})
 expect((await pool.query('SELECT id FROM schema_migrations ORDER BY id')).rows).toEqual(before)
 await runMigrations(pool,{includeRefunds:true})
 expect(await checkDatabase(pool)).toEqual({status:'ready',checkoutReady:true,refundsReady:true})
})
it('db:check reste non prêt si la baseline est incomplète',async () => {
 const {pool}=createPostgresTestPool()
 await pool.query('CREATE TABLE schema_migrations(id text)')
 await pool.query("INSERT INTO schema_migrations(id) VALUES('001_baseline')")
 expect((await checkDatabase(pool)).status).toBe('baseline_incomplete')
})

it('la recette lit les pilotes publics des fichiers sans les injecter ni exposer les secrets',() => {
 const root=directory();const environment:NodeJS.ProcessEnv={VITE_SERVER_CHECKOUT:'false'}
 writeFileSync(join(root,'.env.local'),'VITE_SERVER_CHECKOUT=true\nVITE_DATABASE_URL=must-not-be-public\n')
 const snapshot=resolveServerEnvironment({root,environment})
 expect(snapshot.VITE_SERVER_CHECKOUT).toBe('false')
 expect(snapshot.VITE_DATABASE_URL).toBe('must-not-be-public')
 loadServerEnvironment({root,environment})
 expect(environment.VITE_DATABASE_URL).toBeUndefined()
})
