import { resolveSessionTenant, setTenantContext } from './tenantContext.ts'
import { isStrongPassword } from '../src/domain/passwordPolicy.ts'
import type { PublicSalonUser, SalonUserAccount, UserRole } from '../src/domain/models/index.ts'
import { AuthApiError, hashPasswordNode, toPublicUser, type SessionTokenPayload } from './authEngine.ts'
import type { SqlPoolLike, SqlQueryable } from './neonClient.ts'

async function readAccounts(db: SqlQueryable, tenantId: string): Promise<SalonUserAccount[]> {
  const result = await db.query<{ payload_json: SalonUserAccount | string; role: UserRole; is_active: boolean; tenant_id: string }>(
    `SELECT u.payload_json, u.tenant_id, m.role, m.is_active FROM salon_users u
     JOIN memberships m ON m.user_id = u.id WHERE m.tenant_id = $1 ORDER BY u.created_at ASC`, [tenantId],
  )
  return result.rows.map((row) => {
    const account = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) as SalonUserAccount : row.payload_json
    return { ...account, tenantId: row.tenant_id, role: row.role, isActive: account.isActive && row.is_active }
  })
}

export async function requireActiveManager(db: SqlQueryable, session: SessionTokenPayload | null | undefined): Promise<SalonUserAccount> {
  if (!session) throw new AuthApiError(401, 'SESSION_REQUIRED', 'Connectez-vous pour administrer les comptes.')
  const resolved = await resolveSessionTenant(db, session)
  const actor = (await readAccounts(db, resolved.tid)).find((user) => user.id === session.uid)
  if (!actor?.isActive || actor.role !== 'manager') {
    throw new AuthApiError(403, 'MANAGER_ROLE_REQUIRED', 'Cette action exige un compte Gérant actif.')
  }
  return actor
}

export async function listManagedUsers(pool: SqlPoolLike, session: SessionTokenPayload | null): Promise<PublicSalonUser[]> {
  await requireActiveManager(pool, session)
  const resolved = await resolveSessionTenant(pool, session!)
  return (await readAccounts(pool, resolved.tid)).map(toPublicUser)
}

export interface UpdateUserInput {
  role?: UserRole
  isActive?: boolean
  password?: string
}

export async function updateManagedUser(pool: SqlPoolLike, session: SessionTokenPayload | null, id: string, input: UpdateUserInput): Promise<PublicSalonUser> {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some((key) => !['role', 'isActive', 'password'].includes(key)) ||
      (input.role !== undefined && input.role !== 'manager' && input.role !== 'cashier') ||
      (input.isActive !== undefined && typeof input.isActive !== 'boolean') ||
      (input.password !== undefined && !isStrongPassword(input.password))) {
    throw new AuthApiError(400, 'INVALID_USER_UPDATE', 'Modification invalide. Le mot de passe doit contenir 8 caractères, une lettre et un chiffre.')
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (!session) throw new AuthApiError(401, 'SESSION_REQUIRED', 'Connectez-vous.')
    const resolved = await resolveSessionTenant(client, session)
    await setTenantContext(client, resolved.tid)
    await client.query("SELECT pg_advisory_xact_lock(hashtext('session-user:' || $1))", [id])
    // Sérialise les changements de rôle pour protéger le dernier Gérant, même en concurrence.
    await client.query('LOCK TABLE salon_users IN SHARE ROW EXCLUSIVE MODE')
    const actor = await requireActiveManager(client, session)
    const accounts = await readAccounts(client, resolved.tid)
    const target = accounts.find((user) => user.id === id)
    if (!target) throw new AuthApiError(404, 'USER_NOT_FOUND', 'Compte introuvable.')
    if (actor.id === id && input.isActive === false) {
      throw new AuthApiError(409, 'SELF_DISABLE_FORBIDDEN', 'Vous ne pouvez pas désactiver votre propre compte.')
    }
    const next = { ...target, role: input.role ?? target.role, isActive: input.isActive ?? target.isActive, updatedAt: new Date().toISOString() }
    if (target.role === 'manager' && target.isActive && (!next.isActive || next.role !== 'manager') &&
        !accounts.some((user) => user.id !== id && user.isActive && user.role === 'manager')) {
      throw new AuthApiError(409, 'LAST_MANAGER_REQUIRED', 'Conservez au moins un Gérant actif.')
    }
    if (input.password !== undefined && target.tenantId !== resolved.tid) throw new AuthApiError(403, 'IDENTITY_PASSWORD_FORBIDDEN', 'Ce mot de passe appartient à une identité externe au salon.')
    if (input.password !== undefined) next.passwordHash = hashPasswordNode(input.password)
    await client.query('UPDATE memberships SET role = $3, is_active = $4 WHERE tenant_id = $1 AND user_id = $2', [resolved.tid, id, next.role, next.isActive])
    if (input.password !== undefined && target.tenantId === resolved.tid) {
      await client.query(
        `UPDATE salon_users SET password_hash = $2, updated_at = $3,
          payload_json = jsonb_set(jsonb_set(payload_json, '{passwordHash}', to_jsonb($2::text)), '{updatedAt}', to_jsonb($3::text))
         WHERE id = $1 AND tenant_id = $4`,
        [id, next.passwordHash, next.updatedAt, resolved.tid],
      )
    }
    if (input.password !== undefined) {
      await client.query("UPDATE sessions SET revoked_at = now(), revoked_reason = 'password_changed' WHERE user_id = $1 AND revoked_at IS NULL", [id])
    } else if (next.role !== target.role || next.isActive !== target.isActive) {
      await client.query("UPDATE sessions SET revoked_at = now(), revoked_reason = 'membership_changed' WHERE user_id = $1 AND tenant_id = $2 AND revoked_at IS NULL", [id, resolved.tid])
    }
    await client.query('COMMIT')
    console.info(JSON.stringify({ action: 'user.update', actorId: actor.id, userId: id }))
    return toPublicUser(next)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
