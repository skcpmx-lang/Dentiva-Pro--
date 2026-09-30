import { z } from 'zod'
import type { AppContext, Actor } from '../core/context'
import { errValidation, errNotFound, errConflict } from '@shared/errors'
import type { PrescriptionInput, VisitListQuery } from '@shared/ipc'
import type { Paginated } from '@shared/types'
import type { Prescription, PrescriptionMedicine, Medicine, Gender } from '@shared/types'
import { resolveRange, isValidDateStr } from '@shared/dates'
import { nextSequence, getSettings } from './settings'
import { audit } from './audit'

/* ---------------- Clinical options (C/C, O/E, advice) ---------------- */

export interface ClinicalOptionRow {
  id: number
  kind: 'cc' | 'oe' | 'advice'
  value: string
  sort_order: number
  is_active: number
}

export function clinicalOptions(ctx: AppContext, kind?: 'cc' | 'oe' | 'advice'): (ClinicalOptionRow & { sortOrder: number; isActive: boolean })[] {
  const rows = kind
    ? ctx.db.prepare('SELECT * FROM clinical_options WHERE kind = ? ORDER BY sort_order, value').all(kind)
    : ctx.db.prepare('SELECT * FROM clinical_options ORDER BY kind, sort_order, value').all()
  return (rows as ClinicalOptionRow[]).map((r) => ({
    ...r, sortOrder: r.sort_order, isActive: r.is_active === 1
  }))
}

const optionSchema = z.object({
  id: z.number().int().positive().optional(),
  kind: z.enum(['cc', 'oe', 'advice']),
  value: z.string().trim().min(1).max(120),
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true)
})

export function clinicalOptionSave(ctx: AppContext, actor: Actor, input: Record<string, unknown>) {
  const res = optionSchema.safeParse(input)
  if (!res.success) throw errValidation(Object.values(res.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid option.')
  const d = res.data
  const run = ctx.db.transaction(() => {
    if (d.id) {
      ctx.db.prepare('UPDATE clinical_options SET kind = ?, value = ?, sort_order = ?, is_active = ? WHERE id = ?')
        .run(d.kind, d.value, d.sortOrder, d.isActive ? 1 : 0, d.id)
      audit(ctx, actor, { action: 'update', entity: 'clinical_option', entityId: d.id, newValue: d })
    } else {
      const dup = ctx.db.prepare('SELECT id FROM clinical_options WHERE kind = ? AND value = ?').get(d.kind, d.value)
      if (dup) throw errConflict('This option already exists.')
      ctx.db.prepare('INSERT INTO clinical_options (kind, value, sort_order, is_active) VALUES (?, ?, ?, ?)')
        .run(d.kind, d.value, d.sortOrder, d.isActive ? 1 : 0)
      audit(ctx, actor, { action: 'create', entity: 'clinical_option', newValue: d })
    }
  })
  run()
  return clinicalOptions(ctx)
}

export function clinicalOptionDelete(ctx: AppContext, actor: Actor, id: number) {
  const existing = ctx.db.prepare('SELECT * FROM clinical_options WHERE id = ?').get(id)
  if (!existing) throw errNotFound('Option not found.')
  const run = ctx.db.transaction(() => {
    ctx.db.prepare('DELETE FROM clinical_options WHERE id = ?').run(id)
    audit(ctx, actor, { action: 'delete', entity: 'clinical_option', entityId: id, oldValue: existing })
  })
  run()
  return clinicalOptions(ctx)
}

/* ---------------- Medicine catalog ---------------- */

export function medicineList(ctx: AppContext, opts: { search?: string; activeOnly?: boolean }): Medicine[] {
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (opts.activeOnly) where.push('is_active = 1')
  if (opts.search) {
    const s = opts.search.replace(/[\\%_]/g, (c) => `\\${c}`)
    where.push('(name LIKE $q ESCAPE \'\\\' OR generic_name LIKE $q ESCAPE \'\\\')')
    params.q = `%${s}%`
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const rows = ctx.db.prepare(`SELECT * FROM medicines ${whereSql} ORDER BY name COLLATE NOCASE LIMIT 200`).all(params) as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r.id as number,
    name: r.name as string,
    genericName: (r.generic_name as string | null) ?? null,
    doseForm: (r.dose_form as Medicine['doseForm']) ?? null,
    commonStrength: (r.common_strength as string | null) ?? null,
    isActive: r.is_active === 1
  }))
}

const medicineSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(160),
  genericName: z.string().max(160).nullable().optional(),
  doseForm: z.string().max(30).nullable().optional(),
  commonStrength: z.string().max(60).nullable().optional(),
  isActive: z.boolean().optional()
})

export function medicineSave(ctx: AppContext, actor: Actor, input: Record<string, unknown>): Medicine {
  const res = medicineSchema.safeParse(input)
  if (!res.success) throw errValidation(Object.values(res.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid medicine.')
  const d = res.data
  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction((): number => {
    let id = d.id
    if (id) {
      if (!ctx.db.prepare('SELECT id FROM medicines WHERE id = ?').get(id)) throw errNotFound('Medicine not found.')
      ctx.db.prepare('UPDATE medicines SET name = ?, generic_name = ?, dose_form = ?, common_strength = ?, is_active = ?, updated_at = ? WHERE id = ?')
        .run(d.name, d.genericName ?? null, d.doseForm ?? null, d.commonStrength ?? null, d.isActive === false ? 0 : 1, ts, id)
      audit(ctx, actor, { action: 'update', entity: 'medicine', entityId: id, newValue: d })
    } else {
      const r = ctx.db.prepare('INSERT INTO medicines (name, generic_name, dose_form, common_strength, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(d.name, d.genericName ?? null, d.doseForm ?? null, d.commonStrength ?? null, d.isActive === false ? 0 : 1, ts, ts)
      id = Number(r.lastInsertRowid)
      audit(ctx, actor, { action: 'create', entity: 'medicine', entityId: id, newValue: d })
    }
    return id!
  })
  const row = ctx.db.prepare('SELECT * FROM medicines WHERE id = ?').get(run()) as Record<string, unknown>
  return {
    id: row.id as number, name: row.name as string, genericName: (row.generic_name as string | null) ?? null,
    doseForm: (row.dose_form as Medicine['doseForm']) ?? null, commonStrength: (row.common_strength as string | null) ?? null,
    isActive: row.is_active === 1
  }
}

export function medicineDelete(ctx: AppContext, actor: Actor, id: number): void {
  const existing = ctx.db.prepare('SELECT * FROM medicines WHERE id = ?').get(id)
  if (!existing) throw errNotFound('Medicine not found.')
  const used = ctx.db.prepare('SELECT COUNT(*) AS c FROM prescription_medicines WHERE medicine_id = ?').get(id) as { c: number }
  if (used.c > 0) throw errConflict('This medicine is used in prescription history. Deactivate it instead.')
  const run = ctx.db.transaction(() => {
    ctx.db.prepare('DELETE FROM medicines WHERE id = ?').run(id)
    audit(ctx, actor, { action: 'delete', entity: 'medicine', entityId: id, oldValue: existing })
  })
  run()
}

/* ---------------- Prescriptions ---------------- */

const medicineEntrySchema = z.object({
  medicineId: z.number().int().positive().nullable().optional(),
  name: z.string().trim().min(1, 'Medicine name is required.').max(160),
  doseForm: z.string().max(30).nullable().optional(),
  strength: z.string().max(60).nullable().optional(),
  dose: z.string().max(60).nullable().optional(),
  morning: z.boolean().optional(),
  noon: z.boolean().optional(),
  night: z.boolean().optional(),
  meal: z.enum(['before', 'after']).nullable().optional(),
  durationValue: z.number().int().min(0).max(365).nullable().optional(),
  durationUnit: z.enum(['day', 'week', 'month']).nullable().optional(),
  quantity: z.string().max(30).nullable().optional(),
  instruction: z.string().max(300).nullable().optional(),
  isPrn: z.boolean().optional(),
  customInstruction: z.string().max(300).nullable().optional(),
  sortOrder: z.number().int().min(0).max(99)
})

const rxSchema = z.object({
  patientId: z.number().int().positive(),
  visitId: z.number().int().positive().nullable().optional(),
  dentistId: z.number().int().positive(),
  rxDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cc: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  oe: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  advice: z.string().max(3000).nullable().optional(),
  extraAdvice: z.string().max(3000).nullable().optional(),
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  medicines: z.array(medicineEntrySchema).min(1, 'Add at least one medicine to the prescription.').max(30)
})

function mapPrescription(ctx: AppContext, row: Record<string, unknown>): Prescription {
  const patient = ctx.db.prepare('SELECT full_name, patient_code, age, gender FROM patients WHERE id = ?').get(row.patient_id) as
    { full_name: string; patient_code: string; age: number | null; gender: Gender } | undefined
  const dentist = ctx.db.prepare('SELECT full_name FROM dentists WHERE id = ?').get(row.dentist_id) as { full_name: string }
  const designations = (ctx.db.prepare('SELECT value FROM dentist_designations WHERE dentist_id = ? ORDER BY sort_order').all(row.dentist_id) as { value: string }[]).map((r) => r.value)
  const qualifications = (ctx.db.prepare('SELECT value FROM dentist_qualifications WHERE dentist_id = ? ORDER BY sort_order').all(row.dentist_id) as { value: string }[]).map((r) => r.value)
  const meds = (ctx.db.prepare('SELECT * FROM prescription_medicines WHERE prescription_id = ? ORDER BY sort_order, id').all(row.id) as Record<string, unknown>[]).map(mapMedicine)
  return {
    id: row.id as number,
    rxNo: row.rx_no as string,
    patientId: row.patient_id as number,
    visitId: (row.visit_id as number | null) ?? null,
    dentistId: row.dentist_id as number,
    rxDate: row.rx_date as string,
    cc: JSON.parse((row.cc_json as string) || '[]'),
    oe: JSON.parse((row.oe_json as string) || '[]'),
    advice: (row.advice as string | null) ?? null,
    extraAdvice: (row.extra_advice as string | null) ?? null,
    followUpDate: (row.follow_up_date as string | null) ?? null,
    status: row.status as 'active' | 'void',
    patientName: patient?.full_name ?? '—',
    patientCode: patient?.patient_code ?? '—',
    patientAge: patient?.age ?? null,
    patientGender: patient?.gender ?? 'other',
    dentistName: dentist.full_name,
    dentistDesignations: designations,
    dentistQualifications: qualifications,
    medicines: meds
  }
}

function mapMedicine(r: Record<string, unknown>): PrescriptionMedicine {
  return {
    id: r.id as number,
    medicineId: (r.medicine_id as number | null) ?? null,
    name: r.name as string,
    doseForm: (r.dose_form as PrescriptionMedicine['doseForm'] | null) ?? null,
    strength: (r.strength as string | null) ?? null,
    dose: (r.dose as string | null) ?? null,
    morning: r.morning === 1,
    noon: r.noon === 1,
    night: r.night === 1,
    meal: (r.meal as 'before' | 'after' | null) ?? null,
    durationValue: (r.duration_value as number | null) ?? null,
    durationUnit: (r.duration_unit as PrescriptionMedicine['durationUnit']) ?? null,
    quantity: (r.quantity as string | null) ?? null,
    instruction: (r.instruction as string | null) ?? null,
    isPrn: r.is_prn === 1,
    customInstruction: (r.custom_instruction as string | null) ?? null,
    sortOrder: r.sort_order as number
  }
}

export function prescriptionList(ctx: AppContext, _actor: Actor, query: VisitListQuery): Paginated<Prescription> {
  const page = Math.max(1, query.page | 0 || 1)
  const pageSize = Math.min(100, Math.max(5, query.pageSize | 0 || 25))
  const range = resolveRange(query.preset ?? '30d', { from: query.from, to: query.to }, ctx.clock())
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (query.patientId) { where.push('rx.patient_id = $patient'); params.patient = query.patientId }
  if (query.dentistId) { where.push('rx.dentist_id = $dentist'); params.dentist = query.dentistId }
  if (query.preset !== 'all') { where.push('rx.rx_date >= $from AND rx.rx_date <= $to'); params.from = range.from; params.to = range.to }
  if (query.search) {
    const s = query.search.replace(/[\\%_]/g, (c) => `\\${c}`)
    where.push('(p.full_name LIKE $q ESCAPE \'\\\' OR p.patient_code LIKE $q ESCAPE \'\\\' OR rx.rx_no LIKE $q ESCAPE \'\\\')')
    params.q = `%${s}%`
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = (ctx.db.prepare(
    `SELECT COUNT(*) AS c FROM prescriptions rx JOIN patients p ON p.id = rx.patient_id ${whereSql}`
  ).get(params) as { c: number }).c
  const rows = ctx.db.prepare(`
    SELECT rx.* FROM prescriptions rx JOIN patients p ON p.id = rx.patient_id ${whereSql}
    ORDER BY rx.created_at DESC LIMIT $limit OFFSET $offset
  `).all({ ...params,limit: pageSize,offset: (page - 1) * pageSize }) as Record<string, unknown>[]
  return { rows: rows.map((r) => mapPrescription(ctx, r)), total, page, pageSize }
}

export function prescriptionGet(ctx: AppContext, id: number): Prescription {
  const row = ctx.db.prepare('SELECT * FROM prescriptions WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) throw errNotFound('Prescription not found.')
  return mapPrescription(ctx, row)
}

function validateRxRefs(ctx: AppContext, d: z.infer<typeof rxSchema>): void {
  if (!ctx.db.prepare('SELECT id FROM patients WHERE id = ?').get(d.patientId)) throw errNotFound('Patient not found.')
  const dentist = ctx.db.prepare('SELECT id, is_active FROM dentists WHERE id = ?').get(d.dentistId) as { is_active: number } | undefined
  if (!dentist) throw errNotFound('Dentist not found.')
  if (d.visitId && !ctx.db.prepare('SELECT id FROM visits WHERE id = ? AND patient_id = ?').get(d.visitId, d.patientId)) {
    throw errValidation('The linked visit does not belong to this patient.')
  }
}

export function prescriptionCreate(ctx: AppContext, actor: Actor, input: PrescriptionInput): Prescription {
  const res = rxSchema.safeParse(input)
  if (!res.success) throw errValidation(Object.values(res.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid prescription.', res.error.flatten().fieldErrors)
  const d = res.data
  if (!isValidDateStr(d.rxDate)) throw errValidation('Invalid prescription date.')
  validateRxRefs(ctx, d)

  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction((): number => {
    const prefix = getSettings(ctx).general.rxPrefix
    const rxNo = `${prefix}${String(nextSequence(ctx, 'rxNext')).padStart(5, '0')}`
    const r = ctx.db.prepare(`
      INSERT INTO prescriptions (rx_no, patient_id, visit_id, dentist_id, rx_date, cc_json, oe_json, advice,
        extra_advice, follow_up_date, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(
      rxNo, d.patientId, d.visitId ?? null, d.dentistId, d.rxDate,
      JSON.stringify(d.cc), JSON.stringify(d.oe), d.advice ?? null, d.extraAdvice ?? null,
      d.followUpDate ?? null, actor.userId, ts, ts
    )
    const id = Number(r.lastInsertRowid)
    const ins = ctx.db.prepare(`
      INSERT INTO prescription_medicines (prescription_id, medicine_id, name, dose_form, strength, dose, morning, noon, night,
        meal, duration_value, duration_unit, quantity, instruction, is_prn, custom_instruction, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const m of d.medicines) {
      ins.run(
        id, m.medicineId ?? null, m.name, m.doseForm ?? null, m.strength ?? null, m.dose ?? null,
        m.morning ? 1 : 0, m.noon ? 1 : 0, m.night ? 1 : 0, m.meal ?? null,
        m.durationValue ?? null, m.durationUnit ?? null, m.quantity ?? null, m.instruction ?? null,
        m.isPrn ? 1 : 0, m.customInstruction ?? null, m.sortOrder
      )
    }
    audit(ctx, actor, { action: 'create', entity: 'prescription', entityId: id, newValue: { rxNo, patientId: d.patientId, medicines: d.medicines.length } })
    return id
  })
  return prescriptionGet(ctx, run())
}

export function prescriptionUpdate(ctx: AppContext, actor: Actor, id: number, input: PrescriptionInput): Prescription {
  const existing = ctx.db.prepare('SELECT * FROM prescriptions WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!existing) throw errNotFound('Prescription not found.')
  if (existing.status === 'void') throw errConflict('Voided prescriptions cannot be edited.')
  const res = rxSchema.safeParse(input)
  if (!res.success) throw errValidation(Object.values(res.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid prescription.')
  const d = res.data
  validateRxRefs(ctx, d)
  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction(() => {
    ctx.db.prepare(`
      UPDATE prescriptions SET visit_id = ?, dentist_id = ?, rx_date = ?, cc_json = ?, oe_json = ?, advice = ?,
        extra_advice = ?, follow_up_date = ?, updated_at = ? WHERE id = ?
    `).run(
      d.visitId ?? null, d.dentistId, d.rxDate, JSON.stringify(d.cc), JSON.stringify(d.oe),
      d.advice ?? null, d.extraAdvice ?? null, d.followUpDate ?? null, ts, id
    )
    ctx.db.prepare('DELETE FROM prescription_medicines WHERE prescription_id = ?').run(id)
    const ins = ctx.db.prepare(`
      INSERT INTO prescription_medicines (prescription_id, medicine_id, name, dose_form, strength, dose, morning, noon, night,
        meal, duration_value, duration_unit, quantity, instruction, is_prn, custom_instruction, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const m of d.medicines) {
      ins.run(
        id, m.medicineId ?? null, m.name, m.doseForm ?? null, m.strength ?? null, m.dose ?? null,
        m.morning ? 1 : 0, m.noon ? 1 : 0, m.night ? 1 : 0, m.meal ?? null,
        m.durationValue ?? null, m.durationUnit ?? null, m.quantity ?? null, m.instruction ?? null,
        m.isPrn ? 1 : 0, m.customInstruction ?? null, m.sortOrder
      )
    }
    audit(ctx, actor, { action: 'update', entity: 'prescription', entityId: id, oldValue: { ...existing, cc_json: undefined, oe_json: undefined }, newValue: { ...d, medicines: d.medicines.length } })
  })
  run()
  return prescriptionGet(ctx, id)
}

export function prescriptionVoid(ctx: AppContext, actor: Actor, id: number, reason: string): void {
  const existing = ctx.db.prepare('SELECT * FROM prescriptions WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!existing) throw errNotFound('Prescription not found.')
  if (existing.status === 'void') throw errConflict('Prescription is already void.')
  if (!reason?.trim()) throw errValidation('A reason is required to void a prescription.')
  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction(() => {
    ctx.db.prepare("UPDATE prescriptions SET status = 'void', updated_at = ? WHERE id = ?").run(ts, id)
    audit(ctx, actor, { action: 'void', entity: 'prescription', entityId: id, context: reason })
  })
  run()
}
