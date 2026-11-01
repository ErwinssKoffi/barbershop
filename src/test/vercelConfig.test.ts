import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
it('déclare un build Vite reproductible et conserve l’API séparée du repli SPA',() => {
 const config=JSON.parse(readFileSync('vercel.json','utf8'))
 expect(config).toMatchObject({framework:'vite',installCommand:'npm ci',buildCommand:'npm run build',outputDirectory:'dist',regions:['dub1']})
 expect(config.rewrites[0]).toEqual({source:'/api/(.*)',destination:'/api/$1'})
 expect(config.rewrites[1].destination).toBe('/index.html')
 expect(config.rewrites[1].source).toContain('(?!api/)')
 expect(config.env).toBeUndefined();expect(config.build?.env).toBeUndefined()
})
it('utilise Node 22 et exclut les liaisons/secrets locaux du versionnement',() => {
 const pkg=JSON.parse(readFileSync('package.json','utf8'))
 const lock=JSON.parse(readFileSync('package-lock.json','utf8'))
 expect(pkg.engines.node).toBe('22.x');expect(lock.packages[''].engines).toEqual(pkg.engines)
 const ignore=readFileSync('.gitignore','utf8')
 expect(ignore).toContain('.vercel/');expect(ignore).toContain('.env.*')
})
