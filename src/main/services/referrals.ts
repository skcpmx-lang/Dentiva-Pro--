import { z } from 'zod'
import type { AppContext, Actor } from '../core/context'
import { errValidation, errNotFound } from '@shared/errors'
import type { VisitListQuery } from '@shared/ipc'
import type { Paginated } from '@shared/types'
import type { Referral } from '@shared/types'
import { resolveRange, isValidDateStr } from '@shared/dates'
import { audit } from './audit'

const referralSchema = z.object({
  patientId: z.number().int().positive(),
  visitId: z.number().int().positive().nullable().optional(),
  fromDentistId: z.number().int().positive(),
  toDoctorName: z.string().trim().min(2, 'Referred-to doctor name is required.').max(160),
  toClinic: z.string().trim().max(160).nullable().optional(),
  reason: z.string().trim().min(3, 'Reason is required.').max(1000),
  notes: z.string().max(2000).nullable().optional(),
  status: z.enum(['pending', 'completed', 'cancelled']).optional(),
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
})

function mapReferral(r: Record<string, unknown>): Referral {
  return {
    id: r.id as number,
    patientId: r.patient_id as number,
    visitId: (r.visit_id as number | null) ?? null,
    fromDentistId: r.from_dentist_id as number,
    toDoctorName: r.to_doctor_name as string,
    toClinic: (r.to_clinic as string | null) ?? null,
    reason: r.reason as string,
    notes: (r.notes as string | null) ?? null,
    status: r.status as Referral['status'],
    followUpDate: (r.follow_up_date as string | null) ?? null,
    createdAt: r.created_at as string,
    patientName: r.patientName as string,
    patientCode: r.patientCode as string,
    fromDentistName: r.dentistName as string
  }
}

const SELECT = `
  SELECT rf.*, p.full_name AS patientName, p.patient_code AS patientCode, d.full_name AS dentistName
  FROM referrals rf JOIN patients p ON p.id = rf.patient_id JOIN dentists d ON d.id = rf.from_dentist_id
`

export function referralList(ctx: AppContext, query: VisitListQuery): Paginated<Referral> {
  const page = Math.max(1, query.page | 0 || 1)
  const pageSize = Math.min(100, Math.max(5, query.pageSize | 0 || 25))
  const range = resolveRange(query.preset ?? '30d', { from: query.from, to: query.to }, ctx.clock())
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (query.patientId) { where.push('rf.patient_id = $patient'); params.patient = query.patientId }
  if (query.preset !== 'all') { where.push('rf.created_at >= $fromIso AND rf.created_at <= $toIso'); params.fromIso = `${range.from}T00:00:00.000Z`; params.toIso = `${range.to}T23:59:59.999Z` }
  if (query.search) {
    const s = query.search.replace(/[\\%_]/g, (c) => `\\${c}`)
    where.push('(p.full_name LIKE $q ESCAPE \'\\\' OR rf.to_doctor_name LIKE $q ESCAPE \'\\\' OR rf.to_clinic LIKE $q ESCAPE \'\\\')')
    params.q = `%${s}%`
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = (ctx.db.prepare(`SELECT COUNT(*) AS c FROM referrals rf JOIN patients p ON p.id = rf.patient_id ${whereSql}`).get(params) as { c: number }).c
  const rows = ctx.db.prepare(`${SELECT} ${whereSql} ORDER BY rf.created_at DESC LIMIT $limit OFFSET $offset`)
    .all({ ...params,limit: pageSize,offset: (page - 1) * pageSize }) as Record<string, unknown>[]
  return { rows: rows.map(mapReferral), total, page, pageSize }
}

function getOrThrow(ctx: AppContext, id: number): Referral {
  const row = ctx.db.prepare(`${SELECT} WHERE rf.id = ?`).get(id) as Record<string, unknown> | undefined
  if (!row) throw errNotFound('Referral not found.')
  return mapReferral(row)
}

export function referralSave(ctx: AppContext, actor: Actor, input: Record<string, unknown>): Referral {
  const res = referralSchema.safeParse(input)
  if (!res.success) throw errValidation(Object.values(res.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid referral.', res.error.flatten().fieldErrors)
  const d = res.data
  if (d.followUpDate && !isValidDateStr(d.followUpDate)) throw errValidation('Invalid follow-up date.')
  if (!ctx.db.prepare('SELECT id FROM patients WHERE id = ?').get(d.patientId)) throw errNotFound('Patient not found.')
  if (!ctx.db.prepare('SELECT id FROM dentists WHERE id = ?').get(d.fromDentistId)) throw errNotFound('Dentist not found.')
  if (d.visitId && !ctx.db.prepare('SELECT id FROM visits WHERE id = ? AND patient_id = ?').get(d.visitId, d.patientId)) {
    throw errValidation('The linked visit does not belong to this patient.')
  }
  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction((): number => {
    const id = (input as { id?: number }).id
    if (id) {
      if (!ctx.db.prepare('SELECT id FROM referrals WHERE id = ?').get(id)) throw errNotFound('Referral not found.')
      ctx.db.prepare(`
        UPDATE referrals SET visit_id = ?, from_dentist_id = ?, to_doctor_name = ?, to_clinic = ?, reason = ?,
          notes = ?, status = ?, follow_up_date = ?, updated_at = ? WHERE id = ?
      `).run(d.visitId ?? null, d.fromDentistId, d.toDoctorName, d.toClinic ?? null, d.reason, d.notes ?? null, d.status ?? 'pending', d.followUpDate ?? null, ts, id)
      audit(ctx, actor, { action: 'update', entity: 'referral', entityId: id, newValue: d })
      return id
    }
    const r = ctx.db.prepare(`
      INSERT INTO referrals (patient_id, visit_id, from_dentist_id, to_doctor_name, to_clinic, reason, notes, status,
        follow_up_date, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(d.patientId, d.visitId ?? null, d.fromDentistId, d.toDoctorName, d.toClinic ?? null, d.reason, d.notes ?? null, d.status ?? 'pending', d.followUpDate ?? null, actor.userId, ts, ts)
    const newId = Number(r.lastInsertRowid)
    audit(ctx, actor, { action: 'create', entity: 'referral', entityId: newId, newValue: d })
    return newId
  })
  return getOrThrow(ctx, run())
}

export function referralDelete(ctx: AppContext, actor: Actor, id: number): void {
  const existing = ctx.db.prepare('SELECT * FROM referrals WHERE id = ?').get(id)
  if (!existing) throw errNotFound('Referral not found.')
  const run = ctx.db.transaction(() => {
    ctx.db.prepare('DELETE FROM referrals WHERE id = ?').run(id)
    audit(ctx, actor, { action: 'delete', entity: 'referral', entityId: id, oldValue: existing })
  })
  run()
}
