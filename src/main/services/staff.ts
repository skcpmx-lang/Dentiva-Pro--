import { z } from 'zod'
import type { AppContext, Actor } from '../core/context'
import { errValidation, errNotFound, errConflict } from '@shared/errors'
import type { StaffInput, UserInput, RoleInput, UserRecord } from '@shared/ipc'
import type { Staff, Role } from '@shared/types'
import type { Permission } from '@shared/permissions'
import { BLOOD_GROUPS } from '@shared/enums'
import { isValidDateStr } from '@shared/dates'
import { hashPassword, validatePasswordStrength } from './auth'
import { audit } from './audit'
import type { SessionManager } from './auth'

/* ---------------- Staff ---------------- */

function mapStaff(r: Record<string, unknown>): Staff {
  return {
    id: r.id as number,
    name: r.name as string,
    dob: (r.dob as string | null) ?? null,
    gender: (r.gender as Staff['gender']) ?? null,
    address: (r.address as string | null) ?? null,
    bloodGroup: (r.blood_group as Staff['bloodGroup']) ?? null,
    idDocument: (r.id_document as string | null) ?? null,
    photoPath: (r.photo_path as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    designation: (r.designation as string | null) ?? null,
    department: (r.department as string | null) ?? null,
    salary: (r.salary as number | null) ?? null,
    joiningDate: (r.joining_date as string | null) ?? null,
    status: r.status as 'active' | 'inactive',
    notes: (r.notes as string | null) ?? null
  }
}

export function staffList(ctx: AppContext, opts: { search?: string; page: number; pageSize: number }) {
  const page = Math.max(1, opts.page | 0 || 1)
  const pageSize = Math.min(200, Math.max(5, opts.pageSize | 0 || 25))
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (opts.search) {
    const s = opts.search.replace(/[\\%_]/g, (c) => `\\${c}`)
    where.push('(name LIKE $q ESCAPE "\\" OR designation LIKE $q ESCAPE "\\" OR department LIKE $q ESCAPE "\\" OR phone LIKE $q ESCAPE "\\")')
    params.$q = `%${s}%`
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = (ctx.db.prepare(`SELECT COUNT(*) AS c FROM staff ${whereSql}`).get(params) as { c: number }).c
  const rows = ctx.db.prepare(`SELECT * FROM staff ${whereSql} ORDER BY name COLLATE NOCASE LIMIT $limit OFFSET $offset`)
    .all({ ...params, $limit: pageSize, $offset: (page - 1) * pageSize }) as Record<string, unknown>[]
  return { rows: rows.map(mapStaff), total, page, pageSize }
}

export function staffGet(ctx: AppContext, id: number): Staff {
  const row = ctx.db.prepare('SELECT * FROM staff WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) throw errNotFound('Staff member not found.')
  return mapStaff(row)
}

const staffSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(2).max(160),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  gender: z.enum(['male', 'female', 'other']).nullable().optional(),
  address: z.string().max(400).nullable().optional(),
  bloodGroup: z.string().nullable().optional(),
  idDocument: z.string().max(60).nullable().optional(),
  photoPath: z.string().nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  designation: z.string().max(120).nullable().optional(),
  department: z.string().max(120).nullable().optional(),
  salary: z.number().int().min(0).nullable().optional(),
  joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  notes: z.string().max(2000).nullable().optional()
})

export function staffSave(ctx: AppContext, actor: Actor, input: StaffInput): Staff {
  const res = staffSchema.safeParse(input)
  if (!res.success) throw errValidation(Object.values(res.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid staff information.', res.error.flatten().fieldErrors)
  const d = res.data
  if (d.bloodGroup && !BLOOD_GROUPS.includes(d.bloodGroup as never)) throw errValidation('Invalid blood group.')
  if (d.dob && !isValidDateStr(d.dob)) throw errValidation('Invalid date of birth.')
  if (d.joiningDate && !isValidDateStr(d.joiningDate)) throw errValidation('Invalid joining date.')
  const ts = new Date(ctx.clock().getTime()).toISOString()
  const id = ctx.db.transaction((): number => {
    let staffId = d.id
    if (staffId) {
      const existing = ctx.db.prepare('SELECT * FROM staff WHERE id = ?').get(staffId)
      if (!existing) throw errNotFound('Staff member not found.')
      ctx.db.prepare(`
        UPDATE staff SET name = ?, dob = ?, gender = ?, address = ?, blood_group = ?, id_document = ?, photo_path = ?,
          phone = ?, designation = ?, department = ?, salary = ?, joining_date = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?
      `).run(
        d.name, d.dob ?? null, d.gender ?? null, d.address ?? null, d.bloodGroup ?? null, d.idDocument ?? null,
        d.photoPath ?? null, d.phone ?? null, d.designation ?? null, d.department ?? null, d.salary ?? null,
        d.joiningDate ?? null, d.status ?? 'active', d.notes ?? null, ts, staffId
      )
      audit(ctx, actor, { action: 'update', entity: 'staff', entityId: staffId, newValue: { ...d, salary: undefined } })
    } else {
      const r = ctx.db.prepare(`
        INSERT INTO staff (name, dob, gender, address, blood_group, id_document, photo_path, phone, designation,
          department, salary, joining_date, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        d.name, d.dob ?? null, d.gender ?? null, d.address ?? null, d.bloodGroup ?? null, d.idDocument ?? null,
        d.photoPath ?? null, d.phone ?? null, d.designation ?? null, d.department ?? null, d.salary ?? null,
        d.joiningDate ?? null, d.status ?? 'active', d.notes ?? null, ts, ts
      )
      staffId = Number(r.lastInsertRowid)
      audit(ctx, actor, { action: 'create', entity: 'staff', entityId: staffId, newValue: { ...d, salary: undefined } })
    }
    return staffId!
  })()
  return staffGet(ctx, id)
}

export function staffDelete(ctx: AppContext, actor: Actor, id: number): void {
  const existing = ctx.db.prepare('SELECT * FROM staff WHERE id = ?').get(id)
  if (!existing) throw errNotFound('Staff member not found.')
  const linked = ctx.db.prepare('SELECT COUNT(*) AS c FROM users WHERE staff_id = ?').get(id) as { c: number }
  if (linked.c > 0) throw errConflict('This staff member has a linked user account. Deactivate the staff profile instead.')
  const run = ctx.db.transaction(() => {
    ctx.db.prepare('DELETE FROM staff WHERE id = ?').run(id)
    audit(ctx, actor, { action: 'delete', entity: 'staff', entityId: id, oldValue: { ...mapStaff(existing as Record<string, unknown>), salary: undefined } })
  })
  run()
}

/* ---------------- Users ---------------- */

function mapUser(ctx: AppContext, r: Record<string, unknown>): UserRecord {
  const staffName = r.staff_id
    ? ((ctx.db.prepare('SELECT name FROM staff WHERE id = ?').get(r.staff_id) as { name: string } | undefined)?.name ?? null)
    : null
  return {
    id: r.id as number,
    username: r.username as string,
    displayName: r.display_name as string,
    roleId: r.role_id as number,
    roleName: (ctx.db.prepare('SELECT name FROM roles WHERE id = ?').get(r.role_id) as { name: string }).name,
    staffId: (r.staff_id as number | null) ?? null,
    staffName,
    isActive: r.is_active === 1,
    lastLoginAt: (r.last_login_at as string | null) ?? null,
    createdAt: r.created_at as string
  }
}

export function userList(ctx: AppContext): UserRecord[] {
  const rows = ctx.db.prepare('SELECT * FROM users ORDER BY username COLLATE NOCASE').all() as Record<string, unknown>[]
  return rows.map((r) => mapUser(ctx, r))
}

const userSchema = z.object({
  id: z.number().int().positive().optional(),
  username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/, 'Username may contain letters, numbers, dot, underscore and hyphen only.'),
  displayName: z.string().trim().min(2).max(120),
  roleId: z.number().int().positive(),
  staffId: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
  password: z.string().optional()
})

export function userSave(ctx: AppContext, actor: Actor, sessions: SessionManager, input: UserInput): UserRecord {
  const res = userSchema.safeParse(input)
  if (!res.success) throw errValidation(Object.values(res.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid user information.', res.error.flatten().fieldErrors)
  const d = res.data
  const role = ctx.db.prepare('SELECT * FROM roles WHERE id = ?').get(d.roleId) as { id: number; name: string } | undefined
  if (!role) throw errNotFound('Role not found.')
  if (d.staffId && !ctx.db.prepare('SELECT id FROM staff WHERE id = ?').get(d.staffId)) throw errNotFound('Staff member not found.')
  const ts = new Date(ctx.clock().getTime()).toISOString()
  const id = ctx.db.transaction((): number => {
    let userId = d.id
    if (userId) {
      const existing = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, unknown> | undefined
      if (!existing) throw errNotFound('User not found.')
      if (userId === actor.userId && d.isActive === false) throw errValidation('You cannot deactivate your own account.')
      if (userId === actor.userId && d.roleId !== existing.role_id) {
        throw errValidation('You cannot change your own role. Ask another administrator.')
      }
      // Guard: never demote/deactivate the last active user with user.manage.
      if ((d.isActive === false || roleIdLosesUserManage(ctx, d.roleId)) && userId !== actor.userId) {
        ensureNotLastManager(ctx, userId)
      }
      const dup = ctx.db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?').get(d.username, userId)
      if (dup) throw errConflict(`Username "${d.username}" is already in use.`)
      ctx.db.prepare(`
        UPDATE users SET username = ?, display_name = ?, role_id = ?, staff_id = ?, is_active = ?, must_change_password = ?, updated_at = ? WHERE id = ?
      `).run(
        d.username, d.displayName, d.roleId, d.staffId ?? null, d.isActive === false ? 0 : 1,
        d.password ? 1 : (existing.must_change_password as number), ts, userId
      )
      if (d.password) {
        validatePasswordStrength(d.password)
        ctx.db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?')
          .run(hashPassword(d.password), ts, userId)
      }
      audit(ctx, actor, { action: 'update', entity: 'user', entityId: userId, newValue: { ...d, password: undefined } })
      sessions.refreshActor(ctx, { token: '', userId, actor, locked: false, createdAt: ts } as never)
    } else {
      if (!d.password) throw errValidation('A password is required for a new user.')
      validatePasswordStrength(d.password)
      const dup = ctx.db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(d.username)
      if (dup) throw errConflict(`Username "${d.username}" is already in use.`)
      const r = ctx.db.prepare(`
        INSERT INTO users (username, password_hash, display_name, role_id, staff_id, is_active, must_change_password, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(d.username, hashPassword(d.password), d.displayName, d.roleId, d.staffId ?? null, d.isActive === false ? 0 : 1, 1, ts, ts)
      userId = Number(r.lastInsertRowid)
      audit(ctx, actor, { action: 'create', entity: 'user', entityId: userId, newValue: { ...d, password: undefined } })
    }
    return userId!
  })()
  const row = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown>
  return mapUser(ctx, row)
}

function roleIdLosesUserManage(ctx: AppContext, roleId: number): boolean {
  const has = ctx.db.prepare(`
    SELECT COUNT(*) AS c FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = ? AND p.key = 'user.manage'
  `).get(roleId) as { c: number }
  return has.c === 0
}

function ensureNotLastManager(ctx: AppContext, userId: number): void {
  const others = ctx.db.prepare(`
    SELECT COUNT(*) AS c FROM users u
    JOIN role_permissions rp ON rp.role_id = u.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE p.key = 'user.manage' AND u.is_active = 1 AND u.id != ?
  `).get(userId) as { c: number }
  if (others.c === 0) {
    throw errConflict('At least one active user with user management permission must remain. Promote another user first.')
  }
}

export function userSetStatus(ctx: AppContext, actor: Actor, sessions: SessionManager, id: number, isActive: boolean): UserRecord {
  const existing = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!existing) throw errNotFound('User not found.')
  if (id === actor.userId && !isActive) throw errValidation('You cannot deactivate your own account.')
  if (!isActive) ensureNotLastManager(ctx, id)
  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?').run(isActive ? 1 : 0, ts, id)
    audit(ctx, actor, { action: 'update', entity: 'user', entityId: id, oldValue: { isActive: existing.is_active === 1 }, newValue: { isActive } })
  })
  run()
  if (!isActive) sessions.dropUser(id)
  const row = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown>
  return mapUser(ctx, row)
}

/* ---------------- Roles & permissions ---------------- */

export function roleList(ctx: AppContext): Role[] {
  const roles = ctx.db.prepare('SELECT * FROM roles ORDER BY is_system DESC, name').all() as Record<string, unknown>[]
  const permsStmt = ctx.db.prepare(`
    SELECT p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?
  `)
  return roles.map((r) => ({
    id: r.id as number,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    isSystem: r.is_system === 1,
    permissions: (permsStmt.all(r.id) as { key: string }[]).map((p) => p.key as Permission)
  }))
}

const roleSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(2).max(40),
  description: z.string().max(200).nullable().optional(),
  permissions: z.array(z.string()).max(200)
})

export function roleSave(ctx: AppContext, actor: Actor, input: RoleInput): Role {
  const res = roleSchema.safeParse(input)
  if (!res.success) throw errValidation(Object.values(res.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid role.')
  const d = res.data
  const validPerms = new Set((ctx.db.prepare('SELECT key FROM permissions').all() as { key: string }[]).map((p) => p.key))
  const permList = [...new Set(d.permissions)] as string[]
  for (const p of permList) if (!validPerms.has(p)) throw errValidation(`Unknown permission "${p}".`)
  if (permList.length === 0) throw errValidation('A role needs at least one permission.')
  const ts = ctx.db.transaction((): number => {
    let roleId = d.id
    if (roleId) {
      const existing = ctx.db.prepare('SELECT * FROM roles WHERE id = ?').get(roleId) as Record<string, unknown> | undefined
      if (!existing) throw errNotFound('Role not found.')
      if (existing.name === 'Owner') throw errValidation('The Owner role is fixed and cannot be modified.')
      if (existing.is_system === 1 && existing.name !== 'Administrator') {
        // System roles keep their name; permissions may be adjusted.
      }
      const dup = ctx.db.prepare('SELECT id FROM roles WHERE name = ? COLLATE NOCASE AND id != ?').get(d.name, roleId)
      if (dup) throw errConflict('A role with this name already exists.')
      ctx.db.prepare('UPDATE roles SET name = ?, description = ? WHERE id = ?').run(d.name, d.description ?? null, roleId)
      ctx.db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId)
      audit(ctx, actor, {
        action: 'permission_change', entity: 'role', entityId: roleId,
        oldValue: { permissions: undefined }, newValue: { name: d.name, permissions: permList }
      })
    } else {
      const dup = ctx.db.prepare('SELECT id FROM roles WHERE name = ? COLLATE NOCASE').get(d.name)
      if (dup) throw errConflict('A role with this name already exists.')
      const r = ctx.db.prepare('INSERT INTO roles (name, description, is_system, created_at) VALUES (?, ?, 0, ?)')
        .run(d.name, d.description ?? null, new Date(ctx.clock().getTime()).toISOString())
      roleId = Number(r.lastInsertRowid)
      audit(ctx, actor, { action: 'permission_change', entity: 'role', entityId: roleId, newValue: { name: d.name, permissions: permList } })
    }
    const ins = ctx.db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE key = ?')
    for (const p of permList) ins.run(roleId, p)
    return roleId!
  })
  ts()
  return roleList(ctx).find((r) => r.id === (d.id ?? -1)) ?? roleList(ctx).find((r) => r.name === d.name)!
}

export function roleDelete(ctx: AppContext, actor: Actor, id: number): void {
  const existing = ctx.db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!existing) throw errNotFound('Role not found.')
  if (existing.is_system === 1) throw errValidation('System roles cannot be deleted.')
  const users = ctx.db.prepare('SELECT COUNT(*) AS c FROM users WHERE role_id = ?').get(id) as { c: number }
  if (users.c > 0) throw errConflict(`${users.c} user(s) still have this role. Reassign them first.`)
  const run = ctx.db.transaction(() => {
    ctx.db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(id)
    ctx.db.prepare('DELETE FROM roles WHERE id = ?').run(id)
    audit(ctx, actor, { action: 'delete', entity: 'role', entityId: id, oldValue: existing })
  })
  run()
}
