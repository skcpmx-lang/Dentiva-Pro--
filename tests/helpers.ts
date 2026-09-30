import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, migrate, type Db } from '../src/main/core/db'
import { seed } from '../src/main/core/seed'
import { buildPaths, type AppPaths } from '../src/main/core/paths'
import type { AppContext, Actor } from '../src/main/core/context'
import { SessionManager } from '../src/main/services/auth'
import { completeSetup } from '../src/main/services/setup'
import { ALL_PERMISSIONS } from '../src/shared/permissions'

export interface TestEnv {
  ctx: AppContext
  paths: AppPaths
  db: Db
  sessions: SessionManager
  owner: Actor
  cleanup: () => void
}

/**
 * Creates a real database in a temp directory with the production migration
 * and seed — the same code the app runs at startup.
 */
export function createTestEnv(): TestEnv {
  const dir = mkdtempSync(join(tmpdir(), 'dentiva-test-'))
  const paths = buildPaths(dir)
  const db = openDatabase(paths.dbPath)
  migrate(db)
  seed(db)
  const ctx: AppContext = { db, paths, clock: () => new Date(), appVersion: '1.0.0-test' }
  const sessions = new SessionManager()
  const owner: Actor = {
    userId: 0,
    username: 'test-owner',
    displayName: 'Test Owner',
    permissions: new Set<string>(ALL_PERMISSIONS)
  }
  const cleanup = (): void => {
    try {
      db.close()
    } catch {
      /* already closed */
    }
    rmSync(dir, { recursive: true, force: true })
  }
  return { ctx, paths, db, sessions, owner, cleanup }
}

/** An actor holding only the given permissions (RBAC tests). */
export function actorWith(username: string, perms: string[]): Actor {
  return { userId: 999, username, displayName: username, permissions: new Set(perms) }
}

/** Completes setup + login the same way first-run does, returning a session token. */
export function completeSetupLogin(env: TestEnv, username = 'admin', password = 'admin123'): string {
  // Ensure activation state exists (idempotent — the activation suite may have
  // already activated for real through the mocked verifier).
  env.db.prepare(
    `INSERT INTO activation_state (id, is_activated, activated_at, verifier_fingerprint, created_at, updated_at)
     VALUES (1, 1, '2026-01-01T00:00:00.000Z', 'test', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
     ON CONFLICT(id) DO NOTHING`
  ).run()
  const result = completeSetup(env.ctx, env.sessions, {
    clinic: { name: 'Smile Dental Care', address: '12 Green Road, Dhaka', phone: '01711000000' },
    dentists: [
      {
        fullName: 'Dr. Rahim Khan',
        designations: ['Consultant', 'Oral & Maxillofacial Surgeon'],
        qualifications: ['BDS', 'FCPS']
      }
    ],
    admin: { username, password, displayName: 'Clinic Owner' },
    settings: { autoLockMinutes: 10, backupFolder: null, theme: 'light', density: 'comfortable' }
  })
  // Point the shared owner actor at the real seeded admin user so audit
  // foreign keys stay valid for the rest of the suite.
  env.owner.userId = result.user.id
  env.owner.username = result.user.username
  env.owner.displayName = result.user.displayName
  return result.token
}
