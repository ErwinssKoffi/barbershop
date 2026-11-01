import { createHash } from 'node:crypto'
import type { SqlPoolLike } from './neonClient.ts'
export interface PlatformActivationCommand {
 activationKey:string;tenantId:string;billingAnchorAt:string;periodIndex:number;evidenceNamespace:string
 externalReference:string;evidenceReference:string;verificationReason:string;verifiedAmountXof:4900;externalVerificationConfirmed:boolean
}
export function parsePlatformActivation(input:unknown):PlatformActivationCommand {
 if(!input || typeof input!=='object' || Array.isArray(input))throw new Error('Invalid activation command')
 const r=input as Record<string,unknown>
 const keys=['activationKey','tenantId','billingAnchorAt','periodIndex','evidenceNamespace','externalReference','evidenceReference','verificationReason','verifiedAmountXof','externalVerificationConfirmed']
 if(Object.keys(r).length!==keys.length || Object.keys(r).some(k=>!keys.includes(k)))throw new Error('Unknown activation field')
 const text=(key:string,max:number)=>{const v=r[key];if(typeof v!=='string' || !v.trim() || v!==v.trim() || v.length>max || Array.from(v).some(c=>c.charCodeAt(0)<32 || c.charCodeAt(0)===127))throw new Error('Invalid activation text');return v}
 const uuid=(key:string)=>{const v=text(key,36);if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))throw new Error('Canonical UUID required');return v}
 const anchor=text('billingAnchorAt',24)
 if(!/^(?!0000)\d{4}-/.test(anchor) || !Number.isFinite(Date.parse(anchor)) || new Date(anchor).toISOString()!==anchor)throw new Error('Canonical UTC anchor required')
 const namespace=text('evidenceNamespace',40)
 if(!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(namespace) || !Number.isInteger(r.periodIndex) || Number(r.periodIndex)<0 || Number(r.periodIndex)>1199 || r.verifiedAmountXof!==4900 || typeof r.externalVerificationConfirmed!=='boolean')throw new Error('Invalid attestation')
 const evidence=text('evidenceReference',500)
 if(evidence.includes('://'))throw new Error('Use opaque evidence reference, not a URL')
 return {activationKey:uuid('activationKey'),tenantId:uuid('tenantId'),billingAnchorAt:anchor,periodIndex:Number(r.periodIndex),evidenceNamespace:namespace,externalReference:text('externalReference',120),evidenceReference:evidence,verificationReason:text('verificationReason',500),verifiedAmountXof:4900,externalVerificationConfirmed:r.externalVerificationConfirmed}
}
export interface PlatformActivationResult {outcome:'preview'|'activated'|'replayed';tenantId:string;activationKey:string;startsAt:string;endsAt:string;graceEndsAt:string}
export async function runPlatformActivation(pool:SqlPoolLike,input:unknown,execute=false,schema='salon_pro'):Promise<PlatformActivationResult> {
 const command=parsePlatformActivation(input)
 if(typeof execute!=='boolean' || (execute && !command.externalVerificationConfirmed))throw new Error('Explicit external verification attestation required')
 if(!/^[a-z_][a-z0-9_]{0,62}$/.test(schema))throw new Error('Invalid private schema')
 const db=await pool.connect()
 try {
  await db.query('BEGIN')
  await db.query("SET LOCAL lock_timeout='5000ms'");await db.query("SET LOCAL statement_timeout='15000ms'")
  const role='salon_pro_platform_'+createHash('md5').update(schema).digest('hex').slice(0,12)
  await db.query(`SET LOCAL ROLE "${role}"`)
  await db.query("SELECT set_config('search_path',$1,true)",[schema])
  const result=(await db.query<{result:PlatformActivationResult}>('SELECT activate_essential_subscription($1::jsonb,$2::boolean) AS result',[JSON.stringify(command),execute])).rows[0]?.result
  if(!result || !['preview','activated','replayed'].includes(result.outcome) || result.tenantId!==command.tenantId || result.activationKey!==command.activationKey || [result.startsAt,result.endsAt,result.graceEndsAt].some(v=>typeof v!=='string' || !Number.isFinite(Date.parse(v))))throw new Error('Invalid activation result')
  await db.query(execute?'COMMIT':'ROLLBACK')
  return result
 } catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}
