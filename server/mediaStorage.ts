import { createHash } from 'node:crypto'
import { originalMediaKey,variantMediaKey } from '../src/domain/media.ts'
export interface MediaObjectScope {tenantId:string;mediaId:string}
export interface PrivateMediaStorage {
 /** All operations are server-only and tenant-bound. No public URL or arbitrary key API. */
 readonly kind:'production'|'test-memory'
 readOriginal(scope:MediaObjectScope,maxBytes:number,signal:AbortSignal):Promise<Uint8Array>
 putVariantOnce(scope:MediaObjectScope,variantId:string,bytes:Uint8Array,signal:AbortSignal):Promise<{byteSize:number;sha256:string}>
 removeVariant(scope:MediaObjectScope,variantId:string,signal:AbortSignal):Promise<void>
}
/** Ephemeral test adapter only. No filesystem, network, signature or production fallback. */
export function createMemoryMediaTestStorage(authorizedTenant:string,maxObjects:number,maxBytes:number) {
 originalMediaKey(authorizedTenant,authorizedTenant)
 if(!Number.isSafeInteger(maxObjects) || maxObjects<1 || maxObjects>100 || !Number.isSafeInteger(maxBytes) || maxBytes<1 || maxBytes>16777216)throw new Error('Bounded test storage required')
 const objects=new Map<string,Buffer>()
 const scope=(value:MediaObjectScope)=>{if(value.tenantId!==authorizedTenant)throw new Error('Storage tenant denied');return originalMediaKey(value.tenantId,value.mediaId)}
 const write=(key:string,bytes:Uint8Array)=>{
  if(bytes.byteLength<1 || bytes.byteLength>maxBytes)throw new Error('Storage byte limit')
  const old=objects.get(key)
  if(old){if(!old.equals(Buffer.from(bytes)))throw new Error('Immutable object conflict');return}
  if(objects.size>=maxObjects)throw new Error('Storage object limit')
  objects.set(key,Buffer.from(bytes))
 }
 const storage:PrivateMediaStorage={kind:'test-memory',
  async readOriginal(value,limit,signal){signal.throwIfAborted();const key=scope(value),bytes=objects.get(key);if(!bytes || !Number.isSafeInteger(limit) || limit<1 || bytes.length>limit)throw new Error('Private original unavailable');return Buffer.from(bytes)},
  async putVariantOnce(value,id,bytes,signal){signal.throwIfAborted();scope(value);write(variantMediaKey(value.tenantId,value.mediaId,id),bytes);return {byteSize:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}},
  async removeVariant(value,id,signal){signal.throwIfAborted();scope(value);objects.delete(variantMediaKey(value.tenantId,value.mediaId,id))},
 }
 return {storage,putTestOriginal(value:MediaObjectScope,bytes:Uint8Array){write(scope(value),bytes)},hasTestVariant(value:MediaObjectScope,id:string){scope(value);return objects.has(variantMediaKey(value.tenantId,value.mediaId,id))},objectCount:()=>objects.size}
}
