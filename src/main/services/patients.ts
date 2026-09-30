import { z } from 'zod'
import type { AppContext, Actor } from '../core/context'
import { errValidation, errNotFound, errConflict } from '@shared/errors'
import { actorCan } from '../core/context'
import type { PatientListQuery, PatientInput } from '@shared/ipc'
import type { Paginated, AppointmentRow } from '@shared/types'
import type { Patient, PatientListRow, PatientDetail } from '@shared/types'
import { resolveRange, todayISO, isValidDateStr } from '@shared/dates'
import { nextSequence, getSettings } from './settings'
import { audit } from './audit'

const patientSchema = z.object({
  patientCode: z.string().trim().max(30).nullable().optional(),
  fullName: z.string().trim().min(2, 'Full name is required (min 2 characters).').max(160),
  age: z.number().int().min(0).max(150).nullable().optional(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date of birth.').nullable().optional(),
  gender: z.enum(['male', 'female', 'other']),
  bloodGroup: z.string().max(5).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  emergencyPhone: z.string().trim().max(20).nullable().optional(),
  emergencyContactName: z.string().max(120).nullable().optional(),
  chiefComplaint: z.string().max(500).nullable().optional(),
  previousHistory: z.string().max(3000).nullable().optional(),
  notes: z.string().max(3000).nullable().optional(),
  preferredLanguage: z.string().max(30).nullable().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  registeredDentistId: z.number().int().positive().nullable().optional()
})

function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

export function patientList(ctx: AppContext, actor: Actor, query: PatientListQuery): Paginated<PatientListRow> {
  const page = Math.max(1, query.page | 0 || 1)
  const pageSize = Math.min(200, Math.max(5, query.pageSize | 0 || 25))
  const range = resolveRange(query.preset ?? 'today', { from: query.from, to: query.to }, ctx.clock())

  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (query.preset !== 'all') {
    where.push('p.registered_at >= $from AND p.registered_at <= $to')
    params.from = range.from
    params.to = range.to
  }
  if (query.search) {
    const s = likeEscape(query.search.trim())
    where.push('(p.full_name LIKE $q ESCAPE \'\\\' OR p.patient_code LIKE $q ESCAPE \'\\\' OR p.phone LIKE $q ESCAPE \'\\\' OR p.chief_complaint LIKE $q ESCAPE \'\\\')')
    params.q = `%${s}%`
  }
  const status = query.status ?? 'active'
  if (status === 'archived') {
    where.push('p.archived_at IS NOT NULL')
  } else if (status !== 'all') {
    where.push('p.archived_at IS NULL')
    where.push('p.status = $status')
    params.status = status
  }
  if (query.dentistId) {
    where.push('p.registered_dentist_id = $dentist')
    params.dentist = query.dentistId
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const sort = query.sort ?? 'newest'
  const orderBy =
    sort === 'oldest' ? 'p.registered_at ASC, p.id ASC' :
    sort === 'name' ? 'p.full_name COLLATE NOCASE ASC' :
    sort === 'lastVisit' ? 'lastVisitDate DESC' :
    'p.registered_at DESC, p.id DESC'

  const total = (
    ctx.db.prepare(`SELECT COUNT(*) AS c FROM patients p ${whereSql}`).get(params) as { c: number }
  ).c

  const rows = ctx.db.prepare(`
    SELECT p.id, p.patient_code, p.full_name, p.age, p.gender, p.phone, p.chief_complaint, p.status,
           p.registered_at, p.archived_at,
           (SELECT COUNT(*) FROM visits v WHERE v.patient_id = p.id) AS visitCount,
           (SELECT MAX(v.visit_date) FROM visits v WHERE v.patient_id = p.id) AS lastVisitDate
    FROM patients p ${whereSql}
    ORDER BY ${orderBy}
    LIMIT $limit OFFSET $offset
  `).all({ ...params,limit: pageSize,offset: (page - 1) * pageSize }) as Array<{
    id: number; patient_code: string; full_name: string; age: number | null; gender: 'male' | 'female' | 'other'
    phone: string | null; chief_complaint: string | null; status: 'active' | 'inactive'
    registered_at: string; archived_at: string | null; visitCount: number; lastVisitDate: string | null
  }>

  // Map to the camelCase PatientListRow contract the renderer consumes — the
  // raw snake_case row must never leak across the IPC boundary (the patient
  // list and every patient picker render blank names otherwise).
  return {
    rows: rows.map((r) => ({
      id: r.id,
      patientCode: r.patient_code,
      fullName: r.full_name,
      age: r.age,
      gender: r.gender,
      phone: r.phone,
      chiefComplaint: r.chief_complaint,
      status: r.status,
      registeredAt: r.registered_at,
      lastVisitDate: r.lastVisitDate,
      visitCount: r.visitCount,
      archived: r.archived_at != null
    })),
    total, page, pageSize
  }
}

function basePatient(ctx: AppContext, id: number): Patient {
  const row = ctx.db.prepare('SELECT * FROM patients WHERE id = ?').get(id) as (Record<string, unknown> & { id: number }) | undefined
  if (!row) throw errNotFound('Patient not found.')
  return mapPatient(row)
}

function mapPatient(row: Record<string, unknown>): Patient {
  return {
    id: row.id as number,
    patientCode: row.patient_code as string,
    fullName: row.full_name as string,
    age: (row.age as number | null) ?? null,
    dob: (row.dob as string | null) ?? null,
    gender: row.gender as Patient['gender'],
    bloodGroup: (row.blood_group as Patient['bloodGroup']) ?? null,
    address: (row.address as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    emergencyPhone: (row.emergency_phone as string | null) ?? null,
    emergencyContactName: (row.emergency_contact_name as string | null) ?? null,
    chiefComplaint: (row.chief_complaint as string | null) ?? null,
    previousHistory: (row.previous_history as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    preferredLanguage: (row.preferred_language as string | null) ?? null,
    status: row.status as 'active' | 'inactive',
    registeredDentistId: (row.registered_dentist_id as number | null) ?? null,
    registeredAt: row.registered_at as string,
    archivedAt: (row.archived_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export function patientGet(ctx: AppContext, actor: Actor, id: number): PatientDetail {
  const p = basePatient(ctx, id)
  const visitCount = (ctx.db.prepare('SELECT COUNT(*) AS c FROM visits WHERE patient_id = ?').get(id) as { c: number }).c
  const lastVisitDate = (ctx.db.prepare('SELECT MAX(visit_date) AS d FROM visits WHERE patient_id = ?').get(id) as { d: string | null }).d
  const upcoming = ctx.db.prepare(`
    SELECT a.*, p.full_name AS patientName, p.patient_code AS patientCode, p.phone AS patientPhone, d.full_name AS dentistName
    FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN dentists d ON d.id = a.dentist_id
    WHERE a.patient_id = ? AND a.appt_date >= ? AND a.status NOT IN ('cancelled','no_show','rescheduled','completed')
    ORDER BY a.appt_date ASC, a.appt_time ASC LIMIT 5
  `).all(id, todayISO(ctx.clock())) as unknown as AppointmentRow[]
  const missed = (ctx.db.prepare(
    "SELECT COUNT(*) AS c FROM appointments WHERE patient_id = ? AND status = 'no_show'"
  ).get(id) as { c: number }).c
  const prescriptionCount = (ctx.db.prepare('SELECT COUNT(*) AS c FROM prescriptions WHERE patient_id = ?').get(id) as { c: number }).c
  const referralCount = (ctx.db.prepare('SELECT COUNT(*) AS c FROM referrals WHERE patient_id = ?').get(id) as { c: number }).c
  const attachmentCount = (ctx.db.prepare('SELECT COUNT(*) AS c FROM attachments WHERE patient_id = ? AND deleted_at IS NULL').get(id) as { c: number }).c
  const dentist = p.registeredDentistId
    ? (ctx.db.prepare('SELECT full_name FROM dentists WHERE id = ?').get(p.registeredDentistId) as { full_name: string } | undefined)?.full_name ?? null
    : null

  let totalBilled: number | null = null
  let totalPaid: number | null = null
  let outstanding: number | null = null
  let invoiceCount = 0
  let lastPayment: PatientDetail['lastPayment'] = null
  if (actorCan(actor, 'financial.view')) {
    invoiceCount = (ctx.db.prepare("SELECT COUNT(*) AS c FROM invoices WHERE patient_id = ? AND status != 'void'").get(id) as { c: number }).c
    totalBilled = (ctx.db.prepare("SELECT COALESCE(SUM(total),0) AS s FROM invoices WHERE patient_id = ? AND status != 'void'").get(id) as { s: number }).s
    totalPaid = (ctx.db.prepare(
      "SELECT COALESCE(SUM(pay.amount),0) AS s FROM payments pay WHERE pay.patient_id = ? AND pay.status = 'valid'"
    ).get(id) as { s: number }).s
    outstanding = (ctx.db.prepare(`
      SELECT COALESCE(SUM(i.due_amount),0) AS s FROM invoices i
      WHERE i.patient_id = ? AND i.status IN ('unpaid','partial')
    `).get(id) as { s: number }).s
    lastPayment = (ctx.db.prepare(
      "SELECT payment_date AS date, amount, method FROM payments WHERE patient_id = ? AND status = 'valid' ORDER BY payment_date DESC, id DESC LIMIT 1"
    ).get(id) as PatientDetail['lastPayment']) ?? null
  }

  return {
    ...p,
    visitCount,
    lastVisitDate,
    nextAppointment: upcoming[0] ?? null,
    upcomingAppointments: upcoming,
    missedAppointments: missed,
    prescriptionCount,
    referralCount,
    attachmentCount,
    invoiceCount,
    totalBilled,
    totalPaid,
    outstanding,
    lastPayment,
    dentistName: dentist
  }
}

export function patientDuplicates(ctx: AppContext, fullName: string, phone?: string | null, dob?: string | null) {
  const name = fullName.trim()
  const rows = ctx.db.prepare(`
    SELECT id, patient_code, full_name, phone, dob, registered_at FROM patients
    WHERE archived_at IS NULL AND (full_name = ? COLLATE NOCASE ${phone ? 'OR phone = ?' : ''} ${dob ? 'OR dob = ?' : ''})
    LIMIT 10
  `).all(...([name, ...(phone ? [phone.trim()] : []), ...(dob ? [dob] : [])]) as unknown[]) as {
    id: number; patient_code: string; full_name: string; phone: string | null; dob: string | null; registered_at: string
  }[]
  return rows.map((r) => ({
    id: r.id, patientCode: r.patient_code, fullName: r.full_name, phone: r.phone, dob: r.dob, registeredAt: r.registered_at
  }))
}

export function patientCreate(ctx: AppContext, actor: Actor, input: PatientInput): Patient {
  const res = patientSchema.safeParse(input)
  if (!res.success) {
    const fields = res.error.flatten().fieldErrors
    const first = Object.values(fields)[0]?.[0] ?? 'Invalid patient information.'
    throw errValidation(first, fields)
  }
  const d = res.data
  if (d.dob && !isValidDateStr(d.dob)) throw errValidation('Invalid date of birth.')
  if (d.dob && d.dob > todayISO(ctx.clock())) throw errValidation('Date of birth cannot be in the future.')

  const run = ctx.db.transaction((): number => {
    let code = d.patientCode?.trim() ?? ''
    if (!code) {
      const prefix = getSettings(ctx).general.patientCodePrefix
      code = `${prefix}${String(nextSequence(ctx, 'patientCodeNext')).padStart(5, '0')}`
    }
    const exists = ctx.db.prepare('SELECT id FROM patients WHERE patient_code = ?').get(code)
    if (exists) throw errConflict(`Patient code "${code}" is already in use.`)

    const ts = new Date(ctx.clock().getTime()).toISOString()
    const r = ctx.db.prepare(`
      INSERT INTO patients (patient_code, full_name, age, dob, gender, blood_group, address, phone, emergency_phone,
        emergency_contact_name, chief_complaint, previous_history, notes, preferred_language, status,
        registered_dentist_id, registered_at, archived_at, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
    `).run(
      code, d.fullName, d.age ?? null, d.dob ?? null, d.gender, d.bloodGroup ?? null, d.address ?? null,
      d.phone ?? null, d.emergencyPhone ?? null, d.emergencyContactName ?? null, d.chiefComplaint ?? null,
      d.previousHistory ?? null, d.notes ?? null, d.preferredLanguage ?? null, d.status ?? 'active',
      d.registeredDentistId ?? null, todayISO(ctx.clock()), actor.userId, ts, ts
    )
    const id = Number(r.lastInsertRowid)
    audit(ctx, actor, { action: 'create', entity: 'patient', entityId: id, newValue: { ...d, patientCode: code } })
    return id
  })
  return basePatient(ctx, run())
}

export function patientUpdate(ctx: AppContext, actor: Actor, id: number, input: PatientInput): Patient {
  const existing = ctx.db.prepare('SELECT * FROM patients WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!existing) throw errNotFound('Patient not found.')
  const res = patientSchema.safeParse(input)
  if (!res.success) {
    const fields = res.error.flatten().fieldErrors
    throw errValidation(Object.values(fields)[0]?.[0] ?? 'Invalid patient information.', fields)
  }
  const d = res.data
  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction(() => {
    if (d.patientCode && d.patientCode !== existing.patient_code) {
      const exists = ctx.db.prepare('SELECT id FROM patients WHERE patient_code = ? AND id != ?').get(d.patientCode, id)
      if (exists) throw errConflict(`Patient code "${d.patientCode}" is already in use.`)
    }
    ctx.db.prepare(`
      UPDATE patients SET patient_code = ?, full_name = ?, age = ?, dob = ?, gender = ?, blood_group = ?, address = ?,
        phone = ?, emergency_phone = ?, emergency_contact_name = ?, chief_complaint = ?, previous_history = ?,
        notes = ?, preferred_language = ?, status = ?, registered_dentist_id = ?, updated_at = ?
      WHERE id = ?
    `).run(
      d.patientCode || (existing.patient_code as string), d.fullName, d.age ?? null, d.dob ?? null, d.gender,
      d.bloodGroup ?? null, d.address ?? null, d.phone ?? null, d.emergencyPhone ?? null, d.emergencyContactName ?? null,
      d.chiefComplaint ?? null, d.previousHistory ?? null, d.notes ?? null, d.preferredLanguage ?? null,
      d.status ?? 'active', d.registeredDentistId ?? null, ts, id
    )
    audit(ctx, actor, { action: 'update', entity: 'patient', entityId: id, oldValue: mapPatient(existing), newValue: d })
  })
  run()
  return basePatient(ctx, id)
}

export function patientArchive(ctx: AppContext, actor: Actor, id: number, archived: boolean): void {
  const existing = ctx.db.prepare('SELECT id, archived_at FROM patients WHERE id = ?').get(id)
  if (!existing) throw errNotFound('Patient not found.')
  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE patients SET archived_at = ?, updated_at = ? WHERE id = ?').run(archived ? ts : null, ts, id)
    audit(ctx, actor, { action: archived ? 'archive' : 'restore', entity: 'patient', entityId: id })
  })
  run()
}

export function patientDeletePermanent(ctx: AppContext, actor: Actor, id: number, confirm: string): void {
  if (confirm !== 'DELETE') throw errValidation('Type DELETE to confirm permanent deletion.')
  const existing = ctx.db.prepare('SELECT * FROM patients WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!existing) throw errNotFound('Patient not found.')

  const guarded = (sql: string): number => (ctx.db.prepare(sql).get(id) as { c: number }).c
  const checks: [string, string][] = [
    ['SELECT COUNT(*) AS c FROM visits WHERE patient_id = ?', 'visits'],
    ['SELECT COUNT(*) AS c FROM prescriptions WHERE patient_id = ?', 'prescriptions'],
    ['SELECT COUNT(*) AS c FROM invoices WHERE patient_id = ?', 'invoices'],
    ['SELECT COUNT(*) AS c FROM payments WHERE patient_id = ?', 'payments'],
    ['SELECT COUNT(*) AS c FROM appointments WHERE patient_id = ?', 'appointments'],
    ['SELECT COUNT(*) AS c FROM referrals WHERE patient_id = ?', 'referrals'],
    ['SELECT COUNT(*) AS c FROM attachments WHERE patient_id = ?', 'attachments'],
    ['SELECT COUNT(*) AS c FROM chart_entries WHERE patient_id = ?', 'dental chart records']
  ]
  const blocking: string[] = []
  for (const [sql, label] of checks) if (guarded(sql) > 0) blocking.push(label)
  if (blocking.length > 0) {
    throw errValidation(
      `This patient has ${blocking.join(', ')} on record. Permanent deletion is blocked to protect clinical and financial history. Archive the patient instead, or delete the related records first.`
    )
  }
  const run = ctx.db.transaction(() => {
    ctx.db.prepare('DELETE FROM queue_entries WHERE patient_id = ?').run(id)
    ctx.db.prepare('DELETE FROM patients WHERE id = ?').run(id)
    audit(ctx, actor, { action: 'delete', entity: 'patient', entityId: id, oldValue: mapPatient(existing) })
  })
  run()
}

export function patientExportCsv(ctx: AppContext, actor: Actor, query: PatientListQuery): { csv: string; count: number } {
  const result = patientList(ctx, actor, { ...query, page: 1, pageSize: 200 })
  const all: PatientListRow[] = [...result.rows]
  let page = 1
  while (all.length < result.total && page < 100) {
    page += 1
    all.push(...patientList(ctx, actor, { ...query, page, pageSize: 200 }).rows)
  }
  const header = ['Patient Code', 'Full Name', 'Age', 'Gender', 'Phone', 'Chief Complaint', 'Status', 'Registered', 'Visits']
  const lines = [header.join(',')]
  for (const r of all) {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    lines.push([r.patientCode, r.fullName, r.age ?? '', r.gender, r.phone ?? '', r.chiefComplaint ?? '', r.status, r.registeredAt, r.visitCount].map(esc).join(','))
  }
  audit(ctx, actor, { action: 'export', entity: 'patient', context: `Exported ${all.length} patients to CSV` })
  return { csv: lines.join('\r\n'), count: all.length }
}
