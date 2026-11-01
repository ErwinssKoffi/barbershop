import { expect, it } from 'vitest'
import { canTransitionMedia, originalMediaKey, parseMediaLimits, publicMediaDto, sniffImageMime, validateImageEvidence, variantMediaKey, type ImageEvidence } from '../domain/media'
import { marketplaceMigrationOptions } from '../../server/migrationOptions'
const limits=() => ({maxBytes:1000,maxPixels:10000,maxDimension:100})
const evidence=(): ImageEvidence => ({declaredMime:'image/png',declaredBytes:100,actualMime:'image/png',actualBytes:100,width:20,height:10,sha256:'a'.repeat(64)})
it.each([null,{},[],{...limits(),maxBytes:0},{...limits(),maxPixels:Infinity},{...limits(),maxDimension:1.5},{...limits(),maxBytes:1001,tenantId:'forged'}])('limites explicites obligatoires : %j',input => {
  expect(() => parseMediaLimits(input)).toThrow()
})
it('signatures JPEG PNG WebP seulement, sans prétendre décoder le fichier complet',() => {
  expect(sniffImageMime(new Uint8Array([255,216,255]))).toBe('image/jpeg')
  expect(sniffImageMime(new Uint8Array([137,80,78,71,13,10,26,10]))).toBe('image/png')
  expect(sniffImageMime(new Uint8Array([82,73,70,70,0,0,0,0,87,69,66,80]))).toBe('image/webp')
  for (const input of [[],[255,216],[60,115,118,103,62],[71,73,70,56]]) expect(sniffImageMime(new Uint8Array(input))).toBeNull()
})
it('métadonnées mesurées bornées : MIME, octets, pixels, dimensions et digest',() => {
  expect(validateImageEvidence(evidence(),limits())).toEqual(evidence())
  for (const change of [{actualBytes:101},{actualMime:'image/jpeg'},{width:0},{width:101},{sha256:'invalid'},{actualBytes:1001},{declaredBytes:1.5},{height:Infinity}]) {
    expect(() => validateImageEvidence({...evidence(),...change} as ImageEvidence,limits())).toThrow()
  }
  expect(() => validateImageEvidence({...evidence(),width:100,height:100},{...limits(),maxPixels:9999})).toThrow(/pixel/)
  expect(() => validateImageEvidence({...evidence(),width:2147483647,height:2147483647},{maxBytes:1000,maxPixels:Number.MAX_SAFE_INTEGER,maxDimension:2147483647})).toThrow(/pixel/)
  expect(() => validateImageEvidence({...evidence(),actualMime:'image/svg+xml'} as unknown as ImageEvidence,limits())).toThrow(/MIME/)
})
it('clés serveur sans URL/traversée, UUID canoniques, original et variantes distincts',() => {
  const tenant=crypto.randomUUID(),media=crypto.randomUUID(),variant=crypto.randomUUID()
  expect(originalMediaKey(tenant.toUpperCase(),media)).toBe(`${tenant}/${media}/original`)
  expect(variantMediaKey(tenant,media,variant)).toBe(`${tenant}/${media}/variants/${variant}`)
  for (const bad of ['../object','https://untrusted.invalid/image','image.png','',`${tenant}/../../`]) {
    expect(() => originalMediaKey(tenant,bad)).toThrow()
    expect(() => variantMediaKey(tenant,media,bad)).toThrow()
  }
})
it('transitions terminales et absence de résurrection',() => {
  expect(canTransitionMedia('pending','processing')).toBe(true)
  expect(canTransitionMedia('pending','ready')).toBe(false)
  expect(canTransitionMedia('processing','ready')).toBe(true)
  expect(canTransitionMedia('ready','deleted')).toBe(true)
  expect(canTransitionMedia('deleted','ready')).toBe(false)
  expect(canTransitionMedia('rejected','processing')).toBe(false)
})
it('DTO : aucune clé objet, original, hash, profil ou tenant ; pas de média non diffusable',() => {
  const id=crypto.randomUUID()
  const row={id,purpose:'gallery' as const,sortOrder:0,altText:'Image du salon',creditText:'Auteur',width:20,height:10,mime:'image/webp' as const,renderable:true,objectKey:'private/object',tenantId:crypto.randomUUID(),sha256:'a'.repeat(64)}
  expect(publicMediaDto(row)).toEqual({id,purpose:'gallery',sortOrder:0,altText:'Image du salon',creditText:'Auteur',width:20,height:10,mime:'image/webp'})
  expect(() => publicMediaDto({...row,renderable:false})).toThrow()
  expect(() => publicMediaDto({...row,altText:'  '})).toThrow()
  expect(() => publicMediaDto({...row,id:'https://untrusted.invalid'})).toThrow()
})
it('opt-in média séparé, dépendance 009 seulement et garde backup/restore',() => {
  expect(() => marketplaceMigrationOptions(['--include-media'],undefined)).toThrow(/backup/)
  expect(marketplaceMigrationOptions(['--include-media'],'true')).toEqual({includeMarketplace:true,includeMedia:true})
  expect(marketplaceMigrationOptions(['--include-public-catalog'],'true')).toEqual({includeMarketplace:true,includePublicCatalog:true})
  expect(marketplaceMigrationOptions(['--include-scheduling'],'true')).toEqual({includeMarketplace:true,includeScheduling:true})
})
