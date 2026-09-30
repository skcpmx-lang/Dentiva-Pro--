import { z } from 'zod'
import type { AppContext, Actor } from '../core/context'
import { errValidation, errNotFound, errConflict } from '@shared/errors'
import type { VisitInput, VisitListQuery } from '@shared/ipc'
import type { Paginated } from '@shared/types'
import type { Visit, VisitTreatmentLine } from '@shared/types'
import { resolveRange, isValidDateStr, isValidTimeStr } from '@shared/dates'
import { lineTotalPaisa } from '@shared/money'
import { audit } from './audit'

const visitSchema = z.object({
  patientId: z.number().int().positive(),
  dentistId: z.number().int().positive(),
  visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  visitTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  reason: z.string().max(300).nullable().optional(),
  chiefComplaint: z.string().max(1000).nullable().optional(),
  examination: z.string().max(5000).nullable().optional(),
  diagnosis: z.string().max(5000).nullable().optional(),
  treatmentSummary: z.string().max(5000).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  followUpNote: z.string().max(500).nullable().optional(),
  status: z.enum(['open', 'completed']).optional(),
  treatments: z.array(z.object({
    treatmentId: z.number().int().positive().nullable().optional(),
    name: z.string().trim().min(1).max(200),
    toothNumbers: z.string().max(60).nullable().optional(),
    unitPrice: z.number().int().min(0),
    quantity: z.number().int().min(1).max(999),
    notes: z.string().max(300).nullable().optional()
  })).max(50).default([])
})

function validateRefs(ctx: AppContext, patientId: number, dentistId: number): void {
  if (!ctx.db.prepare('SELECT id FROM patients WHERE id = ?').get(patientId)) throw errNotFound('Patient not found.')
  const dentist = ctx.db.prepare('SELECT id, is_active FROM dentists WHERE id = ?').get(dentistId) as { id: number; is_active: number } | undefined
  if (!dentist) throw errNotFound('Dentist not found.')
  if (!dentist.is_active) throw errConflict('This dentist is inactive and cannot record visits.')
}

function getVisitOrThrow(ctx: AppContext, id: number): Visit {
  const v = ctx.db.prepare(`
    SELECT v.*, p.full_name AS patientName, p.patient_code AS patientCode, d.full_name AS dentistName
    FROM visits v JOIN patients p ON p.id = v.patient_id JOIN dentists d ON d.id = v.dentist_id
    WHERE v.id = ?
  `).get(id) as Record<string, unknown> | undefined
  if (!v) throw errNotFound('Visit not found.')
  const treatments = (ctx.db.prepare(
    'SELECT id, treatment_id, name, tooth_numbers, unit_price, quantity, line_total, notes FROM visit_treatments WHERE visit_id = ? ORDER BY id'
  ).all(id) as Record<string, unknown>[]).map(mapTreatmentLine)
  const rx = ctx.db.prepare('SELECT id FROM prescriptions WHERE visit_id = ?').get(id) as { id: number } | undefined
  const inv = ctx.db.prepare('SELECT id FROM invoices WHERE visit_id = ?').get(id) as { id: number } | undefined
  return {
    id: v.id as number,
    patientId: v.patient_id as number,
    dentistId: v.dentist_id as number,
    visitDate: v.visit_date as string,
    visitTime: v.visit_time as string,
    reason: (v.reason as string | null) ?? null,
    chiefComplaint: (v.chief_complaint as string | null) ?? null,
    examination: (v.examination as string | null) ?? null,
    diagnosis: (v.diagnosis as string | null) ?? null,
    treatmentSummary: (v.treatment_summary as string | null) ?? null,
    notes: (v.notes as string | null) ?? null,
    followUpDate: (v.follow_up_date as string | null) ?? null,
    followUpNote: (v.follow_up_note as string | null) ?? null,
    status: v.status as 'open' | 'completed',
    dentistName: v.dentistName as string,
    patientName: v.patientName as string,
    patientCode: v.patientCode as string,
    treatments,
    prescriptionId: rx?.id ?? null,
    invoiceId: inv?.id ?? null
  }
}

function mapTreatmentLine(r: Record<string, unknown>): VisitTreatmentLine {
  return {
    id: r.id as number,
    treatmentId: (r.treatment_id as number | null) ?? null,
    name: r.name as string,
    toothNumbers: (r.tooth_numbers as string | null) ?? null,
    unitPrice: r.unit_price as number,
    quantity: r.quantity as number,
    lineTotal: r.line_total as number,
    notes: (r.notes as string | null) ?? null
  }
}

export function visitList(ctx: AppContext, _actor: Actor, query: VisitListQuery): Paginated<Visit> {
  const page = Math.max(1, query.page | 0 || 1)
  const pageSize = Math.min(100, Math.max(5, query.pageSize | 0 || 25))
  const range = resolveRange(query.preset ?? '30d', { from: query.from, to: query.to }, ctx.clock())
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (query.patientId) { where.push('v.patient_id = $patient'); params.$patient = query.patientId }
  if (query.dentistId) { where.push('v.dentist_id = $dentist'); params.$dentist = query.dentistId }
  if (query.preset !== 'all') { where.push('v.visit_date >= $from AND v.visit_date <= $to'); params.$from = range.from; params.$to = range.to }
  if (query.search) {
    const s = query.search.replace(/[\\%_]/g, (c) => `\\${c}`)
    where.push('(p.full_name LIKE $q ESCAPE "\\" OR p.patient_code LIKE $q ESCAPE "\\" OR v.diagnosis LIKE $q ESCAPE "\\" OR v.chief_complaint LIKE $q ESCAPE "\\" OR v.notes LIKE $q ESCAPE "\\")')
    params.$q = `%${s}%`
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = (ctx.db.prepare(
    `SELECT COUNT(*) AS c FROM visits v JOIN patients p ON p.id = v.patient_id ${whereSql}`
  ).get(params) as { c: number }).c
  const rows = ctx.db.prepare(`
    SELECT v.id FROM visits v JOIN patients p ON p.id = v.patient_id ${whereSql}
    ORDER BY v.visit_date DESC, v.id DESC LIMIT $limit OFFSET $offset
  `).all({ ...params, $limit: pageSize, $offset: (page - 1) * pageSize }) as { id: number }[]
  return { rows: rows.map((r) => getVisitOrThrow(ctx, r.id)), total, page, pageSize }
}

export function visitGet(ctx: AppContext, id: number): Visit {
  return getVisitOrThrow(ctx, id)
}

export function visitCreate(ctx: AppContext, actor: Actor, input: VisitInput): Visit {
  const res = visitSchema.safeParse(input)
  if (!res.success) throw errValidation(Object.values(res.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid visit data.', res.error.flatten().fieldErrors)
  const d = res.data
  if (!isValidDateStr(d.visitDate)) throw errValidation('Invalid visit date.')
  if (!isValidTimeStr(d.visitTime)) throw errValidation('Invalid visit time.')
  if (d.followUpDate && !isValidDateStr(d.followUpDate)) throw errValidation('Invalid follow-up date.')
  validateRefs(ctx, d.patientId, d.dentistId)

  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction((): number => {
    const r = ctx.db.prepare(`
      INSERT INTO visits (patient_id, dentist_id, visit_date, visit_time, reason, chief_complaint, examination,
        diagnosis, treatment_summary, notes, follow_up_date, follow_up_note, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      d.patientId, d.dentistId, d.visitDate, d.visitTime, d.reason ?? null, d.chiefComplaint ?? null,
      d.examination ?? null, d.diagnosis ?? null, d.treatmentSummary ?? null, d.notes ?? null,
      d.followUpDate ?? null, d.followUpNote ?? null, d.status ?? 'completed', actor.userId, ts, ts
    )
    const id = Number(r.lastInsertRowid)
    const ins = ctx.db.prepare(
      'INSERT INTO visit_treatments (visit_id, treatment_id, name, tooth_numbers, unit_price, quantity, line_total, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    for (const t of d.treatments) {
      ins.run(id, t.treatmentId ?? null, t.name, t.toothNumbers ?? null, t.unitPrice, t.quantity, lineTotalPaisa(t.quantity, t.unitPrice), t.notes ?? null, ts)
    }
    audit(ctx, actor, { action: 'create', entity: 'visit', entityId: id, newValue: { ...d, treatments: d.treatments.length } })
    return id
  })
  return getVisitOrThrow(ctx, run())
}

export function visitUpdate(ctx: AppContext, actor: Actor, id: number, input: VisitInput): Visit {
  const existing = ctx.db.prepare('SELECT * FROM visits WHERE id = ?').get(id)
  if (!existing) throw errNotFound('Visit not found.')
  const res = visitSchema.safeParse({ ...input, patientId: (existing as { patient_id: number }).patient_id })
  if (!res.success) throw errValidation(Object.values(res.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid visit data.')
  const d = res.data
  if (d.followUpDate && !isValidDateStr(d.followUpDate)) throw errValidation('Invalid follow-up date.')
  validateRefs(ctx, d.patientId, d.dentistId)
  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction(() => {
    ctx.db.prepare(`
      UPDATE visits SET dentist_id = ?, visit_date = ?, visit_time = ?, reason = ?, chief_complaint = ?, examination = ?,
        diagnosis = ?, treatment_summary = ?, notes = ?, follow_up_date = ?, follow_up_note = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(
      d.dentistId, d.visitDate, d.visitTime, d.reason ?? null, d.chiefComplaint ?? null, d.examination ?? null,
      d.diagnosis ?? null, d.treatmentSummary ?? null, d.notes ?? null, d.followUpDate ?? null, d.followUpNote ?? null,
      d.status ?? 'completed', ts, id
    )
    ctx.db.prepare('DELETE FROM visit_treatments WHERE visit_id = ?').run(id)
    const ins = ctx.db.prepare(
      'INSERT INTO visit_treatments (visit_id, treatment_id, name, tooth_numbers, unit_price, quantity, line_total, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    for (const t of d.treatments) {
      ins.run(id, t.treatmentId ?? null, t.name, t.toothNumbers ?? null, t.unitPrice, t.quantity, lineTotalPaisa(t.quantity, t.unitPrice), t.notes ?? null, ts)
    }
    audit(ctx, actor, { action: 'update', entity: 'visit', entityId: id, oldValue: existing, newValue: d })
  })
  run()
  return getVisitOrThrow(ctx, id)
}

export function visitDelete(ctx: AppContext, actor: Actor, id: number, confirm: string): void {
  if (confirm !== 'DELETE') throw errValidation('Type DELETE to confirm visit deletion.')
  const existing = ctx.db.prepare('SELECT * FROM visits WHERE id = ?').get(id)
  if (!existing) throw errNotFound('Visit not found.')
  const rx = ctx.db.prepare('SELECT COUNT(*) AS c FROM prescriptions WHERE visit_id = ?').get(id) as { c: number }
  const inv = ctx.db.prepare('SELECT COUNT(*) AS c FROM invoices WHERE visit_id = ?').get(id) as { c: number }
  if (rx.c > 0 || inv.c > 0) {
    throw errConflict('This visit has prescriptions or invoices linked to it. Those documents must be handled first — visit history cannot be silently destroyed.')
  }
  const run = ctx.db.transaction(() => {
    ctx.db.prepare('DELETE FROM visit_treatments WHERE visit_id = ?').run(id)
    ctx.db.prepare('UPDATE chart_entries SET visit_id = NULL WHERE visit_id = ?').run(id)
    ctx.db.prepare('UPDATE attachments SET visit_id = NULL WHERE visit_id = ?').run(id)
    ctx.db.prepare('UPDATE referrals SET visit_id = NULL WHERE visit_id = ?').run(id)
    ctx.db.prepare('DELETE FROM visits WHERE id = ?').run(id)
    audit(ctx, actor, { action: 'delete', entity: 'visit', entityId: id, oldValue: existing })
  })
  run()
}
