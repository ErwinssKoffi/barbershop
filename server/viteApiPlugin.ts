import 'dotenv/config'
import type { Plugin } from 'vite'
import { handleSalonApiRequest } from './apiHandler.ts'

/**
 * Plugin Vite intégrant les routes /api/* côté serveur (développement et preview),
 * gardant DATABASE_URL et SALON_SYNC_PIN 100 % côté Node sans jamais les exposer au navigateur.
 */
export function salonNeonApiPlugin(): Plugin {
  return {
    name: 'salon-pro-neon-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) {
          next()
          return
        }
        void handleSalonApiRequest(req, res).catch((err) => {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(
            JSON.stringify({
              ok: false,
              code: 'UNEXPECTED_ERROR',
              message: err instanceof Error ? err.message : 'Erreur serveur',
            }),
          )
        })
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) {
          next()
          return
        }
        void handleSalonApiRequest(req, res).catch((err) => {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(
            JSON.stringify({
              ok: false,
              code: 'UNEXPECTED_ERROR',
              message: err instanceof Error ? err.message : 'Erreur serveur',
            }),
          )
        })
      })
    },
  }
}
