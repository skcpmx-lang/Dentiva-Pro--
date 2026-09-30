import type { AppContext } from '../core/context'
import type { TimelineEvent, Paginated } from '@shared/types'
import { resolveRange } from '@shared/dates'

/**
 * Chronological clinical timeline for a patient (spec §25).
 * Every event type is recorded from its own table — history is never overwritten.
 */
export function patientTimeline(
  ctx: AppContext,
  patientId: number,
  opts: { types?: string[]; preset?: string; from?: string; to?: string; page: number; pageSize: number }
): Paginated<TimelineEvent> {
  const page = Math.max(1, opts.page | 0 || 1)
  const pageSize = Math.min(100, Math.max(5, opts.pageSize | 0 || 30))
  const range = resolveRange((opts.preset ?? 'all') as 'all', { from: opts.from, to: opts.to }, ctx.clock())
  const from = range.from ?? '0000-01-01'
  const to = range.to
  const want = (t: string): boolean => !opts.types || opts.types.length === 0 || opts.types.includes(t)

  const events: TimelineEvent[] = []
  const push = (e: TimelineEvent) => events.push(e)

  if (want('registration')) {
    const p = ctx.db.prepare('SELECT registered_at, patient_code FROM patients WHERE id = ?').get(patientId) as { registered_at: string; patient_code: string } | undefined
    if (p && p.registered_at >= from && p.registered_at <= to) {
      push({ id: `reg-${p.patient_code}`, type: 'registration', title: 'Patient registered', detail: `Patient code ${p.patient_code}`, date: p.registered_at, route: null })
    }
  }

  if (want('visit')) {
    const rows = ctx.db.prepare(`
      SELECT v.id, v.visit_date, v.visit_time, v.reason, v.diagnosis, d.full_name AS dentistName
      FROM visits v JOIN dentists d ON d.id = v.dentist_id
      WHERE v.patient_id = ? AND v.visit_date >= ? AND v.visit_date <= ? ORDER BY v.visit_date DESC
    `).all(patientId, from, to) as { id: number; visit_date: string; visit_time: string; reason: string | null; diagnosis: string | null; dentistName: string }[]
    for (const r of rows) {
      push({
        id: `visit-${r.id}`, type: 'visit',
        title: `Visit — ${r.dentistName}`, detail: [r.reason, r.diagnosis].filter(Boolean).join(' · ') || null,
        date: r.visit_date, route: `/visits/${r.id}`
      })
    }
  }

  if (want('treatment')) {
    const rows = ctx.db.prepare(`
      SELECT vt.id, vt.name, vt.tooth_numbers, v.visit_date
      FROM visit_treatments vt JOIN visits v ON v.id = vt.visit_id
      WHERE v.patient_id = ? AND v.visit_date >= ? AND v.visit_date <= ? ORDER BY v.visit_date DESC
    `).all(patientId, from, to) as { id: number; name: string; tooth_numbers: string | null; visit_date: string }[]
    for (const r of rows) {
      push({
        id: `trt-${r.id}`, type: 'treatment', title: `Treatment — ${r.name}`,
        detail: r.tooth_numbers ? `Teeth: ${r.tooth_numbers}` : null, date: r.visit_date, route: null
      })
    }
  }

  if (want('prescription')) {
    const rows = ctx.db.prepare(`
      SELECT id, rx_no, rx_date, (SELECT COUNT(*) FROM prescription_medicines pm WHERE pm.prescription_id = prescriptions.id) AS medCount
      FROM prescriptions WHERE patient_id = ? AND rx_date >= ? AND rx_date <= ? ORDER BY rx_date DESC
    `).all(patientId, from, to) as { id: number; rx_no: string; rx_date: string; medCount: number }[]
    for (const r of rows) {
      push({
        id: `rx-${r.id}`, type: 'prescription', title: `Prescription ${r.rx_no}`,
        detail: `${r.medCount} medicine${r.medCount > 1 ? 's' : ''}`, date: r.rx_date, route: `/prescriptions/${r.id}`
      })
    }
  }

  if (want('appointment')) {
    const rows = ctx.db.prepare(`
      SELECT id, appt_date, appt_time, status, reason FROM appointments
      WHERE patient_id = ? AND appt_date >= ? AND appt_date <= ? ORDER BY appt_date DESC
    `).all(patientId, from, to) as { id: number; appt_date: string; appt_time: string; status: string; reason: string | null }[]
    for (const r of rows) {
      push({
        id: `apt-${r.id}`, type: 'appointment', title: `Appointment (${r.status.replace('_', ' ')})`,
        detail: r.reason ?? null, date: r.appt_date, route: '/appointments'
      })
    }
  }

  if (want('invoice')) {
    const rows = ctx.db.prepare(`
      SELECT id, invoice_no, invoice_date, total, status FROM invoices
      WHERE patient_id = ? AND invoice_date >= ? AND invoice_date <= ? ORDER BY invoice_date DESC
    `).all(patientId, from, to) as { id: number; invoice_no: string; invoice_date: string; total: number; status: string }[]
    for (const r of rows) {
      push({
        id: `inv-${r.id}`, type: 'invoice', title: `Invoice ${r.invoice_no}`,
        detail: `৳${(r.total / 100).toFixed(2)} · ${r.status}`, date: r.invoice_date, route: `/invoices/${r.id}`
      })
    }
  }

  if (want('payment')) {
    const rows = ctx.db.prepare(`
      SELECT id, payment_date, amount, method FROM payments
      WHERE patient_id = ? AND status = 'valid' AND payment_date >= ? AND payment_date <= ? ORDER BY payment_date DESC
    `).all(patientId, from, to) as { id: number; payment_date: string; amount: number; method: string }[]
    for (const r of rows) {
      push({
        id: `pay-${r.id}`, type: 'payment', title: `Payment — ৳${(r.amount / 100).toFixed(2)}`,
        detail: r.method, date: r.payment_date, route: '/payments'
      })
    }
  }

  if (want('referral')) {
    const rows = ctx.db.prepare(`
      SELECT id, to_doctor_name, to_clinic, created_at, status FROM referrals
      WHERE patient_id = ? AND created_at >= ? AND created_at <= ? ORDER BY created_at DESC
    `).all(patientId, from, to) as { id: number; to_doctor_name: string; to_clinic: string | null; created_at: string; status: string }[]
    for (const r of rows) {
      push({
        id: `ref-${r.id}`, type: 'referral', title: `Referred to ${r.to_doctor_name}`,
        detail: r.to_clinic ?? null, date: r.created_at.slice(0, 10), route: '/referrals'
      })
    }
  }

  if (want('attachment')) {
    const rows = ctx.db.prepare(`
      SELECT id, original_filename, uploaded_at FROM attachments
      WHERE patient_id = ? AND deleted_at IS NULL AND uploaded_at >= ? AND uploaded_at <= ? ORDER BY uploaded_at DESC
    `).all(patientId, from, to) as { id: number; original_filename: string; uploaded_at: string }[]
    for (const r of rows) {
      push({
        id: `att-${r.id}`, type: 'attachment', title: `Attachment — ${r.original_filename}`,
        detail: null, date: r.uploaded_at.slice(0, 10), route: null
      })
    }
  }

  if (want('chart')) {
    const rows = ctx.db.prepare(`
      SELECT ce.id, ce.tooth, ce.dentition, ce.recorded_at, tc.name AS cond
      FROM chart_entries ce JOIN tooth_conditions tc ON tc.id = ce.condition_id
      WHERE ce.patient_id = ? AND ce.recorded_at >= ? AND ce.recorded_at <= ? ORDER BY ce.recorded_at DESC LIMIT 200
    `).all(patientId, from, to) as { id: number; tooth: number; dentition: string; recorded_at: string; cond: string }[]
    for (const r of rows) {
      push({
        id: `cht-${r.id}`, type: 'chart', title: `Chart — tooth ${r.tooth} (${r.cond})`,
        detail: r.dentition === 'pediatric' ? 'Pediatric dentition' : 'Adult dentition',
        date: r.recorded_at.slice(0, 10), route: null
      })
    }
  }

  events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  const total = events.length
  return { rows: events.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize }
}
