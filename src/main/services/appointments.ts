import { z } from 'zod'
import type { AppContext, Actor } from '../core/context'
import { errValidation, errNotFound, errConflict } from '@shared/errors'
import type { AppointmentInput, AppointmentListQuery } from '@shared/ipc'
import type { Paginated } from '@shared/types'
import type { AppointmentRow, AppointmentStatus } from '@shared/types'
import { APPOINTMENT_STATUSES } from '@shared/enums'
import { isValidDateStr, isValidTimeStr } from '@shared/dates'
import { audit } from './audit'

const SELECT = `
  SELECT a.*, p.full_name AS patientName, p.patient_code AS patientCode, p.phone AS patientPhone, d.full_name AS dentistName
  FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN dentists d ON d.id = a.dentist_id
`

function mapRow(r: Record<string, unknown>): AppointmentRow {
  return {
    id: r.id as number,
    patientId: r.patient_id as number,
    dentistId: r.dentist_id as number,
    apptDate: r.appt_date as string,
    apptTime: r.appt_time as string,
    durationMinutes: (r.duration_minutes as number | null) ?? null,
    reason: (r.reason as string | null) ?? null,
    status: r.status as AppointmentStatus,
    notes: (r.notes as string | null) ?? null,
    sourceAppointmentId: (r.source_appointment_id as number | null) ?? null,
    cancelledReason: (r.cancelled_reason as string | null) ?? null,
    patientName: r.patientName as string,
    patientCode: r.patientCode as string,
    patientPhone: (r.patientPhone as string | null) ?? null,
    dentistName: r.dentistName as string
  }
}

export function appointmentList(ctx: AppContext, query: AppointmentListQuery): Paginated<AppointmentRow> {
  const page = Math.max(1, query.page | 0 || 1)
  const pageSize = Math.min(200, Math.max(5, query.pageSize | 0 || 100))
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (query.date) { where.push('a.appt_date = $date'); params.date = query.date }
  if (query.from) { where.push('a.appt_date >= $from'); params.from = query.from }
  if (query.to) { where.push('a.appt_date <= $to'); params.to = query.to }
  if (query.dentistId) { where.push('a.dentist_id = $dentist'); params.dentist = query.dentistId }
  if (query.patientId) { where.push('a.patient_id = $patient'); params.patient = query.patientId }
  if (query.status) { where.push('a.status = $status'); params.status = query.status }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = (ctx.db.prepare(
    `SELECT COUNT(*) AS c FROM appointments a JOIN patients p ON p.id = a.patient_id ${whereSql}`
  ).get(params) as { c: number }).c
  const rows = ctx.db.prepare(`${SELECT} ${whereSql} ORDER BY a.appt_date DESC, a.appt_time DESC LIMIT $limit OFFSET $offset`)
    .all({ ...params,limit: pageSize,offset: (page - 1) * pageSize }) as Record<string, unknown>[]
  return { rows: rows.map(mapRow), total, page, pageSize }
}

function getOrThrow(ctx: AppContext, id: number): AppointmentRow {
  const row = ctx.db.prepare(`${SELECT} WHERE a.id = ?`).get(id) as Record<string, unknown> | undefined
  if (!row) throw errNotFound('Appointment not found.')
  return mapRow(row)
}

const inputSchema = z.object({
  patientId: z.number().int().positive(),
  dentistId: z.number().int().positive(),
  apptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  apptTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  durationMinutes: z.number().int().min(5).max(480).nullable().optional(),
  reason: z.string().max(300).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  status: z.string().optional()
})

function validateRefs(ctx: AppContext, d: z.infer<typeof inputSchema>): void {
  if (!ctx.db.prepare('SELECT id FROM patients WHERE id = ?').get(d.patientId)) throw errNotFound('Patient not found.')
  const dentist = ctx.db.prepare('SELECT id, is_active FROM dentists WHERE id = ?').get(d.dentistId) as { is_active: number } | undefined
  if (!dentist) throw errNotFound('Dentist not found.')
  if (!dentist.is_active) throw errConflict('This dentist is inactive and cannot take new appointments.')
  if (d.status && !APPOINTMENT_STATUSES.includes(d.status as AppointmentStatus)) throw errValidation('Invalid appointment status.')
}

function checkConflict(ctx: AppContext, dentistId: number, date: string, time: string, duration: number, excludeId?: number): void {
  if (!duration) return
  const start = timeToMin(time)
  const end = start + duration
  const rows = ctx.db.prepare(
    "SELECT appt_time, duration_minutes FROM appointments WHERE dentist_id = ? AND appt_date = ? AND status NOT IN ('cancelled','no_show','rescheduled') AND id != ?"
  ).all(dentistId, date, excludeId ?? -1) as { appt_time: string; duration_minutes: number | null }[]
  for (const r of rows) {
    const s = timeToMin(r.appt_time)
    const e = s + (r.duration_minutes ?? 30)
    if (start < e && s < end) {
      throw errConflict(`This dentist already has an appointment at ${r.appt_time} on ${date}.`)
    }
  }
}

function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export function appointmentCreate(ctx: AppContext, actor: Actor, input: AppointmentInput): AppointmentRow {
  const res = inputSchema.safeParse(input)
  if (!res.success) throw errValidation(Object.values(res.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid appointment.', res.error.flatten().fieldErrors)
  const d = res.data
  if (!isValidDateStr(d.apptDate)) throw errValidation('Invalid appointment date.')
  if (!isValidTimeStr(d.apptTime)) throw errValidation('Invalid appointment time.')
  validateRefs(ctx, d)
  checkConflict(ctx, d.dentistId, d.apptDate, d.apptTime, d.durationMinutes ?? 30)
  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction((): number => {
    const r = ctx.db.prepare(`
      INSERT INTO appointments (patient_id, dentist_id, appt_date, appt_time, duration_minutes, reason, status, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(d.patientId, d.dentistId, d.apptDate, d.apptTime, d.durationMinutes ?? 30, d.reason ?? null, d.status ?? 'scheduled', d.notes ?? null, actor.userId, ts, ts)
    const id = Number(r.lastInsertRowid)
    audit(ctx, actor, { action: 'create', entity: 'appointment', entityId: id, newValue: d })
    return id
  })
  return getOrThrow(ctx, run())
}

export function appointmentUpdate(ctx: AppContext, actor: Actor, id: number, input: AppointmentInput): AppointmentRow {
  const existing = ctx.db.prepare('SELECT * FROM appointments WHERE id = ?').get(id)
  if (!existing) throw errNotFound('Appointment not found.')
  const res = inputSchema.safeParse(input)
  if (!res.success) throw errValidation(Object.values(res.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid appointment.')
  const d = res.data
  validateRefs(ctx, d)
  checkConflict(ctx, d.dentistId, d.apptDate, d.apptTime, d.durationMinutes ?? 30, id)
  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction(() => {
    ctx.db.prepare(`
      UPDATE appointments SET patient_id = ?, dentist_id = ?, appt_date = ?, appt_time = ?, duration_minutes = ?,
        reason = ?, notes = ?, updated_at = ? WHERE id = ?
    `).run(d.patientId, d.dentistId, d.apptDate, d.apptTime, d.durationMinutes ?? 30, d.reason ?? null, d.notes ?? null, ts, id)
    audit(ctx, actor, { action: 'update', entity: 'appointment', entityId: id, oldValue: existing, newValue: d })
  })
  run()
  return getOrThrow(ctx, id)
}

export function appointmentReschedule(ctx: AppContext, actor: Actor, id: number, apptDate: string, apptTime: string, reason?: string | null): AppointmentRow {
  const existing = getOrThrow(ctx, id)
  if (['cancelled', 'completed'].includes(existing.status)) {
    throw errConflict(`A ${existing.status} appointment cannot be rescheduled.`)
  }
  if (!isValidDateStr(apptDate) || !isValidTimeStr(apptTime)) throw errValidation('Invalid date or time.')
  checkConflict(ctx, existing.dentistId, apptDate, apptTime, existing.durationMinutes ?? 30, id)
  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction((): number => {
    ctx.db.prepare("UPDATE appointments SET status = 'rescheduled', updated_at = ? WHERE id = ?").run(ts, id)
    const r = ctx.db.prepare(`
      INSERT INTO appointments (patient_id, dentist_id, appt_date, appt_time, duration_minutes, reason, status, notes,
        source_appointment_id, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?)
    `).run(
      existing.patientId, existing.dentistId, apptDate, apptTime, existing.durationMinutes,
      reason ? `${existing.reason ?? ''} (rescheduled: ${reason})`.trim() : existing.reason,
      existing.notes, id, actor.userId, ts, ts
    )
    const newId = Number(r.lastInsertRowid)
    audit(ctx, actor, { action: 'update', entity: 'appointment', entityId: id, context: `Rescheduled to appointment #${newId} on ${apptDate} ${apptTime}` })
    return newId
  })
  return getOrThrow(ctx, run())
}

export function appointmentSetStatus(ctx: AppContext, actor: Actor, id: number, status: string, reason?: string | null): AppointmentRow {
  const existing = getOrThrow(ctx, id)
  if (!APPOINTMENT_STATUSES.includes(status as AppointmentStatus)) throw errValidation('Invalid appointment status.')
  if (status === 'cancelled' && !reason?.trim()) throw errValidation('A reason is required to cancel an appointment.')
  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE appointments SET status = ?, cancelled_reason = ?, updated_at = ? WHERE id = ?')
      .run(status, status === 'cancelled' ? (reason ?? null) : existing.cancelledReason, ts, id)
    audit(ctx, actor, {
      action: 'update', entity: 'appointment', entityId: id,
      oldValue: { status: existing.status }, newValue: { status }, context: reason ?? null
    })
  })
  run()
  return getOrThrow(ctx, id)
}

export function appointmentDelete(ctx: AppContext, actor: Actor, id: number): void {
  const existing = ctx.db.prepare('SELECT * FROM appointments WHERE id = ?').get(id)
  if (!existing) throw errNotFound('Appointment not found.')
  const linked = ctx.db.prepare('SELECT COUNT(*) AS c FROM queue_entries WHERE appointment_id = ?').get(id) as { c: number }
  const run = ctx.db.transaction(() => {
    if (linked.c > 0) ctx.db.prepare('UPDATE queue_entries SET appointment_id = NULL WHERE appointment_id = ?').run(id)
    ctx.db.prepare('DELETE FROM appointments WHERE id = ?').run(id)
    audit(ctx, actor, { action: 'delete', entity: 'appointment', entityId: id, oldValue: existing })
  })
  run()
}
