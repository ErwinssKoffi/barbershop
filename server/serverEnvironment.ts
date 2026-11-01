import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'dotenv'

type EnvironmentOptions = {root?:string;mode?:string;environment?:NodeJS.ProcessEnv}
/** Private snapshot for diagnostics; includes public keys for leak/flag checks. Never log this object. */
export function resolveServerEnvironment(options:EnvironmentOptions={}):NodeJS.ProcessEnv {
 const root=options.root ?? process.cwd()
 const environment=options.environment ?? process.env
 const mode=options.mode ?? environment.NODE_ENV ?? 'development'
 if(!/^[a-zA-Z0-9_-]+$/.test(mode) || mode==='local') throw new Error('Mode environnement serveur invalide.')
 const values:Record<string,string>={}
 for(const name of ['.env','.env.local',`.env.${mode}`,`.env.${mode}.local`]) {
  const path=resolve(root,name)
  if(existsSync(path)) Object.assign(values,parse(readFileSync(path)))
 }
 return {...values,...Object.fromEntries(Object.entries(environment).filter(([,value]) => value!==undefined))}
}

/** Server-only dotenv layers. Never return secrets to Vite's client define/env objects. */
export function loadServerEnvironment(options:EnvironmentOptions={}):void {
 const environment=options.environment ?? process.env
 for(const [key,value] of Object.entries(resolveServerEnvironment(options))) {
  // Vite owns public VITE_* values; deployment-level variables always win, including blank ones.
  if(!key.startsWith('VITE_') && environment[key]===undefined) environment[key]=value
 }
}
