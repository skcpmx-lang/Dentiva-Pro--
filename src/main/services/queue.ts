import type { AppContext, Actor } from '../core/context'
import { errValidation, errNotFound, errConflict } from '@shared/errors'
import type { QueueAddPayload } from '@shared/ipc'
import type { QueueEntry, QueueStatus } from '@shared/types'
import { QUEUE_STATUSES } from '@shared/enums'
import { todayISO } from '@shared/dates'
import { audit } from './audit'

function minutesSince(iso: string, nowMs: number): number {
  return Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 60000))
}

function mapRow(r: Record<string, unknown>, nowMs: number): QueueEntry {
  return {
    id: r.id as number,
    tokenNo: r.token_no as number,
    queueDate: r.queue_date as string,
    patientId: r.patient_id as number,
    appointmentId: (r.appointment_id as number | null) ?? null,
    dentistId: r.dentist_id as number,
    priority: r.priority as 'normal' | 'urgent',
    status: r.status as QueueStatus,
    arrivedAt: r.arrived_at as string,
    calledAt: (r.called_at as string | null) ?? null,
    startedAt: (r.started_at as string | null) ?? null,
    completedAt: (r.completed_at as string | null) ?? null,
    finishedAt: (r.finished_at as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    patientName: r.patientName as string,
    patientCode: r.patientCode as string,
    dentistName: r.dentistName as string,
    waitingMinutes: ['waiting', 'called'].includes(r.status as string) ? minutesSince(r.arrived_at as string, nowMs) : 0
  }
}

const SELECT = `
  SELECT q.*, p.full_name AS patientName, p.patient_code AS patientCode, d.full_name AS dentistName
  FROM queue_entries q JOIN patients p ON p.id = q.patient_id JOIN dentists d ON d.id = q.dentist_id
`

export function queueList(ctx: AppContext, date?: string): QueueEntry[] {
  const d = date ?? todayISO(ctx.clock())
  const rows = ctx.db.prepare(`${SELECT} WHERE q.queue_date = ? ORDER BY CASE q.priority WHEN 'urgent' THEN 0 ELSE 1 END, q.token_no`).all(d) as Record<string, unknown>[]
  const nowMs = ctx.clock().getTime()
  return rows.map((r) => mapRow(r, nowMs))
}

export function queueAdd(ctx: AppContext, actor: Actor, payload: QueueAddPayload): QueueEntry {
  if (!ctx.db.prepare('SELECT id FROM patients WHERE id = ?').get(payload.patientId)) throw errNotFound('Patient not found.')
  if (!ctx.db.prepare('SELECT id FROM dentists WHERE id = ?').get(payload.dentistId)) throw errNotFound('Dentist not found.')
  if (payload.appointmentId && !ctx.db.prepare('SELECT id FROM appointments WHERE id = ?').get(payload.appointmentId)) {
    throw errNotFound('Appointment not found.')
  }
  const date = todayISO(ctx.clock())
  const open = ctx.db.prepare(`
    SELECT q.id FROM queue_entries q WHERE q.patient_id = ? AND q.queue_date = ? AND q.status NOT IN ('finished','cancelled')
  `).get(payload.patientId, date) as { id: number } | undefined
  if (open) throw errConflict('This patient is already in today\u2019s queue.')

  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction((): number => {
    const maxToken = (ctx.db.prepare('SELECT COALESCE(MAX(token_no), 0) AS m FROM queue_entries WHERE queue_date = ?').get(date) as { m: number }).m
    const r = ctx.db.prepare(`
      INSERT INTO queue_entries (token_no, queue_date, patient_id, appointment_id, dentist_id, priority, status, arrived_at, notes)
      VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, ?)
    `).run(maxToken + 1, date, payload.patientId, payload.appointmentId ?? null, payload.dentistId, payload.priority, ts, payload.notes ?? null)
    const id = Number(r.lastInsertRowid)
    if (payload.appointmentId) {
      ctx.db.prepare("UPDATE appointments SET status = 'waiting', updated_at = ? WHERE id = ?").run(ts, payload.appointmentId)
    }
    audit(ctx, actor, { action: 'create', entity: 'queue_entry', entityId: id, newValue: { token: maxToken + 1, patientId: payload.patientId } })
    return id
  })
  const row = ctx.db.prepare(`${SELECT} WHERE q.id = ?`).get(run()) as Record<string, unknown>
  return mapRow(row, ctx.clock().getTime())
}

const TRANSITIONS: Record<QueueStatus, (QueueStatus | null)[]> = {
  waiting: ['called', 'cancelled'],
  called: ['in_treatment', 'waiting', 'cancelled'],
  in_treatment: ['billing', 'called'],
  billing: ['finished', 'in_treatment'],
  finished: [],
  cancelled: []
}


export function queueSetStatus(ctx: AppContext, actor: Actor, id: number, status: string): QueueEntry {
  const existing = ctx.db.prepare('SELECT * FROM queue_entries WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!existing) throw errNotFound('Queue entry not found.')
  if (!QUEUE_STATUSES.includes(status as QueueStatus)) throw errValidation('Invalid queue status.')
  const from = existing.status as QueueStatus
  const to = status as QueueStatus
  if (!TRANSITIONS[from].includes(to)) {
    throw errConflict(`Cannot move a ${from.replace('_', ' ')} patient to ${to.replace('_', ' ')}.`)
  }
  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction(() => {
    const sets = ['status = ?', 'notes = notes']
    const params: unknown[] = [to]
    if (to === 'called' && !existing.called_at) { sets.push('called_at = ?'); params.push(ts) }
    if (to === 'in_treatment' && !existing.started_at) { sets.push('started_at = ?'); params.push(ts) }
    if (to === 'billing') { sets.push('completed_at = ?'); params.push(ts) }
    if (to === 'finished') { sets.push('finished_at = ?'); params.push(ts) }
    params.push(id)
    ctx.db.prepare(`UPDATE queue_entries SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    audit(ctx, actor, { action: 'update', entity: 'queue_entry', entityId: id, oldValue: { status: from }, newValue: { status: to } })
  })
  run()
  const row = ctx.db.prepare(`${SELECT} WHERE q.id = ?`).get(id) as Record<string, unknown>
  return mapRow(row, ctx.clock().getTime())
}

export function queueRemove(ctx: AppContext, actor: Actor, id: number): void {
  const existing = ctx.db.prepare('SELECT * FROM queue_entries WHERE id = ?').get(id)
  if (!existing) throw errNotFound('Queue entry not found.')
  const run = ctx.db.transaction(() => {
    ctx.db.prepare('DELETE FROM queue_entries WHERE id = ?').run(id)
    audit(ctx, actor, { action: 'delete', entity: 'queue_entry', entityId: id, oldValue: existing })
  })
  run()
}
