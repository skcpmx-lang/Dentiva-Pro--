import type { AppContext } from '../core/context'
import { errValidation, errConflict } from '@shared/errors'
import type { SetupCompletePayload, SetupState, LoginResult } from '@shared/ipc'
import { isActivated, activate } from './activation'
import { hashPassword, validatePasswordStrength, login, SessionManager } from './auth'
import { audit } from './audit'
import { getSettings } from './settings'
import type { AppSettings } from '@shared/settings'

export function getSetupState(ctx: AppContext): SetupState {
  const clinic = ctx.db.prepare('SELECT id FROM clinic WHERE id = 1').get()
  const users = ctx.db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }
  return { initialized: !!clinic && users.c > 0, activated: isActivated(ctx) }
}

function validStr(v: unknown, field: string, opts?: { min?: number; max?: number; required?: boolean }): string | null {
  const required = opts?.required !== false
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) {
    if (required) throw errValidation(`${field} is required.`)
    return null
  }
  if (opts?.min && s.length < opts.min) throw errValidation(`${field} must be at least ${opts.min} characters.`)
  if (opts?.max && s.length > opts.max) throw errValidation(`${field} must be at most ${opts.max} characters.`)
  return s
}

export function completeSetup(ctx: AppContext, sessions: SessionManager, payload: SetupCompletePayload): LoginResult {
  const state = getSetupState(ctx)
  if (state.initialized) throw errConflict('Setup has already been completed.')
  if (!isActivated(ctx)) throw errConflict('Activation is required before setup.')
  if (!payload?.clinic || !Array.isArray(payload.dentists) || !payload.admin) {
    throw errValidation('Incomplete setup payload.')
  }
  if (payload.dentists.length === 0) throw errValidation('At least one dentist is required.')

  const ts = new Date(ctx.clock().getTime()).toISOString()

  const clinicName = validStr(payload.clinic.name, 'Clinic name', { min: 2, max: 120 })!
  const clinicAddress = validStr(payload.clinic.address, 'Address', { min: 3, max: 400 })
  const clinicPhone = validStr(payload.clinic.phone, 'Phone', { min: 6, max: 30 })
  const clinicPhone2 = validStr(payload.clinic.phone2, 'Secondary phone', { required: false, max: 30 })
  const clinicEmail = validStr(payload.clinic.email, 'Email', { required: false, max: 120 })
  if (clinicEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clinicEmail)) throw errValidation('Email address is not valid.')

  for (const d of payload.dentists) {
    validStr(d.fullName, 'Dentist name', { min: 2, max: 120 })
    if (!Array.isArray(d.designations) || d.designations.length === 0) {
      throw errValidation('Each dentist needs at least one designation (e.g. Consultant).')
    }
  }

  const username = validStr(payload.admin.username, 'Username', { min: 3, max: 40 })!
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) throw errValidation('Username may contain letters, numbers, dot, underscore and hyphen only.')
  const displayName = validStr(payload.admin.displayName, 'Display name', { min: 2, max: 120 })!
  const password = String(payload.admin.password ?? '')
  validatePasswordStrength(password)

  const run = ctx.db.transaction(() => {
    ctx.db.prepare(
      `INSERT INTO clinic (id, name, address, phone, phone2, email, logo_path, tagline, footer_message, doctor_timing, created_at, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?)`
    ).run(
      clinicName, clinicAddress, clinicPhone, clinicPhone2, clinicEmail,
      validStr(payload.clinic.tagline, 'Tagline', { required: false, max: 160 }),
      ts, ts, ts
    )

    const insDentist = ctx.db.prepare(
      'INSERT INTO dentists (full_name, phone, email, working_schedule, is_active, notes, created_at, updated_at) VALUES (?, ?, ?, ?, 1, NULL, ?, ?)'
    )
    const insDesig = ctx.db.prepare('INSERT INTO dentist_designations (dentist_id, value, sort_order) VALUES (?, ?, ?)')
    const insQual = ctx.db.prepare('INSERT INTO dentist_qualifications (dentist_id, value, sort_order) VALUES (?, ?, ?)')
    for (const d of payload.dentists) {
      const res = insDentist.run(
        String(d.fullName).trim(),
        d.phone ? String(d.phone).trim() : null,
        d.email ? String(d.email).trim() : null,
        d.workingSchedule ? JSON.stringify(d.workingSchedule) : null,
        ts, ts
      )
      const id = Number(res.lastInsertRowid)
      ;(d.designations ?? []).filter(Boolean).forEach((v: string, i: number) => insDesig.run(id, String(v).trim(), i))
      ;((d as { qualifications?: string[] }).qualifications ?? []).filter(Boolean).forEach((v: string, i: number) =>
        insQual.run(id, String(v).trim(), i)
      )
    }

    const ownerRole = ctx.db.prepare("SELECT id FROM roles WHERE name = 'Owner'").get() as { id: number }
    ctx.db.prepare(
      'INSERT INTO users (username, password_hash, display_name, role_id, staff_id, is_active, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, 1, 0, ?, ?)'
    ).run(username, hashPassword(password), displayName, ownerRole.id, ts, ts)

    const s = getSettings(ctx)
    const next: AppSettings = {
      ...s,
      security: { ...s.security, autoLockMinutes: payload.settings?.autoLockMinutes ?? s.security.autoLockMinutes },
      backup: { ...s.backup, folder: payload.settings?.backupFolder ?? null },
      appearance: {
        theme: payload.settings?.theme === 'dark' ? 'dark' : 'light',
        density: payload.settings?.density === 'compact' ? 'compact' : 'comfortable'
      }
    }
    ctx.db.prepare("UPDATE settings SET value = ? WHERE key = 'settings'").run(JSON.stringify(next))

    audit(ctx, null, { action: 'create', entity: 'clinic', newValue: { name: clinicName }, context: 'First-run setup' })
    audit(ctx, null, {
      action: 'create', entity: 'user', newValue: { username, role: 'Owner' }, context: 'First-run setup (admin account)'
    })
  })
  run()

  return login(ctx, sessions, username, password)
}

export { activate as activateApp }
