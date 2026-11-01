import { readPlatformActivationFile,parseActivationCliArgs } from './platformActivationFiles.ts'
import pg from 'pg'
import { loadServerEnvironment } from './serverEnvironment.ts'
import { databasePoolConfig } from './neonClient.ts'
import { runPlatformActivation } from './platformActivation.ts'
const args=process.argv.slice(2)
if(args.length===1 && args[0]==='--help') {
 console.info('Opérateur privé : npm run platform:activate -- --file <nom.json> [--execute --confirm-external-verification]. Fichier dans .platform-activation/ (0700), fichier 0600. Aperçu sans écriture par défaut. Connexion dédiée SALON_PLATFORM_DATABASE_URL et SALON_PLATFORM_ACTIVATION_ENABLED=true requis. Ne jamais fournir de secret en argument.')
} else {
 let pool:pg.Pool|undefined
 try {
  loadServerEnvironment()
  const {fileName,execute}=parseActivationCliArgs(args)
  if(process.env.SALON_PLATFORM_ACTIVATION_ENABLED!=='true' || !process.env.SALON_PLATFORM_DATABASE_URL)throw new Error('Private operator configuration required')
  const body=readPlatformActivationFile(fileName)
  pool=new pg.Pool({...databasePoolConfig(process.env.SALON_PLATFORM_DATABASE_URL),options:'-c search_path=salon_pro',max:1})
  const result=await runPlatformActivation(pool,body,execute)
  console.info(JSON.stringify(result))
 } catch {
  console.error('Activation non confirmée. Vérifiez syntaxe, fichier privé, identité dédiée, migrations, justificatif et conflits. Après résultat incertain, réutilisez le même fichier et la même clé ; ne créez pas une nouvelle intention. Aucun détail de connexion ou justificatif journalisé.')
  process.exitCode=1
 } finally {await pool?.end()}
}
