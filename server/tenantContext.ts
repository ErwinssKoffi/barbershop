import { AuthApiError, type SessionTokenPayload } from './authEngine.ts'
import type { SqlClientLike, SqlPoolLike, SqlQueryable } from './neonClient.ts'

export function validateTenantId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new AuthApiError(400, 'INVALID_TENANT', 'Salon invalide.')
  }
}

export async function defaultTenantId(db: SqlQueryable): Promise<string> {
  const result = await db.query<{ tenant_id: string }>('SELECT tenant_id FROM tenant_bootstrap WHERE singleton = true')
  const id = result.rows[0]?.tenant_id
  validateTenantId(id)
  return id
}

/** Le claim signé ne suffit pas : activation et appartenance sont relues à chaque requête. */
export async function resolveSessionTenant(db: SqlQueryable, session: SessionTokenPayload): Promise<SessionTokenPayload & { tid: string }> {
  if (session.tid !== undefined) validateTenantId(session.tid)
  const result = await db.query<{ tenant_id: string; role: 'manager' | 'cashier' }>(
    `SELECT m.tenant_id, m.role FROM salon_users u
     JOIN memberships m ON m.user_id = u.id
     JOIN tenants t ON t.id = m.tenant_id
     WHERE u.id = $1 AND m.tenant_id = COALESCE($2::uuid, u.tenant_id)
       AND u.is_active = true AND m.is_active = true AND t.status = 'active'`,
    [session.uid, session.tid ?? null],
  )
  const membership = result.rows[0]
  if (!membership) throw new AuthApiError(403, 'TENANT_ACCESS_DENIED', 'Ce compte ne possède pas d’accès actif à ce salon.')
  validateTenantId(membership.tenant_id)
  return { ...session, tid: membership.tenant_id, role: membership.role }
}

export async function setTenantContext(client: SqlClientLike, tenantId: string): Promise<void> {
  validateTenantId(tenantId)
  // Même une connexion de migration privilégiée effectue le métier sous un rôle sans BYPASSRLS.
  await client.query("SELECT set_config('role', 'salon_pro_runtime_' || substr(md5(current_schema()), 1, 12), true)")
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId])
  const result = await client.query<{ id: string }>("SELECT id FROM tenants WHERE id = $1 AND status = 'active'", [tenantId])
  if (!result.rows.length) throw new AuthApiError(403, 'TENANT_SUSPENDED', 'Ce salon est suspendu ou indisponible.')
}

export async function withTenantClient<T>(pool: SqlPoolLike, tenantId: string, work: (client: SqlClientLike) => Promise<T>): Promise<T> {
  validateTenantId(tenantId)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await setTenantContext(client, tenantId)
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
