import { randomUUID } from 'node:crypto'
import type { SqlPoolLike } from './neonClient.ts'
import { originalMediaKey,variantMediaKey,type MediaMime } from '../src/domain/media.ts'
import { parseMediaProcessingPolicy,type MediaProcessingPolicy } from './mediaProcessingPolicy.ts'
import { MediaProcessingError,processMediaImage } from './mediaProcessor.ts'
import type { PrivateMediaStorage,MediaObjectScope } from './mediaStorage.ts'
export interface MediaProcessingResult {outcome:'ready'|'already_ready'|'rejected';mediaId:string;version:number}
/** Awaited private worker primitive. Not an HTTP upload endpoint or a durable queue consumer. */
export async function processStoredMedia(pool:SqlPoolLike,storage:PrivateMediaStorage,scope:MediaObjectScope,inputPolicy:MediaProcessingPolicy):Promise<MediaProcessingResult> {
 if(storage.kind==='test-memory' && process.env.NODE_ENV==='production')throw new Error('Test storage forbidden in production')
 const policy=parseMediaProcessingPolicy(inputPolicy)
 originalMediaKey(scope.tenantId,scope.mediaId)
 const db=await pool.connect(),signal=AbortSignal.timeout(policy.wallTimeoutMs)
 let committed=false,commitAttempted=false,uploadedVariant:string|undefined
 try {
  await db.query('BEGIN')
  await db.query("SET LOCAL lock_timeout='5000ms'");await db.query("SET LOCAL statement_timeout='10000ms'")
  await db.query("SELECT set_config('role','salon_pro_media_' || substr(md5(current_schema()),1,12),true)")
  await db.query("SELECT set_config('app.tenant_id',$1,true)",[scope.tenantId])
  const row=(await db.query<{state:string;version:number;profile_id:string;declared_mime:MediaMime;declared_bytes:string|number;expired:boolean}>(`SELECT state,version,profile_id,declared_mime,declared_bytes,upload_expires_at<=clock_timestamp() AS expired
   FROM salon_media WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[scope.tenantId,scope.mediaId])).rows[0]
  if(!row)throw new Error('Private media unavailable')
  const finish=async(outcome:MediaProcessingResult['outcome'],version:number)=>{commitAttempted=true;await db.query('COMMIT');committed=true;return {outcome,mediaId:scope.mediaId,version}}
  if(row.state==='ready')return await finish('already_ready',row.version)
  if(row.state!=='pending')throw new Error('Media state unavailable for processing')
  if(row.expired){await db.query("UPDATE salon_media SET state='rejected',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",[scope.tenantId,scope.mediaId]);return await finish('rejected',row.version+1)}
  await db.query("UPDATE salon_media SET state='processing',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",[scope.tenantId,scope.mediaId])
  signal.throwIfAborted()
  const original=await storage.readOriginal(scope,policy.input.maxBytes,signal)
  let image
  try{image=await processMediaImage(original,row.declared_mime,Number(row.declared_bytes),policy,signal)}
  catch(error){
   if(error instanceof MediaProcessingError && error.code==='INVALID_IMAGE'){
    await db.query("UPDATE salon_media SET state='rejected',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",[scope.tenantId,scope.mediaId])
    return await finish('rejected',row.version+2)
   }
   throw error
  }
  signal.throwIfAborted()
  const variant=randomUUID()
  // Mark the attempted object as compensatable even if its provider acknowledgement is lost.
  uploadedVariant=variant
  const stored=await storage.putVariantOnce(scope,variant,image.bytes,signal)
  if(stored.byteSize!==image.variant.byteSize || stored.sha256!==image.variant.sha256)throw new Error('Variant storage verification failed')
  signal.throwIfAborted()
  await db.query(`INSERT INTO salon_media_variants(tenant_id,id,profile_id,media_id,object_key,mime,byte_size,width,height,sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[scope.tenantId,variant,row.profile_id,scope.mediaId,variantMediaKey(scope.tenantId,scope.mediaId,variant),image.variant.mime,image.variant.byteSize,image.variant.width,image.variant.height,image.variant.sha256])
  await db.query(`UPDATE salon_media SET state='ready',actual_mime=$3,actual_bytes=$4,width=$5,height=$6,sha256=$7,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2`,[scope.tenantId,scope.mediaId,image.evidence.actualMime,image.evidence.actualBytes,image.evidence.width,image.evidence.height,image.evidence.sha256])
  return await finish('ready',row.version+2)
 } catch {
  try{await db.query('ROLLBACK')}catch{/* Lost connection: never assume COMMIT failed. */}
  if(uploadedVariant && !commitAttempted){try{await storage.removeVariant(scope,uploadedVariant,AbortSignal.timeout(5000))}catch{/* Private orphan: future reconciliation must compare DB references before purge. */}}
  throw new Error(commitAttempted&&!committed?'Media outcome uncertain; reconcile before retry.':'Media processing unavailable; original remains private.')
 } finally {db.release()}
}
