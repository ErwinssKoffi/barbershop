import { useEffect } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SalonProDatabase } from '../db/database'
import { SalonRepositoryHub } from '../db/repositories/salonRepositories'
import { openAccountWorkspace } from '../db/accountWorkspace'
import { SalonStoreProvider } from '../hooks/SalonStoreProvider'
import { useSalonStore, type SalonStoreContextValue } from '../hooks/salonStoreContext'
import type { SalonUserAccount } from '../domain/models'

const databases = new Set<SalonProDatabase>()
afterEach(async () => { cleanup(); for (const db of databases) db.close(); for (const db of databases) { await db.delete() } databases.clear() })
function account(role: 'manager' | 'cashier', id = crypto.randomUUID()): SalonUserAccount {
 return { id, tenantId: 'tenant-account-test', fullName: 'Compte Autorisé', email: `${id}@example.invalid`, role, isActive: true, passwordHash: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
}
async function fixture() {
 const db = new SalonProDatabase(`account-test-${crypto.randomUUID()}`); databases.add(db)
 const repo = new SalonRepositoryHub(db); await repo.ensureInitialized()
 const manager = account('manager'); await repo.cacheRemoteUserAccount(manager)
 await repo.addRevenue({ date: new Date().toISOString(), label: 'Écriture préexistante', amount: 1200, categoryCode: 'hair_service', paymentMethod: 'cash' })
 await db.workspaceMeta.put({ key: 'syncCursor', value: '987' })
 return { db, repo, manager }
}
async function open(db: SalonProDatabase, user: SalonUserAccount) {
 const repo = await openAccountWorkspace(db, user); databases.add(repo.database); return repo
}
describe('Espaces locaux par compte, salon et rôle', () => {
 it('reprend une fois les données héritées du Gérant sans effacer la source ni reprendre le curseur', async () => {
  const { db, manager } = await fixture()
  const target = await open(db, manager)
  expect(await target.database.revenues.count()).toBe(1)
  expect(await db.revenues.count()).toBe(1)
  expect(await target.cloudSyncCursor()).toBeUndefined()
  expect(await target.database.users.count()).toBe(0)
  await target.database.revenues.clear()
  const reopened = await open(db, manager)
  expect(await reopened.database.revenues.count()).toBe(0)
  expect(await db.revenues.count()).toBe(1)
 })
 it('n’adopte jamais les données héritées dans un espace Caissier ou un autre compte', async () => {
  const { db, manager } = await fixture()
  await open(db, manager)
  const cashier = await open(db, account('cashier'))
  const another = await open(db, account('manager'))
  expect(await cashier.database.revenues.count()).toBe(0)
  expect(await another.database.revenues.count()).toBe(0)
  expect((await cashier.buildCloudDeltaEnvelope()).payload.categories).toEqual([])
  expect((await cashier.buildCloudDeltaEnvelope()).payload.settings).toBeUndefined()
  expect(await db.revenues.count()).toBe(1)
 })
 it('sépare les changements de rôle et conserve le cache de chaque espace', async () => {
  const { db, manager } = await fixture()
  const full = await open(db, manager)
  await full.database.workspaceMeta.put({ key: 'syncCursor', value: '23' })
  const limited = await open(db, { ...manager, role: 'cashier' })
  expect(limited.database.name).not.toBe(full.database.name)
  expect(await limited.cloudSyncCursor()).toBeUndefined()
  expect(await limited.database.revenues.count()).toBe(0)
  const anotherTenant = await open(db, { ...manager, tenantId: 'another-tenant' })
  expect(anotherTenant.database.name).not.toBe(full.database.name)
  expect(await anotherTenant.database.revenues.count()).toBe(0)
  const restored = await open(db, manager)
  expect(await restored.cloudSyncCursor()).toBe(23)
  expect(await restored.database.revenues.count()).toBe(1)
 })
 it('refuse une fonction de synchronisation périmée après bascule et vide la vue au logout', async () => {
  const { repo, manager } = await fixture()
  let context!: SalonStoreContextValue
  function Probe() { const value = useSalonStore(); useEffect(() => { context = value }, [value]); return null }
  render(<SalonStoreProvider repository={repo}><Probe /></SalonStoreProvider>)
  await act(async () => { await context.activateWorkspace!(manager) })
  expect(context.state.revenues).toHaveLength(1)
  const previous = context.syncWithRepo
  let managerDB!: SalonProDatabase
  await act(async () => { managerDB = await context.syncWithRepo(async (hub) => hub.database); databases.add(managerDB) })
  let release!: () => void
  const pause = new Promise<void>((resolve) => { release = resolve })
  const inflight = previous(async (hub) => {
    await pause
    return hub.addRevenue({ date: new Date().toISOString(), label: 'Saisie en cours avant bascule', amount: 3000, categoryCode: 'hair_service', paymentMethod: 'cash' })
  })
  await act(async () => { await context.activateWorkspace!(account('cashier')) })
  await act(async () => { databases.add(await context.syncWithRepo(async (hub) => hub.database)) })
  expect(context.state.revenues).toEqual([])
  await act(async () => { release(); await inflight })
  expect(await managerDB.revenues.count()).toBe(2)
  expect(context.state.revenues).toEqual([])
  await expect(previous(async () => true)).rejects.toThrow('déconnecté')
  await act(async () => { await context.activateWorkspace!(null) })
  expect(context.state.revenues).toEqual([])
  expect(context.ready).toBe(false)
  await expect(context.mutate(async () => true)).rejects.toThrow('déconnecté')
 })
})

describe('Projections locales Caissier', () => {
 it('ne renvoie pas les métadonnées locales de purge après réception des réglages publics', async () => {
  const { db } = await fixture()
  const repo = await open(db, account('cashier'))
  await repo.mergeCloudDelta({ cursor: 1, hasMore: false, changes: { settings: [{ id: 'default', theme: 'dark', dateFormat: 'long-fr', printHeaderNote: '', printCompact: false, updatedAt: new Date().toISOString() }] } })
  expect((await repo.buildCloudDeltaEnvelope()).payload.settings).toBeUndefined()
  expect((await repo.readFullState()).settings.theme).toBe('dark')
 })
})

describe('Passage d’un compte local au compte Cloud', () => {
 it('reprend l’espace local du même e-mail/rôle dans le nouvel espace Cloud sans détruire les données', async () => {
  const identity = new SalonProDatabase(`account-upgrade-${crypto.randomUUID()}`); databases.add(identity)
  const registry = new SalonRepositoryHub(identity)
  const local = { ...account('manager'), tenantId: undefined }
  await registry.cacheRemoteUserAccount(local)
  const previous = await open(identity, local)
  await previous.addRevenue({ date: new Date().toISOString(), label: 'Écriture avant connexion Cloud', amount: 2000, categoryCode: 'hair_service', paymentMethod: 'cash' })
  const cloud = { ...account('manager'), email: local.email }
  await registry.cacheRemoteUserAccount(cloud)
  const next = await open(identity, cloud)
  expect(await next.database.revenues.count()).toBe(1)
  expect(await previous.database.revenues.count()).toBe(1)
  expect(await next.cloudSyncCursor()).toBeUndefined()
  await next.assertCloudWorkspace(cloud.tenantId)
 })
})
