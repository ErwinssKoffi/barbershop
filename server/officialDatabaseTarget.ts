/** Non-secret official project identity. Never use the API URL as a PostgreSQL DSN. */
export const OFFICIAL_DATABASE_TARGET={projectRef:'pfiuujyybxtpoetdkmbc',apiUrl:'https://pfiuujyybxtpoetdkmbc.supabase.co',schema:'salon_pro'} as const
/** Enabled explicitly on production; isolated test databases do not set this variable. */
export function assertOfficialDatabaseTarget(url:URL,expected=process.env.SALON_SUPABASE_PROJECT_REF):void {
 if(!expected)return
 if(expected!==OFFICIAL_DATABASE_TARGET.projectRef)throw new Error('Projet PostgreSQL officiel invalide.')
 const direct=url.hostname===`db.${expected}.supabase.co`
 const pooler=url.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(url.username).endsWith(`.${expected}`)
 if(!direct && !pooler)throw new Error('Connexion hors du projet PostgreSQL officiel refusée.')
}
