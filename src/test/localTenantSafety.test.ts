import { describe, expect, it } from 'vitest'
import { SalonProDatabase } from '../db/database'
import { SalonRepositoryHub } from '../db/repositories/salonRepositories'
import type { SalonUserAccount } from '../domain/models'

function account(tenantId: string): SalonUserAccount {
  return { id: crypto.randomUUID(), tenantId, email: `${tenantId}@example.invalid`, fullName: 'Compte Test', passwordHash: crypto.randomUUID(), role: 'manager', isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
}

describe('Garde de salon du poste local', () => {
  it('persiste le rattachement et refuse un autre salon sans déplacer ni supprimer les données', async () => {
    const name = `tenant-binding-${crypto.randomUUID()}`
    let db = new SalonProDatabase(name)
    let repo = new SalonRepositoryHub(db)
    const a = account(crypto.randomUUID())
    const b = account(crypto.randomUUID())
    try {
      await repo.ensureInitialized()
      await repo.cacheRemoteUserAccount(a)
      await repo.assertCloudWorkspace(a.tenantId)
      await expect(repo.cacheRemoteUserAccount(b)).rejects.toMatchObject({ name: 'WorkspaceTenantMismatchError' })
      expect(await db.users.get(a.id)).toBeDefined()
      expect(await db.users.get(b.id)).toBeUndefined()
      db.close()
      db = new SalonProDatabase(name)
      repo = new SalonRepositoryHub(db)
      await expect(repo.assertCloudWorkspace(b.tenantId)).rejects.toThrow('Reconnectez-vous')
      await repo.assertCloudWorkspace(a.tenantId)
      const backup = await repo.exportBackupPayload()
      await repo.importBackupPayload(backup)
      await repo.assertCloudWorkspace(a.tenantId)
    } finally { await db.delete() }
  })

  it('demande une reconnexion avant de synchroniser une base non rattachée ou un ancien jeton sans tid', async () => {
    const db = new SalonProDatabase(`tenant-unbound-${crypto.randomUUID()}`)
    const repo = new SalonRepositoryHub(db)
    try {
      await repo.ensureInitialized()
      await expect(repo.assertCloudWorkspace(crypto.randomUUID())).rejects.toThrow('Reconnectez-vous')
      await expect(repo.assertCloudWorkspace(undefined)).rejects.toThrow('Reconnectez-vous')
    } finally { await db.delete() }
  })
})
