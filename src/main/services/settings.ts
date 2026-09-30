import { z } from 'zod'
import type { AppContext, Actor } from '../core/context'
import { errValidation, errNotFound } from '@shared/errors'
import { DEFAULT_SETTINGS, SETTINGS_GROUPS, type AppSettings, type SettingsGroup } from '@shared/settings'
import { audit } from './audit'

export function getSettings(ctx: AppContext): AppSettings {
  const row = ctx.db.prepare("SELECT value FROM settings WHERE key = 'settings'").get() as { value: string } | undefined
  if (!row) return structuredClone(DEFAULT_SETTINGS) as AppSettings
  try {
    const parsed = JSON.parse(row.value) as Partial<AppSettings>
    // Merge over defaults so new setting keys always exist.
    const merged: Record<string, unknown> = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>
    for (const g of SETTINGS_GROUPS) {
      if (parsed[g] && typeof parsed[g] === 'object') {
        merged[g] = { ...(merged[g] as Record<string, unknown>), ...(parsed[g] as Record<string, unknown>) }
      }
    }
    return merged as unknown as AppSettings
  } catch {
    return structuredClone(DEFAULT_SETTINGS)
  }
}

function writeSettings(ctx: AppContext, next: AppSettings): void {
  ctx.db
    .prepare("INSERT INTO settings (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify(next))
}

const validators: Partial<Record<SettingsGroup, z.ZodType>> = {
  general: z.object({
    timezone: z.string().default('Asia/Dhaka'),
    patientCodePrefix: z.string().trim().min(1).max(12),
    invoicePrefix: z.string().trim().min(1).max(12),
    rxPrefix: z.string().trim().min(1).max(12)
  }).partial(),
  security: z.object({
    autoLockMinutes: z.number().int().refine((v) => [0, 5, 10, 15, 30].includes(v)),
    allowOverpayment: z.boolean()
  }).partial(),
  backup: z.object({
    folder: z.string().nullable(),
    scheduleDays: z.number().int().refine((v) => [0, 7, 15, 30].includes(v)),
    lastAutoBackupAt: z.string().nullable()
  }).partial(),
  notifications: z.object({
    appointments: z.boolean(), lowStock: z.boolean(), expiryDays: z.number().int().min(1).max(365),
    backup: z.boolean(), dues: z.boolean()
  }).partial(),
  appearance: z.object({ theme: z.enum(['light', 'dark']), density: z.enum(['comfortable', 'compact']) }).partial(),
  invoice: z.object({ footerNote: z.string().max(300), enableDiscount: z.boolean() }).partial(),
  prescription: z.object({
    footerMessage: z.string().max(300), doctorTiming: z.string().max(200), defaultPaper: z.string()
  }).partial(),
  printing: z.object({ defaultPaper: z.string() }).partial()
}

export function updateSettings(ctx: AppContext, actor: Actor, group: SettingsGroup, patch: Record<string, unknown>): AppSettings {
  if (!SETTINGS_GROUPS.includes(group)) throw errValidation(`Unknown settings group "${group}".`)
  const current = getSettings(ctx)
  const validator = validators[group]
  let cleaned: Record<string, unknown>
  if (validator) {
    const res = validator.safeParse(patch)
    if (!res.success) throw errValidation('Invalid settings value.', res.error.flatten().fieldErrors)
    cleaned = res.data as Record<string, unknown>
  } else {
    cleaned = patch
  }
  const next: Record<string, unknown> = structuredClone(current) as unknown as Record<string, unknown>
  next[group] = { ...(next[group] as Record<string, unknown>), ...cleaned }
  const run = ctx.db.transaction(() => {
    writeSettings(ctx, next as unknown as AppSettings)
    audit(ctx, actor, { action: 'settings_change', entity: 'settings', entityId: group, oldValue: current[group], newValue: cleaned })
  })
  run()
  return next as unknown as AppSettings
}

/** Transactionally allocate the next sequence number for a document code. */
export function nextSequence(ctx: AppContext, field: 'patientCodeNext' | 'invoiceNext' | 'rxNext'): number {
  const s = getSettings(ctx)
  const n = s.general[field]
  const next = structuredClone(s)
  next.general[field] = n + 1
  writeSettings(ctx, next as AppSettings)
  return n
}

export function peekSequence(ctx: AppContext, field: 'patientCodeNext' | 'invoiceNext' | 'rxNext'): number {
  return getSettings(ctx).general[field]
}

export function setSettingsForSystem(ctx: AppContext, mutate: (s: AppSettings) => AppSettings): void {
  writeSettings(ctx, mutate(getSettings(ctx)))
}

/* ------------ Clinic + dentists ------------ */

export interface ClinicRow {
  id: number
  name: string
  address: string | null
  phone: string | null
  phone2: string | null
  email: string | null
  logo_path: string | null
  tagline: string | null
  footer_message: string | null
  doctor_timing: string | null
}

export function getClinic(ctx: AppContext): ClinicRow {
  const row = ctx.db.prepare('SELECT * FROM clinic WHERE id = 1').get() as ClinicRow | undefined
  if (!row) throw errNotFound('Clinic profile is not configured yet.')
  return row
}

const clinicPatchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  address: z.string().trim().max(400).nullable().optional(),
  phone: z.string().trim().min(6).max(30).nullable().optional(),
  phone2: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().email().max(120).nullable().or(z.literal('')).optional(),
  logo_path: z.string().nullable().optional(),
  tagline: z.string().trim().max(160).nullable().optional(),
  footer_message: z.string().max(300).nullable().optional(),
  doctor_timing: z.string().max(200).nullable().optional()
})

export function updateClinic(ctx: AppContext, actor: Actor, patch: Record<string, unknown>): ClinicRow {
  const res = clinicPatchSchema.safeParse(patch)
  if (!res.success) throw errValidation('Invalid clinic information.', res.error.flatten().fieldErrors)
  const current = getClinic(ctx)
  const data = res.data
  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction(() => {
    ctx.db.prepare(
      `UPDATE clinic SET name = ?, address = ?, phone = ?, phone2 = ?, email = ?, logo_path = ?, tagline = ?,
       footer_message = ?, doctor_timing = ?, updated_at = ? WHERE id = 1`
    ).run(
      data.name ?? current.name,
      data.address !== undefined ? data.address : current.address,
      data.phone !== undefined ? data.phone : current.phone,
      data.phone2 !== undefined ? data.phone2 : current.phone2,
      data.email !== undefined ? (data.email === '' ? null : data.email) : current.email,
      data.logo_path !== undefined ? data.logo_path : current.logo_path,
      data.tagline !== undefined ? data.tagline : current.tagline,
      data.footer_message !== undefined ? data.footer_message : current.footer_message,
      data.doctor_timing !== undefined ? data.doctor_timing : current.doctor_timing,
      ts
    )
    audit(ctx, actor, { action: 'update', entity: 'clinic', entityId: 1, oldValue: current, newValue: data })
  })
  run()
  return getClinic(ctx)
}

export interface DentistRow {
  id: number
  full_name: string
  phone: string | null
  email: string | null
  signature_path: string | null
  working_schedule: string | null
  is_active: number
  notes: string | null
}

export function listDentists(ctx: AppContext, activeOnly = false): (DentistRow & { designations: string[]; qualifications: string[] })[] {
  const rows = (
    activeOnly
      ? ctx.db.prepare('SELECT * FROM dentists WHERE is_active = 1 ORDER BY full_name').all()
      : ctx.db.prepare('SELECT * FROM dentists ORDER BY full_name').all()
  ) as DentistRow[]
  const desig = ctx.db.prepare('SELECT dentist_id, value FROM dentist_designations WHERE dentist_id = ? ORDER BY sort_order')
  const qual = ctx.db.prepare('SELECT dentist_id, value FROM dentist_qualifications WHERE dentist_id = ? ORDER BY sort_order')
  return rows.map((d) => ({
    ...d,
    designations: (desig.all(d.id) as { value: string }[]).map((r) => r.value),
    qualifications: (qual.all(d.id) as { value: string }[]).map((r) => r.value)
  }))
}

const dentistSchema = z.object({
  id: z.number().int().positive().optional(),
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().email().max(120).nullable().or(z.literal('')).optional(),
  workingSchedule: z.record(z.string(), z.unknown()).nullable().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().max(1000).nullable().optional(),
  designations: z.array(z.string().trim().min(1).max(80)).min(1),
  qualifications: z.array(z.string().trim().min(1).max(80)).default([])
})

export function saveDentist(ctx: AppContext, actor: Actor, input: Record<string, unknown>): (DentistRow & { designations: string[]; qualifications: string[] }) {
  const res = dentistSchema.safeParse(input)
  if (!res.success) throw errValidation('Invalid dentist information.', res.error.flatten().fieldErrors)
  const d = res.data
  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction(() => {
    let id = d.id
    if (id) {
      const existing = ctx.db.prepare('SELECT * FROM dentists WHERE id = ?').get(id) as DentistRow | undefined
      if (!existing) throw errNotFound('Dentist not found.')
      ctx.db.prepare(
        'UPDATE dentists SET full_name = ?, phone = ?, email = ?, working_schedule = ?, is_active = ?, notes = ?, updated_at = ? WHERE id = ?'
      ).run(
        d.fullName, d.phone ?? null, d.email === '' ? null : (d.email || null),
        d.workingSchedule ? JSON.stringify(d.workingSchedule) : null, d.isActive === false ? 0 : 1, d.notes ?? null, ts, id
      )
      ctx.db.prepare('DELETE FROM dentist_designations WHERE dentist_id = ?').run(id)
      ctx.db.prepare('DELETE FROM dentist_qualifications WHERE dentist_id = ?').run(id)
      audit(ctx, actor, { action: 'update', entity: 'dentist', entityId: id, oldValue: existing, newValue: d })
    } else {
      const r = ctx.db.prepare(
        'INSERT INTO dentists (full_name, phone, email, working_schedule, is_active, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        d.fullName, d.phone ?? null, d.email === '' ? null : (d.email || null),
        d.workingSchedule ? JSON.stringify(d.workingSchedule) : null, d.isActive === false ? 0 : 1, d.notes ?? null, ts, ts
      )
      id = Number(r.lastInsertRowid)
      audit(ctx, actor, { action: 'create', entity: 'dentist', entityId: id, newValue: d })
    }
    const insD = ctx.db.prepare('INSERT INTO dentist_designations (dentist_id, value, sort_order) VALUES (?, ?, ?)')
    d.designations.forEach((v, i) => insD.run(id, v, i))
    const insQ = ctx.db.prepare('INSERT INTO dentist_qualifications (dentist_id, value, sort_order) VALUES (?, ?, ?)')
    d.qualifications.forEach((v, i) => insQ.run(id, v, i))
  })
  run()
  return listDentists(ctx).find((x) => x.id === (d.id ?? -1)) ?? listDentists(ctx).find((x) => x.full_name === d.fullName)!
}

export function deleteDentist(ctx: AppContext, actor: Actor, id: number, confirm: string): void {
  if (confirm !== 'DELETE') throw errValidation('Type DELETE to confirm dentist removal.')
  const existing = ctx.db.prepare('SELECT * FROM dentists WHERE id = ?').get(id) as DentistRow | undefined
  if (!existing) throw errNotFound('Dentist not found.')
  const usage = ctx.db.prepare('SELECT COUNT(*) AS c FROM visits WHERE dentist_id = ?').get(id) as { c: number }
  const appts = ctx.db.prepare('SELECT COUNT(*) AS c FROM appointments WHERE dentist_id = ?').get(id) as { c: number }
  if (usage.c > 0 || appts.c > 0) {
    throw errValidation('This dentist has visits or appointments on record. Deactivate the profile instead of deleting it.')
  }
  const run = ctx.db.transaction(() => {
    ctx.db.prepare('DELETE FROM dentist_designations WHERE dentist_id = ?').run(id)
    ctx.db.prepare('DELETE FROM dentist_qualifications WHERE dentist_id = ?').run(id)
    ctx.db.prepare('DELETE FROM dentists WHERE id = ?').run(id)
    audit(ctx, actor, { action: 'delete', entity: 'dentist', entityId: id, oldValue: existing })
  })
  run()
}
