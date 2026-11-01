export interface TextPublicationCommand {idempotencyKey:string;expectedVersion:number;slug:string;confirmedWithoutPhotos:true}
export function parseTextPublicationCommand(input:unknown):TextPublicationCommand {
 if(!input || typeof input!=='object' || Array.isArray(input))throw new Error('Publication invalide.')
 const r=input as Record<string,unknown>
 if(Object.keys(r).length!==4 || Object.keys(r).some(k=>!['idempotencyKey','expectedVersion','slug','confirmedWithoutPhotos'].includes(k)) || typeof r.idempotencyKey!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(r.idempotencyKey) || !Number.isSafeInteger(r.expectedVersion) || Number(r.expectedVersion)<1 || Number(r.expectedVersion)>=2147483647 || typeof r.slug!=='string' || r.slug.length<3 || r.slug.length>100 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.slug) || r.confirmedWithoutPhotos!==true)throw new Error('Confirmation, clé et version requises.')
 return {idempotencyKey:r.idempotencyKey,expectedVersion:Number(r.expectedVersion),slug:r.slug,confirmedWithoutPhotos:true}
}
export interface TextPublicationResult {outcome:'published'|'replayed';version:number;revision:number;slug:string}
export function parseTextPublicationResult(value:unknown):TextPublicationResult {
 const r=value as TextPublicationResult
 if(!r || !['published','replayed'].includes(r.outcome) || !Number.isSafeInteger(r.version) || r.version<1 || !Number.isSafeInteger(r.revision) || r.revision<1 || typeof r.slug!=='string' || r.slug.length<3 || r.slug.length>100 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.slug))throw new Error('Résultat incertain. Relire et reprendre la même intention.')
 return {outcome:r.outcome,version:r.version,revision:r.revision,slug:r.slug}
}
