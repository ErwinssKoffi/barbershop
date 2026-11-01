import { expect,it } from 'vitest'
import sharp from 'sharp'
import { createHash,randomUUID } from 'node:crypto'
import { processMediaImage,MediaProcessingError } from '../../server/mediaProcessor'
import { parseMediaProcessingPolicy,type MediaProcessingPolicy } from '../../server/mediaProcessingPolicy'
import { createMemoryMediaTestStorage } from '../../server/mediaStorage'
const policy:MediaProcessingPolicy={input:{maxBytes:1048576,maxPixels:65536,maxDimension:256},maxOutputBytes:1048576,maxOutputDimension:16,quality:80,wallTimeoutMs:5000}
async function image(){return sharp({create:{width:32,height:16,channels:3,background:'#245678'}}).png().toBuffer()}
it('décodage réel puis variante WebP redimensionnée, digests et dimensions vérifiables',async()=>{
 const bytes=await image(),result=await processMediaImage(bytes,'image/png',bytes.length,policy)
 expect(result.evidence).toMatchObject({actualMime:'image/png',actualBytes:bytes.length,width:32,height:16,sha256:createHash('sha256').update(bytes).digest('hex')})
 const meta=await sharp(result.bytes).metadata()
 expect(meta).toMatchObject({format:'webp',width:16,height:8})
 expect(result.variant).toMatchObject({mime:'image/webp',width:16,height:8,byteSize:result.bytes.length})
 expect(result.variant.sha256).toBe(createHash('sha256').update(result.bytes).digest('hex'))
})
it('orientation normalisée et métadonnées privées EXIF/ICC supprimées réellement',async()=>{
 const bytes=await sharp({create:{width:32,height:16,channels:3,background:'#245678'}}).withMetadata({orientation:6}).withExif({IFD0:{Copyright:'PRIVATE_EXIF_MUST_NOT_LEAK'}}).jpeg().toBuffer()
 expect((await sharp(bytes).metadata()).exif).toBeDefined()
 const result=await processMediaImage(bytes,'image/jpeg',bytes.length,policy),meta=await sharp(result.bytes).metadata()
 expect(meta).toMatchObject({width:8,height:16,format:'webp'})
 for(const key of ['exif','icc','xmp','orientation'] as const)expect(meta[key]).toBeUndefined()
 expect(result.bytes.includes(Buffer.from('PRIVATE_EXIF_MUST_NOT_LEAK'))).toBe(false)
})
it('faux MIME, SVG actif, signature seule et fichier tronqué ne deviennent jamais prêts',async()=>{
 const bytes=await image()
 await expect(processMediaImage(bytes,'image/jpeg',bytes.length,policy)).rejects.toBeInstanceOf(MediaProcessingError)
 const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>bad</script></svg>')
 await expect(processMediaImage(svg,'image/png',svg.length,policy)).rejects.toMatchObject({code:'INVALID_IMAGE'})
 for(const broken of [bytes.subarray(0,8),bytes.subarray(0,bytes.length/2)])await expect(processMediaImage(broken,'image/png',broken.length,policy)).rejects.toMatchObject({code:'INVALID_IMAGE'})
 await expect(processMediaImage(bytes,'image/png',bytes.length-1,policy)).rejects.toMatchObject({code:'INVALID_IMAGE'})
})
it('plafonds bytes/pixels/dimensions et taille sortie réellement imposés',async()=>{
 const bytes=await image()
 for(const change of [{input:{...policy.input,maxBytes:1}},{input:{...policy.input,maxPixels:1}},{input:{...policy.input,maxDimension:1}},{maxOutputBytes:1}])await expect(processMediaImage(bytes,'image/png',bytes.length,{...policy,...change})).rejects.toMatchObject({code:'INVALID_IMAGE'})
 expect(()=>parseMediaProcessingPolicy({...policy,input:{...policy.input,maxBytes:16777217}})).toThrow()
 expect(()=>parseMediaProcessingPolicy({...policy,wallTimeoutMs:30001})).toThrow()
})
it('sous-processus annulable : arrêt du décodage sans fuite d’erreur ou octets',async()=>{
 const bytes=await image(),abort=new AbortController()
 const task=processMediaImage(bytes,'image/png',bytes.length,policy,abort.signal);abort.abort()
 await expect(task).rejects.toMatchObject({code:'PROCESSING_TIMEOUT',message:'Image non acceptée ou traitement indisponible.'})
})
it('adaptateur de test tenant-bound, immuable, borné, copie défensive et suppression idempotente',async()=>{
 const tenantId=randomUUID(),mediaId=randomUUID(),variantId=randomUUID(),scope={tenantId,mediaId}
 const store=createMemoryMediaTestStorage(tenantId,3,1024),signal=AbortSignal.timeout(1000),bytes=Buffer.from('private-test-bytes')
 store.putTestOriginal(scope,bytes);bytes[0]=0
 const read=await store.storage.readOriginal(scope,1024,signal)
 expect(Buffer.from(read).toString()).toBe('private-test-bytes')
 read[0]=0;expect(Buffer.from(await store.storage.readOriginal(scope,1024,signal)).toString()).toBe('private-test-bytes')
 await expect(store.storage.readOriginal({...scope,tenantId:randomUUID()},1024,signal)).rejects.toThrow(/tenant/)
 await store.storage.putVariantOnce(scope,variantId,Buffer.from('variant'),signal)
 await store.storage.putVariantOnce(scope,variantId,Buffer.from('variant'),signal)
 await expect(store.storage.putVariantOnce(scope,variantId,Buffer.from('different'),signal)).rejects.toThrow(/conflict/)
 expect(store.hasTestVariant(scope,variantId)).toBe(true)
 await store.storage.removeVariant(scope,variantId,signal);await store.storage.removeVariant(scope,variantId,signal)
 expect(store.objectCount()).toBe(1)
 expect(()=>store.putTestOriginal({tenantId,mediaId:randomUUID()},Buffer.alloc(1025))).toThrow(/byte/)
})
it('WebP animé réellement multi-frame refusé ; WebP statique accepté',async()=>{
 const raw=Buffer.alloc(4*8*3);raw.fill(255,4*4*3)
 const animated=await sharp(raw,{raw:{width:4,height:8,channels:3,pageHeight:4}}).webp({loop:0,delay:[100,100]}).toBuffer()
 expect((await sharp(animated,{animated:true}).metadata()).pages).toBe(2)
 await expect(processMediaImage(animated,'image/webp',animated.length,policy)).rejects.toMatchObject({code:'INVALID_IMAGE'})
 const still=await sharp({create:{width:4,height:4,channels:3,background:'#245678'}}).webp().toBuffer()
 expect((await processMediaImage(still,'image/webp',still.length,policy)).variant).toMatchObject({mime:'image/webp',width:4,height:4})
})
it('concurrence locale bornée sans file mémoire illimitée',async()=>{
 const bytes=await image(),abort=new AbortController()
 const first=processMediaImage(bytes,'image/png',bytes.length,policy,abort.signal)
 const second=processMediaImage(bytes,'image/png',bytes.length,policy,abort.signal)
 const tasks=Promise.allSettled([first,second])
 await expect(processMediaImage(bytes,'image/png',bytes.length,policy)).rejects.toMatchObject({code:'PROCESSING_UNAVAILABLE'})
 abort.abort();expect((await tasks).every(r=>r.status==='rejected')).toBe(true)
 expect((await processMediaImage(bytes,'image/png',bytes.length,policy)).variant.mime).toBe('image/webp')
})
