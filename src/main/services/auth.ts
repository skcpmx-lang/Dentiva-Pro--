import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { AppContext, Actor } from '../core/context'
import { errValidation, errConflict } from '@shared/errors'
import type { LoginResult } from '@shared/ipc'
import type { SessionUser } from '@shared/types'
import type { Permission } from '@shared/permissions'
import { audit } from './audit'

const SCRYPT_N = 16384, SCRYPT_r = 8, SCRYPT_p = 1, KEYLEN = 64

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p })
  return `scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [alg, n, r, p, saltB64, hashB64] = stored.split('$')
    if (alg !== 'scrypt') return false
    const salt = Buffer.from(saltB64, 'base64')
    const expected = Buffer.from(hashB64, 'base64')
    const actual = scryptSync(password, salt, expected.length, { N: Number(n), r: Number(r), p: Number(p) })
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

export function validatePasswordStrength(password: string): void {
  if (typeof password !== 'string' || password.length < 8) {
    throw errValidation('Password must be at least 8 characters long.')
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw errValidation('Password must contain at least one letter and one digit.')
  }
}

interface UserRow {
  id: number
  username: string
  password_hash: string
  display_name: string
  role_id: number
  staff_id: number | null
  is_active: number
  failed_attempts: number
  locked_until: string | null
  role_name: string
}

const USER_SELECT = `
  SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.username = ? COLLATE NOCASE
`

export function loadActor(ctx: AppContext, userId: number): Actor | null {
  const row = ctx.db
    .prepare('SELECT u.id, u.username, u.display_name, u.is_active FROM users u WHERE u.id = ?')
    .get(userId) as { id: number; username: string; display_name: string; is_active: number } | undefined
  if (!row || !row.is_active) return null
  const perms = ctx.db
    .prepare(
      `SELECT DISTINCT p.key FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       JOIN roles r ON r.id = rp.role_id
       JOIN users u ON u.role_id = r.id WHERE u.id = ?`
    )
    .all(userId) as { key: string }[]
  return {
    userId: row.id,
    username: row.username,
    displayName: row.display_name,
    permissions: new Set(perms.map((p) => p.key))
  }
}

/* ------------ Session manager (main-process memory only) ------------ */

export interface Session {
  token: string
  userId: number
  actor: Actor
  locked: boolean
  createdAt: string
}

export class SessionManager {
  private sessions = new Map<string, Session>()

  create(actor: Actor): Session {
    const token = randomBytes(32).toString('hex')
    const session: Session = { token, userId: actor.userId, actor, locked: false, createdAt: new Date().toISOString() }
    this.sessions.set(token, session)
    return session
  }

  get(token: string): Session | null {
    return this.sessions.get(token) ?? null
  }

  refreshActor(ctx: AppContext, session: Session): void {
    const actor = loadActor(ctx, session.userId)
    if (!actor) {
      this.sessions.delete(session.token)
      return
    }
    session.actor = actor
  }

  /** Re-load permissions for every live session of a user (drops dead sessions). */
  refreshUser(ctx: AppContext, userId: number): void {
    for (const [token, s] of this.sessions) {
      if (s.userId === userId) {
        const actor = loadActor(ctx, userId)
        if (!actor || !actor.permissions.size) {
          this.sessions.delete(token)
        } else {
          s.actor = actor
        }
      }
    }
  }

  drop(token: string): void {
    this.sessions.delete(token)
  }

  dropUser(userId: number): void {
    for (const [t, s] of this.sessions) if (s.userId === userId) this.sessions.delete(t)
  }

  lockAll(): void {
    for (const s of this.sessions.values()) s.locked = true
  }
}

/* ------------ Login / lock / unlock ------------ */

export function login(ctx: AppContext, sessions: SessionManager, username: string, password: string): LoginResult {
  if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) {
    throw errValidation('Username and password are required.')
  }
  const row = ctx.db.prepare(USER_SELECT).get(username.trim()) as UserRow | undefined

  const nowMs = ctx.clock().getTime()
  if (row && row.locked_until && new Date(row.locked_until).getTime() > nowMs) {
    const mins = Math.ceil((new Date(row.locked_until).getTime() - nowMs) / 60000)
    throw errConflict(`Account is temporarily locked due to failed attempts. Try again in ${mins} minute(s).`)
  }

  if (!row || !verifyPassword(password, row.password_hash)) {
    if (row) {
      const attempts = row.failed_attempts + 1
      const lockedUntil = attempts >= 5 ? new Date(nowMs + 15 * 60 * 1000).toISOString() : null
      ctx.db
        .prepare('UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?')
        .run(attempts, lockedUntil, new Date(nowMs).toISOString(), row.id)
      audit(ctx, { userId: row.id, username: row.username, displayName: row.display_name, permissions: new Set() }, {
        action: 'login_failed', entity: 'user', entityId: row.id,
        context: attempts >= 5 ? 'Account locked (5 failed attempts)' : `Failed attempt ${attempts}`
      })
      if (lockedUntil) throw errConflict('Too many failed attempts. Account locked for 15 minutes.')
    }
    throw errValidation('Invalid username or password.')
  }

  if (!row.is_active) {
    audit(ctx, null, { action: 'login_failed', entity: 'user', entityId: row.id, context: 'Inactive account' })
    throw errConflict('This account is inactive. Contact your administrator.')
  }

  ctx.db
    .prepare("UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?")
    .run(new Date(nowMs).toISOString(), new Date(nowMs).toISOString(), row.id)

  const actor = loadActor(ctx, row.id)
  if (!actor) throw errConflict('This account is inactive. Contact your administrator.')

  const session = sessions.create(actor)
  const clinic = ctx.db.prepare('SELECT name FROM clinic WHERE id = 1').get() as { name: string } | undefined
  const user: SessionUser = {
    id: actor.userId, username: actor.username, displayName: actor.displayName,
    roleName: row.role_name, staffId: row.staff_id
  }
  audit(ctx, actor, { action: 'login', entity: 'user', entityId: row.id })
  return { token: session.token, user, permissions: [...actor.permissions] as Permission[], clinicName: clinic?.name ?? null }
}

export function lock(sessions: SessionManager, token: string): void {
  const s = sessions.get(token)
  if (s) s.locked = true
}

export function unlock(ctx: AppContext, sessions: SessionManager, token: string, password: string): void {
  const s = sessions.get(token)
  if (!s) throw errValidation('Session expired. Please sign in again.')
  const row = ctx.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(s.userId) as { password_hash: string } | undefined
  if (!row || !verifyPassword(password, row.password_hash)) {
    audit(ctx, s.actor, { action: 'security_event', entity: 'user', entityId: s.userId, context: 'Failed unlock attempt' })
    throw errValidation('Incorrect password.')
  }
  s.locked = false
  sessions.refreshActor(ctx, s)
  audit(ctx, s.actor, { action: 'unlock', entity: 'user', entityId: s.userId })
}

export function changePassword(ctx: AppContext, sessions: SessionManager, token: string, current: string, next: string): void {
  const s = sessions.get(token)
  if (!s) throw errValidation('Session expired. Please sign in again.')
  const row = ctx.db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(s.userId) as { id: number; password_hash: string } | undefined
  if (!row || !verifyPassword(current, row.password_hash)) throw errValidation('Current password is incorrect.')
  validatePasswordStrength(next)
  ctx.db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?')
    .run(hashPassword(next), new Date(ctx.clock().getTime()).toISOString(), row.id)
  audit(ctx, s.actor, { action: 'security_event', entity: 'user', entityId: row.id, context: 'Password changed' })
}
