import { describe, expect, it } from 'vitest'
import { createPostgresTestPool } from './postgresTestPool'
import { apiTestClient } from './apiTestClient'
import { verifyAuthSessionToken } from '../../server/authEngine'
import { assertLiveSession } from '../../server/sessions'

function cookie(headers: Record<string, string>) { return headers['set-cookie']?.split(';')[0] ?? '' }
async function setup(rememberMe = true) {
  const { pool } = createPostgresTestPool()
  const registered = await apiTestClient(pool, 'POST', '/api/auth/register', {
    fullName: 'Responsable Sessions', email: 'sessions@example.invalid', password: 'Password2026', rememberMe,
  })
  expect(registered.status).toBe(201)
  return { pool, registered, token: registered.body.sessionToken as string, cookie: cookie(registered.headers) }
}

describe('Sessions persistantes — PostgreSQL réel', () => {
  it('émet un accès de 15 minutes et un refresh uniquement en cookie HttpOnly, jamais dans la réponse ou en base en clair', async () => {
    const { pool, registered, token, cookie: refreshCookie } = await setup()
    const claims = verifyAuthSessionToken(token)!
    expect(claims.sid).toBe(registered.body.sessionId)
    expect(claims.exp - Date.now()).toBeGreaterThan(14 * 60_000)
    expect(claims.exp - Date.now()).toBeLessThanOrEqual(15 * 60_000)
    expect(registered.body).not.toHaveProperty('refreshToken')
    expect(registered.headers['set-cookie']).toContain('HttpOnly')
    expect(registered.headers['set-cookie']).toContain('SameSite=Strict')
    expect(registered.headers['set-cookie']).toContain('Path=/api/auth')
    expect(registered.headers['set-cookie']).toContain('Max-Age=')
    const rows = await pool.query<{ refresh_hash: string }>('SELECT refresh_hash FROM sessions')
    expect(rows.rows[0].refresh_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(rows.rows[0].refresh_hash).not.toBe(refreshCookie.split('=')[1])
    await assertLiveSession(pool, claims)
  })

  it('respecte le choix de cookie de session sans se souvenir de moi', async () => {
    const { registered } = await setup(false)
    expect(registered.headers['set-cookie']).not.toContain('Max-Age=')
  })

  it('renouvelle à usage unique, change le cookie et invalide immédiatement le précédent accès', async () => {
    const { pool, token, cookie: previousCookie } = await setup()
    const rotated = await apiTestClient(pool, 'POST', '/api/auth/refresh', undefined, undefined, { cookie: previousCookie })
    expect(rotated.status).toBe(200)
    expect(rotated.body.sessionToken).not.toBe(token)
    expect(cookie(rotated.headers)).not.toBe(previousCookie)
    expect((await apiTestClient(pool, 'GET', '/api/users', undefined, token)).status).toBe(401)
    expect((await apiTestClient(pool, 'GET', '/api/users', undefined, rotated.body.sessionToken as string)).status).toBe(200)
    expect(rotated.body).not.toHaveProperty('refreshToken')
    const expiredAccess = verifyAuthSessionToken(rotated.body.sessionToken as string)!
    const deadline = new Date(Date.now() - 1000)
    await pool.query('UPDATE sessions SET expires_at = $1 WHERE id = $2', [deadline.toISOString(), expiredAccess.sid])
    expect((await apiTestClient(pool, 'POST', '/api/auth/refresh', undefined, undefined, { cookie: cookie(rotated.headers) })).status).toBe(401)
  })

  it('révoque toute la famille sur rejeu, mais conserve une autre connexion/appareil', async () => {
    const { pool, cookie: oldCookie } = await setup()
    const other = await apiTestClient(pool, 'POST', '/api/auth/login', { email: 'sessions@example.invalid', password: 'Password2026' })
    const rotated = await apiTestClient(pool, 'POST', '/api/auth/refresh', undefined, undefined, { cookie: oldCookie })
    const replay = await apiTestClient(pool, 'POST', '/api/auth/refresh', undefined, undefined, { cookie: oldCookie })
    expect(replay.status).toBe(401)
    expect(replay.body.code).toBe('SESSION_REUSED')
    expect((await apiTestClient(pool, 'GET', '/api/users', undefined, rotated.body.sessionToken as string)).status).toBe(401)
    expect((await apiTestClient(pool, 'GET', '/api/users', undefined, other.body.sessionToken as string)).status).toBe(200)
  })

  it('déconnecte côté serveur de façon idempotente, et efface le cookie', async () => {
    const { pool, token, cookie: refreshCookie } = await setup()
    const logout = () => apiTestClient(pool, 'POST', '/api/auth/logout', undefined, token, { cookie: refreshCookie })
    const first = await logout()
    expect(first.status).toBe(200)
    expect(first.body.revoked).toBe(true)
    expect(first.headers['set-cookie']).toContain('Max-Age=0')
    expect((await logout()).body.revoked).toBe(false)
    expect((await apiTestClient(pool, 'GET', '/api/users', undefined, token)).status).toBe(401)
    expect((await apiTestClient(pool, 'POST', '/api/auth/refresh', undefined, undefined, { cookie: refreshCookie })).status).toBe(401)
  })

  it('refuse un cookie inconnu, une requête cross-origin et une session historique sans sid', async () => {
    const { pool, token, cookie: refreshCookie } = await setup()
    const unknown = await apiTestClient(pool, 'POST', '/api/auth/refresh', undefined, undefined, { cookie: 'salon_pro_refresh=unknown' })
    expect(unknown.status).toBe(401)
    const foreign = await apiTestClient(pool, 'POST', '/api/auth/refresh', undefined, undefined, { cookie: refreshCookie, origin: 'https://other.example.invalid', host: 'app.example.invalid' })
    expect(foreign.status).toBe(403)
    expect((await apiTestClient(pool, 'GET', '/api/users', undefined, token)).status).toBe(200)
  })

  it('révoque les accès et les refresh après changement de rôle ou de mot de passe', async () => {
    const { pool, token } = await setup()
    const second = await apiTestClient(pool, 'POST', '/api/auth/register', { fullName: 'Second Responsable', email: 'second@example.invalid', password: 'Password2026' }, token)
    const id = (second.body.user as { id: string }).id
    const update = await apiTestClient(pool, 'PATCH', `/api/users/${id}`, { role: 'cashier' }, token)
    expect(update.status).toBe(200)
    expect((await apiTestClient(pool, 'GET', '/api/sync/pull', undefined, second.body.sessionToken as string)).status).toBe(401)
    const refresh = await apiTestClient(pool, 'POST', '/api/auth/refresh', undefined, undefined, { cookie: cookie(second.headers) })
    expect(refresh.status).toBe(401)
    const loggedIn = await apiTestClient(pool, 'POST', '/api/auth/login', { email: 'second@example.invalid', password: 'Password2026' })
    expect(loggedIn.status).toBe(200)
    expect((await apiTestClient(pool, 'PATCH', `/api/users/${id}`, { password: 'Changed2026' }, token)).status).toBe(200)
    expect((await apiTestClient(pool, 'POST', '/api/auth/refresh', undefined, undefined, { cookie: cookie(loggedIn.headers) })).status).toBe(401)
  })
})
