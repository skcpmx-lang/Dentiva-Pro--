import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestEnv, completeSetupLogin, type TestEnv } from './helpers'
import { login, lock, unlock, changePassword, SessionManager } from '../src/main/services/auth'
import { getSetupState } from '../src/main/services/setup'

let env: TestEnv
let token: string

beforeAll(() => {
  env = createTestEnv()
  token = completeSetupLogin(env, 'admin', 'admin123')
})

afterAll(() => {
  env.cleanup()
})

describe('session management', () => {
  it('login returns a session with permissions and clinic name', () => {
    const result = login(env.ctx, env.sessions, 'admin', 'admin123')
    expect(result.token).toBeTruthy()
    expect(result.permissions.length).toBeGreaterThan(10)
    expect(result.clinicName).toBe('Smile Dental Care')
    expect(result.user.username).toBe('admin')
  })

  it('locks and unlocks with password re-verification', () => {
    const s = login(env.ctx, env.sessions, 'admin', 'admin123')
    lock(env.sessions, s.token)
    expect(env.sessions.get(s.token)?.locked).toBe(true)
    expect(() => unlock(env.ctx, env.sessions, s.token, 'wrongpass1')).toThrowError(/password/i)
    unlock(env.ctx, env.sessions, s.token, 'admin123')
    expect(env.sessions.get(s.token)?.locked).toBe(false)
  })

  it('drops a session on logout', () => {
    const s = login(env.ctx, env.sessions, 'admin', 'admin123')
    env.sessions.drop(s.token)
    expect(env.sessions.get(s.token)).toBeFalsy()
  })
})

describe('login lockout (5 failures → 15 minutes)', () => {
  it('locks the account after five bad attempts', () => {
    for (let i = 0; i < 5; i++) {
      expect(() => login(env.ctx, env.sessions, 'admin', 'badpass' + i)).toThrowError()
    }
    // correct password now also rejected while locked out
    expect(() => login(env.ctx, env.sessions, 'admin', 'admin123')).toThrowError(/locked|too many/i)
  })

  it('recovers after the lockout window passes', () => {
    const future = new Date(Date.now() + 16 * 60 * 1000)
    const env2: TestEnv = { ...env, ctx: { ...env.ctx, clock: () => future } }
    const result = login(env2.ctx, env.sessions, 'admin', 'admin123')
    expect(result.token).toBeTruthy()
  })
})

describe('password change', () => {
  it('changes the password and invalidates the old one', () => {
    const s = login(env.ctx, env.sessions, 'admin', 'admin123')
    changePassword(env.ctx, env.sessions, s.token, 'admin123', 'NewStrongPass1')
    expect(() => login(env.ctx, env.sessions, 'admin', 'admin123')).toThrowError(/Invalid username or password/)
    const s2 = login(env.ctx, env.sessions, 'admin', 'NewStrongPass1')
    expect(s2.token).toBeTruthy()
    // change back for other suites
    changePassword(env.ctx, env.sessions, s2.token, 'NewStrongPass1', 'admin123')
  })

  it('rejects a wrong current password', () => {
    const s = login(env.ctx, env.sessions, 'admin', 'admin123')
    expect(() => changePassword(env.ctx, env.sessions, s.token, 'nope1234', 'AnotherPass1')).toThrowError(/password/i)
  })

  it('rejects weak new passwords', () => {
    const s = login(env.ctx, env.sessions, 'admin', 'admin123')
    expect(() => changePassword(env.ctx, env.sessions, s.token, 'admin123', 'short')).toThrowError(/password/i)
    expect(() => changePassword(env.ctx, env.sessions, s.token, 'admin123', 'onlyletters')).toThrowError(/password/i)
  })
})

describe('setup state machine', () => {
  it('reports initialized after setup', () => {
    const state = getSetupState(env.ctx)
    expect(state.initialized).toBe(true)
    expect(state.activated).toBe(true)
  })
})

describe('SessionManager', () => {
  it('drops all sessions for a user', () => {
    const m = new SessionManager()
    const ctxAny = env.ctx as never
    const s1 = login(ctxAny, m, 'admin', 'admin123')
    const s2 = login(ctxAny, m, 'admin', 'admin123')
    m.dropUser(s1.user.id)
    expect(m.get(s1.token)).toBeFalsy()
    expect(m.get(s2.token)).toBeFalsy()
    void token
  })
})
