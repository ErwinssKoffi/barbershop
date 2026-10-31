import { cloudRows, stableCloudValue } from '../domain/cloudDelta'
import type { PublicSalonUser } from '../domain/models'
import { SalonProDatabase } from './database'
import { SalonRepositoryHub } from './repositories/salonRepositories'

export function workspaceKey(user: PublicSalonUser): string {
  return JSON.stringify([user.tenantId ?? 'local', user.id, user.role, 'v1'])
}
async function databaseName(identityName: string, scope: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(scope))
  const suffix = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${identityName}-account-${suffix}`
}
export async function openAccountWorkspace(identity: SalonProDatabase, user: PublicSalonUser): Promise<SalonRepositoryHub> {
  const destination = new SalonProDatabase(await databaseName(identity.name, workspaceKey(user)))
  let source = identity
  const predecessor = await identity.workspaceMeta.get(`scopePredecessor:${workspaceKey(user)}`)
  let predecessorDB: SalonProDatabase | undefined
  if (predecessor) {
    const name = await databaseName(identity.name, predecessor.value)
    if (await SalonProDatabase.exists(name)) { predecessorDB = new SalonProDatabase(name); source = predecessorDB }
  }
  // A cashier never adopts the legacy shared business database. It remains intact.
  let adopt = false
  if (user.role === 'manager') {
    await identity.transaction('rw', identity.workspaceMeta, identity.users, async () => {
      const owner = await identity.workspaceMeta.get('legacyWorkspaceOwner')
      const binding = await identity.workspaceMeta.get('cloudTenantId')
      const account = await identity.users.get(user.id)
      if (account?.role !== 'manager' || !account.isActive || (binding && binding.value !== user.tenantId)) return
      if (!owner) await identity.workspaceMeta.put({ key: 'legacyWorkspaceOwner', value: workspaceKey(user) })
      adopt = !owner || owner.value === workspaceKey(user)
    })
  }
  let legacyConflicts: string | undefined
  const data = (adopt || predecessorDB) ? await source.transaction('r', source.tables, async () => {
    legacyConflicts = (await source.workspaceMeta.get('syncConflicts'))?.value
    const result: Record<string, object[]> = {}
    for (const table of source.tables) {
      if (table.name !== 'users' && table.name !== 'workspaceMeta') result[table.name] = await table.toArray()
    }
    return result
  }) : {}
  predecessorDB?.close()
  await destination.transaction('rw', destination.tables, async () => {
    const scope = await destination.workspaceMeta.get('accountScope')
    if (scope && scope.value !== workspaceKey(user)) throw new Error('Espace local incompatible.')
    if (scope) return
    for (const [name, rows] of Object.entries(data)) if (rows.length) await destination.table(name).bulkPut(rows)
    if (legacyConflicts) await destination.workspaceMeta.put({ key: 'syncConflicts', value: legacyConflicts })
    await destination.workspaceMeta.put({ key: 'accountScope', value: workspaceKey(user) })
    if (user.tenantId) await destination.workspaceMeta.put({ key: 'cloudTenantId', value: user.tenantId })
    // Deliberately no legacy cursor/baseline: full reconciliation under this role.
  })
  const repo = new SalonRepositoryHub(destination)
  await repo.ensureInitialized()
  if (user.role === 'cashier') {
    const state = await repo.buildCloudSyncEnvelope()
    await destination.transaction('rw', destination.workspaceMeta, async () => {
      if (await destination.workspaceMeta.get('readonlySeedBaseline')) return
      const baseline = JSON.parse((await destination.workspaceMeta.get('syncBaseline'))?.value ?? '{}') as Record<string, string>
      for (const key of ['salon', 'settings', 'categories'] as const) {
        for (const row of cloudRows(state.payload, key)) baseline[`${key}:${row.id}`] = stableCloudValue(row)
      }
      await destination.workspaceMeta.bulkPut([{ key: 'syncBaseline', value: JSON.stringify(baseline) }, { key: 'readonlySeedBaseline', value: '1' }])
    })
  }
  return repo
}
