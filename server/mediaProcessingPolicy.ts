import { parseMediaLimits,type MediaLimits } from '../src/domain/media.ts'
export interface MediaProcessingPolicy {input:MediaLimits;maxOutputBytes:number;maxOutputDimension:number;quality:number;wallTimeoutMs:number}
/** Mandatory technical policy, not a commercial quota or an enabled upload feature. */
export function parseMediaProcessingPolicy(input:unknown):MediaProcessingPolicy {
 if(!input || typeof input!=='object' || Array.isArray(input))throw new Error('Explicit image processing policy required')
 const r=input as Record<string,unknown>
 if(Object.keys(r).length!==5 || Object.keys(r).some(k=>!['input','maxOutputBytes','maxOutputDimension','quality','wallTimeoutMs'].includes(k)))throw new Error('Invalid image processing policy')
 const integer=(key:string,min:number,max:number)=>{const n=r[key];if(typeof n!=='number' || !Number.isSafeInteger(n) || n<min || n>max)throw new Error('Invalid image processing bound');return n}
 const limits=parseMediaLimits(r.input)
 if(limits.maxBytes>16777216 || limits.maxPixels>40000000 || limits.maxDimension>12000)throw new Error('Image decoder hard ceiling exceeded')
 return {input:limits,maxOutputBytes:integer('maxOutputBytes',1,16777216),maxOutputDimension:integer('maxOutputDimension',1,4096),quality:integer('quality',1,95),wallTimeoutMs:integer('wallTimeoutMs',250,30000)}
}
