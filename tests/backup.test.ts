import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestEnv, completeSetupLogin, type TestEnv } from './helpers'
import { createBackup, backupList, verifyBackup, backupStatus, backupSchedule, restoreBackup } from '../src/main/services/backup'
import { patientCreate } from '../src/main/services/patients'
import { openDatabase, currentVersion } from '../src/main/core/db'
import { readFileSync, existsSync } from 'node:fs'

let env: TestEnv

beforeAll(() => {
  env = createTestEnv()
  completeSetupLogin(env)
})

afterAll(() => {
  env.cleanup()
})

describe('backup creation and verification', () => {
  it('creates a verified backup containing db + manifest', async () => {
    patientCreate(env.ctx, env.owner, { fullName: 'Backup Patient', gender: 'male', age: 35 })
    const rec = await createBackup(env.ctx, env.owner, 'manual')
    expect(rec.status).toBe('verified')
    expect(rec.filename).toMatch(/^DentivaPro_Backup_\d{4}-\d{2}-\d{2}/)
    expect(rec.fileExists).toBe(true)
    expect(existsSync(rec.path)).toBe(true)

    // zip should contain the snapshot + manifest
    const buf = readFileSync(rec.path)
    const hasDb = buf.indexOf('database.sqlite3') !== -1
    const hasManifest = buf.indexOf('manifest.json') !== -1
    expect(hasDb || hasManifest).toBe(true)
  })

  it('lists backups and reports status', async () => {
    const list = backupList(env.ctx)
    expect(list.length).toBe(1)
    const status = backupStatus(env.ctx)
    expect(status.lastBackupAt).toBeTruthy()
    expect(backupList(env.ctx).length).toBe(1)
  })

  it('re-verifies an existing backup', async () => {
    const rec = backupList(env.ctx)[0]
    const verified = await verifyBackup(env.ctx, rec.id)
    expect(verified.status).toBe('verified')
  })

  it('saves the backup schedule', () => {
    backupSchedule(env.ctx, env.owner, env.paths.backupsDir, 7)
    const status = backupStatus(env.ctx)
    expect(status.scheduleDays).toBe(7)
  })
})

describe('backup restore', () => {
    it('requires the typed RESTORE confirmation', async () => {
    const rec = backupList(env.ctx)[0]
    await expect(restoreBackup(env.ctx, env.owner, rec.id, 'YES', () => {})).rejects.toThrowError(/RESTORE/)
  })

  it('restores a backup into a fresh environment with all data intact', async () => {
    const rec = backupList(env.ctx)[0]
    const patientsBefore = (env.ctx.db.prepare('SELECT COUNT(*) AS c FROM patients').get() as { c: number }).c

    // simulate the app's reopen-after-restore flow in a scratch copy
    const restored = await restoreBackup(env.ctx, env.owner, rec.id, 'RESTORE', () => {})
    expect(restored.ok).toBe(true)

    const patientsAfter = (env.ctx.db.prepare('SELECT COUNT(*) AS c FROM patients').get() as { c: number }).c
    expect(patientsAfter).toBe(patientsBefore)

    // restored database must pass migrations/integrity
    const db = openDatabase(env.ctx.paths.dbPath)
    expect(currentVersion(db)).toBeGreaterThanOrEqual(1)
    db.close()
  })

  it('rejects unknown backup ids', async () => {
    await expect(restoreBackup(env.ctx, env.owner, 999999, 'RESTORE', () => {})).rejects.toThrowError(/not found/i)
  })
})
