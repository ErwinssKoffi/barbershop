import { spawn } from 'node:child_process'
import { fileURLToPath,URL as NodeURL } from 'node:url'
import { createHash } from 'node:crypto'
import { parseMediaProcessingPolicy,type MediaProcessingPolicy } from './mediaProcessingPolicy.ts'
import { sniffImageMime,validateImageEvidence,type ImageEvidence,type MediaMime } from '../src/domain/media.ts'
export class MediaProcessingError extends Error {
 readonly code:'INVALID_IMAGE'|'PROCESSING_TIMEOUT'|'PROCESSING_UNAVAILABLE'
 constructor(code:MediaProcessingError['code']){super('Image non acceptée ou traitement indisponible.');this.code=code}
}
export interface ProcessedImage {
 evidence:ImageEvidence;bytes:Buffer;variant:{mime:'image/webp';width:number;height:number;byteSize:number;sha256:string}
}
let activeDecoders=0
/** Real decoder in a killable child process; no original bytes or metadata returned to a browser. */
export async function processMediaImage(bytes:Uint8Array,declaredMime:MediaMime,declaredBytes:number,inputPolicy:MediaProcessingPolicy,signal?:AbortSignal):Promise<ProcessedImage> {
 if(signal?.aborted)throw new MediaProcessingError('PROCESSING_TIMEOUT')
 const policy=parseMediaProcessingPolicy(inputPolicy)
 if(!Number.isSafeInteger(declaredBytes) || declaredBytes<1 || bytes.byteLength!==declaredBytes || bytes.byteLength>policy.input.maxBytes || sniffImageMime(bytes)!==declaredMime)throw new MediaProcessingError('INVALID_IMAGE')
 if(activeDecoders>=2)throw new MediaProcessingError('PROCESSING_UNAVAILABLE')
 activeDecoders++
 return new Promise<ProcessedImage>((resolve,reject)=>{
  const child=spawn(process.execPath,['--experimental-strip-types','--max-old-space-size=128',fileURLToPath(new NodeURL('./mediaDecodeWorker.ts',import.meta.url)),JSON.stringify(policy),declaredMime,String(declaredBytes)],{stdio:['pipe','pipe','ignore'],env:{PATH:process.env.PATH??'',NODE_ENV:'production'},windowsHide:true})
  const chunks:Buffer[]=[];let count=0,timeout=false,overflow=false
  const timer=setTimeout(()=>{timeout=true;child.kill('SIGKILL')},policy.wallTimeoutMs)
  const abort=()=>{timeout=true;child.kill('SIGKILL')}
  signal?.addEventListener('abort',abort,{once:true})
  if(signal?.aborted)abort()
  child.stdin.on('error',()=>{/* Early child rejection closes its input pipe. */})
  child.on('error',()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(new MediaProcessingError('PROCESSING_UNAVAILABLE'))})
  child.stdout.on('data',(chunk:Buffer)=>{count+=chunk.length;if(count>policy.maxOutputBytes+4100){overflow=true;child.kill('SIGKILL')}else chunks.push(chunk)})
  child.on('close',code=>{
   clearTimeout(timer);signal?.removeEventListener('abort',abort)
   if(timeout){reject(new MediaProcessingError('PROCESSING_TIMEOUT'));return}
   if(code!==0 || overflow){reject(new MediaProcessingError(code===2||overflow?'INVALID_IMAGE':'PROCESSING_UNAVAILABLE'));return}
   try {
    const output=Buffer.concat(chunks);if(output.length<5)throw new Error()
    const headerLength=output.readUInt32BE(0);if(headerLength<1 || headerLength>4096 || headerLength+4>=output.length)throw new Error()
    const parsed=JSON.parse(output.subarray(4,headerLength+4).toString('utf8')),data=output.subarray(headerLength+4)
    const evidence=validateImageEvidence(parsed.evidence,policy.input),v=parsed.variant
    if(evidence.declaredMime!==declaredMime || evidence.declaredBytes!==declaredBytes || evidence.sha256!==createHash('sha256').update(bytes).digest('hex') || sniffImageMime(data)!=='image/webp' || data.length>policy.maxOutputBytes || v?.mime!=='image/webp' || v.byteSize!==data.length || !Number.isInteger(v.width) || v.width<1 || v.width>policy.maxOutputDimension || !Number.isInteger(v.height) || v.height<1 || v.height>policy.maxOutputDimension || v.sha256!==createHash('sha256').update(data).digest('hex'))throw new Error()
    resolve({evidence,bytes:data,variant:{mime:'image/webp',width:v.width,height:v.height,byteSize:v.byteSize,sha256:v.sha256}})
   }catch{reject(new MediaProcessingError('INVALID_IMAGE'))}
  })
  child.stdin.end(Buffer.from(bytes))
 }).finally(()=>{activeDecoders--})
}
