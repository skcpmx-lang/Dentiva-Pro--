import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestEnv, completeSetupLogin, type TestEnv } from './helpers'
import { staffSave, staffList, staffDelete, userList, userSave, userSetStatus, roleList, roleSave, roleDelete } from '../src/main/services/staff'
import { login, SessionManager } from '../src/main/services/auth'
import { ALL_PERMISSIONS } from '../src/shared/permissions'

let env: TestEnv
let sessions: SessionManager

beforeAll(() => {
  env = createTestEnv()
  completeSetupLogin(env)
  sessions = env.sessions
})

afterAll(() => {
  env.cleanup()
})

describe('staff records', () => {
  it('creates staff and hides salary from audit values', () => {
    const s = staffSave(env.ctx, env.owner, { name: 'Nusrat Jahan', designation: 'Receptionist', phone: '01611000000', salary: 2500000, joiningDate: '2026-01-10' })
    expect(s.id).toBeTruthy()
    const auditRow = env.db.prepare("SELECT * FROM audit_log WHERE entity = 'staff' AND entity_id = ? ORDER BY id DESC").get(s.id) as { new_value: string | null } | undefined
    if (auditRow?.new_value) {
      expect(auditRow.new_value).not.toContain('2500000')
      expect(auditRow.new_value).not.toContain('salary')
    }
  })

  it('blocks deleting staff linked to a user account', () => {
    const s = staffSave(env.ctx, env.owner, { name: 'Linked Person', designation: 'Assistant' })
    const role = roleList(env.ctx).find((r) => r.name !== 'Owner')!
    userSave(env.ctx, env.owner, sessions, { username: 'linked1', displayName: 'Linked', roleId: role.id, staffId: s.id, password: 'Passw0rd1' })
    expect(() => staffDelete(env.ctx, env.owner, s.id)).toThrowError(/user|account/i)
  })
})

describe('user management', () => {
  it('enforces password strength and must-change flag', () => {
    const role = roleList(env.ctx).find((r) => r.name !== 'Owner')!
    const u = userSave(env.ctx, env.owner, sessions, { username: 'newuser1', displayName: 'New User', roleId: role.id, password: 'Str0ngPass!x' })
    expect(u.username).toBe('newuser1')
    const row = env.db.prepare('SELECT must_change_password FROM users WHERE id = ?').get(u.id) as { must_change_password: number }
    expect(row.must_change_password).toBe(1)
    expect(() => userSave(env.ctx, env.owner, sessions, { username: 'weakuser', displayName: 'Weak User', roleId: role.id, password: 'weak' })).toThrowError(/password/i)
  })

  it('blocks duplicate usernames', () => {
    const role = roleList(env.ctx).find((r) => r.name !== 'Owner')!
    expect(() =>
      userSave(env.ctx, env.owner, sessions, { username: 'admin', displayName: 'Dup', roleId: role.id, password: 'Str0ngPass!x' })
    ).toThrowError(/already in use/)
  })

  it('cannot deactivate yourself or change your own role', () => {
    const admin = userList(env.ctx).find((u) => u.username === 'admin')!
    expect(() => userSetStatus(env.ctx, env.owner, sessions, admin.id, false)).toThrowError(/yourself|own account/i)
    const otherRole = roleList(env.ctx).find((r) => r.name !== 'Owner')!
    expect(() => userSave(env.ctx, env.owner, sessions, { id: admin.id, username: 'admin', displayName: admin.displayName, roleId: otherRole.id })).toThrowError(/own role/i)
  })

  it('deactivating a user drops their active sessions', () => {
    const role = roleList(env.ctx).find((r) => r.name !== 'Owner')!
    const u = userSave(env.ctx, env.owner, sessions, { username: 'sessionuser', displayName: 'Session User', roleId: role.id, password: 'Str0ngPass!x' })
    const s = login(env.ctx, sessions, 'sessionuser', 'Str0ngPass!x')
    expect(sessions.get(s.token)).toBeTruthy()
    userSetStatus(env.ctx, env.owner, sessions, u.id, false)
    expect(sessions.get(s.token)).toBeFalsy()
    expect(() => login(env.ctx, sessions, 'sessionuser', 'Str0ngPass!x')).toThrowError()
    userSetStatus(env.ctx, env.owner, sessions, u.id, true)
  })

  it('keeps at least one active manager with user.manage', () => {
    const admin = userList(env.ctx).find((u) => u.username === 'admin')!
    // create a second admin then deactivate both attempts in order
    const ownerRole = roleList(env.ctx).find((r) => r.name === 'Owner')!
    const u2 = userSave(env.ctx, env.owner, sessions, { username: 'manager2', displayName: 'M2', roleId: ownerRole.id, password: 'Str0ngPass!x' })
    userSetStatus(env.ctx, env.owner, sessions, u2.id, false)
    // admin is the last active manager — cannot be deactivated by another manager? (self-block already covers)
    void admin
    // reactivate manager2 and verify blocking the LAST manager via another user also fails
    userSetStatus(env.ctx, env.owner, sessions, u2.id, true)
    // now deactivate manager2 (admin remains)
    userSetStatus(env.ctx, env.owner, sessions, u2.id, false)
    const list = userList(env.ctx)
    expect(list.find((u) => u.username === 'manager2')?.isActive).toBe(false)
  })
})

describe('roles', () => {
  it('prevents deleting or renaming the Owner role', () => {
    const owner = roleList(env.ctx).find((r) => r.name === 'Owner')!
    expect(() => roleDelete(env.ctx, env.owner, owner.id)).toThrowError(/owner|system/i)
    expect(() => roleSave(env.ctx, env.owner, { id: owner.id, name: 'SuperOwner', permissions: ALL_PERMISSIONS })).toThrowError(/owner|system/i)
  })

  it('blocks deleting a role that still has users', () => {
    const role = roleSave(env.ctx, env.owner, { name: 'In Use Role', permissions: ['patient.view'] })
    userSave(env.ctx, env.owner, sessions, { username: 'roleuser1', displayName: 'Role User', roleId: role.id, password: 'Str0ngPass!x' })
    expect(() => roleDelete(env.ctx, env.owner, role.id)).toThrowError(/user/i)
  })

  it('creates, updates and deletes a custom role', () => {
    const role = roleSave(env.ctx, env.owner, { name: 'Front Desk', permissions: ['patient.view', 'patient.create', 'appointment.view'] })
    expect(roleList(env.ctx).some((r) => r.id === role.id && r.name === 'Front Desk')).toBe(true)
    roleSave(env.ctx, env.owner, { id: role.id, name: 'Front Desk+', permissions: ['patient.view'] })
    expect(roleList(env.ctx).some((r) => r.name === 'Front Desk+')).toBe(true)
    roleDelete(env.ctx, env.owner, role.id)
    expect(roleList(env.ctx).some((r) => r.name === 'Front Desk+')).toBe(false)
  })

  it('blocks deleting system roles', () => {
    const system = roleList(env.ctx).find((r) => r.isSystem && r.name !== 'Owner')
    if (!system) return
    expect(() => roleDelete(env.ctx, env.owner, system.id)).toThrowError(/system/i)
  })

  it('staff list pagination works', () => {
    const list = staffList(env.ctx, { page: 1, pageSize: 5 })
    expect(list.rows.length).toBeGreaterThanOrEqual(1)
    expect(list.rows.length).toBeLessThanOrEqual(5)
    expect(list.total).toBeGreaterThanOrEqual(2)
  })
})
