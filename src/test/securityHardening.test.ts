import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertAuthConfiguration, hashPasswordNode, signAuthSessionToken, verifyAuthSessionToken, verifyPasswordNode } from '../../server/authEngine'
import { requestIp } from '../../server/authRateLimit'
import { isStrongPassword } from '../domain/passwordPolicy'
import { SalonProDatabase } from '../db/database'
import { SalonRepositoryHub } from '../db/repositories/salonRepositories'
import type { IncomingMessage } from 'node:http'
import { readFileSync } from 'node:fs'

afterEach(() => vi.unstubAllEnvs())

describe('Durcissement de l’authentification', () => {
  it('refuse une clé absente/courte en production sans repli sur le PIN', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SALON_AUTH_SECRET', '')
    vi.stubEnv('SALON_SYNC_PIN', crypto.randomUUID())
    expect(assertAuthConfiguration).toThrow('configuration')
    expect(() => signAuthSessionToken({ id: 'user', email: 'user@example.invalid', role: 'manager' })).toThrow('configuration')
    vi.stubEnv('SALON_AUTH_SECRET', 'short')
    expect(assertAuthConfiguration).toThrow('configuration')
    vi.stubEnv('SALON_AUTH_SECRET', crypto.randomUUID())
    expect(assertAuthConfiguration).not.toThrow()
  })

  it('ne dépend plus du PIN pour signer, et invalide une signature avec une autre clé', () => {
    vi.stubEnv('SALON_AUTH_SECRET', crypto.randomUUID())
    const token = signAuthSessionToken({ id: 'user', email: 'user@example.invalid', role: 'manager' }, crypto.randomUUID())
    expect(verifyAuthSessionToken(token, crypto.randomUUID())?.uid).toBe('user')
    vi.stubEnv('SALON_AUTH_SECRET', crypto.randomUUID())
    expect(verifyAuthSessionToken(token)).toBeNull()
  })

  it('applique la politique aux nouvelles inscriptions locales sans imposer de changement aux anciens comptes', async () => {
    expect(isStrongPassword('short1')).toBe(false)
    expect(isStrongPassword('LettersOnly')).toBe(false)
    expect(isStrongPassword('12345678')).toBe(false)
    expect(isStrongPassword('LongPassword2026')).toBe(true)
    expect(isStrongPassword('a1'.repeat(129))).toBe(false)
    const db = new SalonProDatabase(`security-policy-${crypto.randomUUID()}`)
    const repo = new SalonRepositoryHub(db)
    try {
      await repo.ensureInitialized()
      await expect(repo.registerLocalUserAccount({ fullName: 'Compte Test', email: 'policy@example.invalid', password: 'LettersOnly', role: 'manager' })).rejects.toThrow('8 caractères')
    } finally { await db.delete() }
    const oldHash = hashPasswordNode('ancien', 1000)
    expect(verifyPasswordNode('ancien', oldHash)).toBe(true)
    expect(verifyPasswordNode('ancien', 'pbkdf2_sha256$100000$abcd$')).toBe(false)
    expect(verifyPasswordNode('ancien', oldHash.replace('$1000$', '$900000000$'))).toBe(false)
  })

  it('ignore un X-Forwarded-For non fiable hors du proxy Vercel', () => {
    vi.stubEnv('VERCEL', '')
    const req = { headers: { 'x-forwarded-for': 'spoofed' }, socket: { remoteAddress: '192.0.2.1' } } as unknown as IncomingMessage
    expect(requestIp(req)).toBe('192.0.2.1')
    vi.stubEnv('VERCEL', '1')
    expect(requestIp(req)).toBe('spoofed')
  })

  it('livre les en-têtes de sécurité sans autoriser les scripts inline', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf8'))
    const headers = config.headers[0].headers as { key: string; value: string }[]
    expect(headers.find((header) => header.key === 'Content-Security-Policy')?.value).toContain("script-src 'self';")
    expect(headers.find((header) => header.key === 'X-Frame-Options')?.value).toBe('DENY')
    expect(headers.some((header) => header.key === 'Strict-Transport-Security')).toBe(true)
  })
})
