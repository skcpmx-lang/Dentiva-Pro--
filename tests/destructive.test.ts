import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestEnv, completeSetupLogin, type TestEnv } from './helpers'
import { deleteBusinessData } from '../src/main/services/destructive'
import { patientCreate } from '../src/main/services/patients'
import { invoiceCreate } from '../src/main/services/invoices'
import { todayISO } from '../src/shared/dates'

let env: TestEnv

beforeAll(() => {
  env = createTestEnv()
  completeSetupLogin(env)
})

afterAll(() => {
  env.cleanup()
})

function seedBusinessData(): void {
  const p = patientCreate(env.ctx, env.owner, { fullName: 'Doomed Patient', gender: 'male', age: 60 })
  invoiceCreate(env.ctx, env.owner, { patientId: p.id, invoiceDate: todayISO(), lines: [{ description: 'Extraction', quantity: 1, unitPrice: 80000 }] })
}

describe('destructive operations', () => {
  it('refuses without the exact typed confirmation', async () => {
    seedBusinessData()
    const pre = await import('../src/main/services/backup').then((m) => m.createBackup(env.ctx, env.owner, 'pre_restore'))
    expect(() => deleteBusinessData(env.ctx, env.owner, 'business', 'DELETE ALL DATA', pre.path)).not.toThrowError()
    // re-seed for the wrong-confirm case
    seedBusinessData()
    const pre2 = await import('../src/main/services/backup').then((m) => m.createBackup(env.ctx, env.owner, 'pre_restore'))
    expect(() => deleteBusinessData(env.ctx, env.owner, 'business', 'yes', pre2.path)).toThrowError(/DELETE ALL DATA/)
  })

  it('business reset wipes business tables but keeps users/settings', async () => {
    seedBusinessData()
    const pre = await import('../src/main/services/backup').then((m) => m.createBackup(env.ctx, env.owner, 'pre_restore'))
    deleteBusinessData(env.ctx, env.owner, 'business', 'DELETE ALL DATA', pre.path)
    expect((env.db.prepare('SELECT COUNT(*) AS c FROM patients').get() as { c: number }).c).toBe(0)
    expect((env.db.prepare('SELECT COUNT(*) AS c FROM invoices').get() as { c: number }).c).toBe(0)
    expect((env.db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c).toBe(1)
    expect((env.db.prepare('SELECT COUNT(*) AS c FROM "settings"').get() as { c: number }).c).toBeGreaterThanOrEqual(1)
    // admin can still log in
    const { login } = await import('../src/main/services/auth')
    const s = login(env.ctx, env.sessions, 'admin', 'admin123')
    expect(s.token).toBeTruthy()
  })

  it('factory reset wipes everything and re-seeds (users gone, activation reset)', async () => {
    const pre = await import('../src/main/services/backup').then((m) => m.createBackup(env.ctx, env.owner, 'pre_restore'))
    deleteBusinessData(env.ctx, env.owner, 'factory', 'FACTORY RESET', pre.path)
    expect((env.db.prepare('SELECT COUNT(*) AS c FROM patients').get() as { c: number }).c).toBe(0)
    expect((env.db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c).toBe(0)
    const activation = env.db.prepare('SELECT is_activated FROM activation_state WHERE id = 1').get() as { is_activated: number } | undefined
    expect(activation ? activation.is_activated : 0).toBe(0)
    // permissions/roles are re-seeded
    expect((env.db.prepare('SELECT COUNT(*) AS c FROM permissions').get() as { c: number }).c).toBeGreaterThan(60)
    expect((env.db.prepare('SELECT COUNT(*) AS c FROM tooth_conditions').get() as { c: number }).c).toBeGreaterThan(0)
  })
})
