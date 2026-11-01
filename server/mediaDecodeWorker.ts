/** Private single-use subprocess. Binary stdin/stdout only; never expose as an HTTP handler. */
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { parseMediaProcessingPolicy } from './mediaProcessingPolicy.ts'
import { sniffImageMime,validateImageEvidence,type MediaMime } from '../src/domain/media.ts'
try {
 const policy=parseMediaProcessingPolicy(JSON.parse(process.argv[2]??'')),declaredMime=process.argv[3] as MediaMime,declaredBytes=Number(process.argv[4])
 sharp.cache(false);sharp.concurrency(1)
 const chunks:Buffer[]=[];let count=0
 for await(const chunk of process.stdin){count+=chunk.length;if(count>policy.input.maxBytes)throw new Error();chunks.push(Buffer.from(chunk))}
 const bytes=Buffer.concat(chunks)
 if(bytes.length!==declaredBytes || sniffImageMime(bytes)!==declaredMime)throw new Error()
 const image=sharp(bytes,{limitInputPixels:policy.input.maxPixels,failOn:'warning',animated:true,sequentialRead:true})
 const metadata=await image.metadata(),formats:Record<string,MediaMime>={jpeg:'image/jpeg',png:'image/png',webp:'image/webp'}
 if(!metadata.format || formats[metadata.format]!==declaredMime || (metadata.pages??1)!==1)throw new Error()
 const evidence=validateImageEvidence({declaredMime,declaredBytes,actualMime:formats[metadata.format],actualBytes:bytes.length,width:metadata.width??0,height:metadata.height??0,sha256:createHash('sha256').update(bytes).digest('hex')},policy.input)
 // auto-orient before resize; sharp strips EXIF/XMP/ICC by default. Never keepMetadata().
 const {data,info}=await image.rotate().resize({width:policy.maxOutputDimension,height:policy.maxOutputDimension,fit:'inside',withoutEnlargement:true}).webp({quality:policy.quality,effort:4}).timeout({seconds:Math.max(1,Math.ceil(policy.wallTimeoutMs/1000))}).toBuffer({resolveWithObject:true})
 if(data.length>policy.maxOutputBytes || info.format!=='webp' || info.width<1 || info.height<1)throw new Error()
 const header=Buffer.from(JSON.stringify({evidence,variant:{mime:'image/webp',width:info.width,height:info.height,byteSize:data.length,sha256:createHash('sha256').update(data).digest('hex')}}))
 if(header.length>4096)throw new Error()
 const size=Buffer.alloc(4);size.writeUInt32BE(header.length)
 process.stdout.write(Buffer.concat([size,header,data]))
} catch {
 // Never emit decoder error strings, file bytes, EXIF or paths.
 process.exitCode=2
}
