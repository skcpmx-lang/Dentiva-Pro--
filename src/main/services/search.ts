import type { AppContext, Actor } from '../core/context'
import type { SearchResultGroup } from '@shared/ipc'
import { actorCan } from '../core/context'

/** SQL fragment appended to every LIKE: ESCAPE '\' — user input is always parameterized. */
const ESC = " ESCAPE '\\' "

function like(s: string): string {
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/**
 * Global search across every module the current user is authorized to see.
 * Permission filtering happens HERE (server-side) — low-privilege users can
 * never receive financial or clinical results through search (spec §55, §86).
 */
export function globalSearch(ctx: AppContext, actor: Actor, q: string, moduleFilter?: string, limit = 8): SearchResultGroup[] {
  const term = (q ?? '').trim()
  if (term.length < 1) return []
  const pattern = like(term)
  const groups: SearchResultGroup[] = []
  const params = { $q: pattern }
  const lim = Math.min(25, Math.max(1, limit))

  if ((!moduleFilter || moduleFilter === 'patients') && actorCan(actor, 'patient.view')) {
    const rows = ctx.db.prepare(`
      SELECT id, patient_code, full_name, phone FROM patients
      WHERE archived_at IS NULL AND (full_name LIKE $q${ESC} OR patient_code LIKE $q${ESC} OR phone LIKE $q${ESC})
      ORDER BY registered_at DESC LIMIT ${lim}
    `).all(params) as { id: number; patient_code: string; full_name: string; phone: string | null }[]
    if (rows.length) {
      groups.push({
        module: 'patients', label: 'Patients',
        items: rows.map((r) => ({ id: r.id, title: r.full_name, detail: `${r.patient_code}${r.phone ? ' · ' + r.phone : ''}`, route: `/patients/${r.id}` }))
      })
    }
  }

  if ((!moduleFilter || moduleFilter === 'appointments') && actorCan(actor, 'appointment.view')) {
    const rows = ctx.db.prepare(`
      SELECT a.id, a.appt_date, a.appt_time, p.full_name, a.status FROM appointments a JOIN patients p ON p.id = a.patient_id
      WHERE (p.full_name LIKE $q${ESC} OR a.reason LIKE $q${ESC}) AND a.appt_date >= date('now', '-90 days')
      ORDER BY a.appt_date DESC LIMIT ${lim}
    `).all(params) as { id: number; appt_date: string; appt_time: string; full_name: string; status: string }[]
    if (rows.length) {
      groups.push({
        module: 'appointments', label: 'Appointments',
        items: rows.map((r) => ({ id: r.id, title: `${r.full_name} — ${r.appt_date} ${r.appt_time}`, detail: r.status, route: '/appointments' }))
      })
    }
  }

  if ((!moduleFilter || moduleFilter === 'prescriptions') && actorCan(actor, 'prescription.view')) {
    const rows = ctx.db.prepare(`
      SELECT rx.id, rx.rx_no, p.full_name, rx.rx_date FROM prescriptions rx JOIN patients p ON p.id = rx.patient_id
      WHERE (rx.rx_no LIKE $q${ESC} OR p.full_name LIKE $q${ESC})
      ORDER BY rx.created_at DESC LIMIT ${lim}
    `).all(params) as { id: number; rx_no: string; full_name: string; rx_date: string }[]
    if (rows.length) {
      groups.push({
        module: 'prescriptions', label: 'Prescriptions',
        items: rows.map((r) => ({ id: r.id, title: `${r.rx_no} — ${r.full_name}`, detail: r.rx_date, route: `/prescriptions/${r.id}` }))
      })
    }
  }

  if ((!moduleFilter || moduleFilter === 'invoices') && actorCan(actor, 'invoice.view')) {
    const rows = ctx.db.prepare(`
      SELECT i.id, i.invoice_no, p.full_name, i.total, i.status FROM invoices i JOIN patients p ON p.id = i.patient_id
      WHERE (i.invoice_no LIKE $q${ESC} OR p.full_name LIKE $q${ESC})
      ORDER BY i.created_at DESC LIMIT ${lim}
    `).all(params) as { id: number; invoice_no: string; full_name: string; total: number; status: string }[]
    if (rows.length) {
      groups.push({
        module: 'invoices', label: 'Invoices',
        items: rows.map((r) => ({ id: r.id, title: `${r.invoice_no} — ${r.full_name}`, detail: `৳${(r.total / 100).toFixed(2)} · ${r.status}`, route: `/invoices/${r.id}` }))
      })
    }
  }

  if ((!moduleFilter || moduleFilter === 'payments') && actorCan(actor, 'payment.view')) {
    const rows = ctx.db.prepare(`
      SELECT pay.id, p.full_name, pay.amount, pay.method, pay.payment_date FROM payments pay JOIN patients p ON p.id = pay.patient_id
      WHERE (p.full_name LIKE $q${ESC} OR pay.reference LIKE $q${ESC})
      ORDER BY pay.payment_date DESC LIMIT ${lim}
    `).all(params) as { id: number; full_name: string; amount: number; method: string; payment_date: string }[]
    if (rows.length) {
      groups.push({
        module: 'payments', label: 'Payments',
        items: rows.map((r) => ({ id: r.id, title: `${r.full_name} — ৳${(r.amount / 100).toFixed(2)}`, detail: `${r.method} · ${r.payment_date}`, route: '/payments' }))
      })
    }
  }

  if ((!moduleFilter || moduleFilter === 'treatments') && actorCan(actor, 'treatment.view')) {
    const rows = ctx.db.prepare(`
      SELECT id, name, code, default_price FROM treatments
      WHERE is_active = 1 AND (name LIKE $q${ESC} OR code LIKE $q${ESC}) LIMIT ${lim}
    `).all(params) as { id: number; name: string; code: string | null; default_price: number }[]
    if (rows.length) {
      groups.push({
        module: 'treatments', label: 'Treatments',
        items: rows.map((r) => ({ id: r.id, title: r.name, detail: `${r.code ?? ''} · ৳${(r.default_price / 100).toFixed(2)}`, route: '/treatments' }))
      })
    }
  }

  if (!moduleFilter || moduleFilter === 'dentists') {
    const rows = ctx.db.prepare(`SELECT id, full_name FROM dentists WHERE full_name LIKE $q${ESC} LIMIT ${lim}`).all(params) as { id: number; full_name: string }[]
    if (rows.length) {
      groups.push({
        module: 'dentists', label: 'Dentists',
        items: rows.map((r) => ({ id: r.id, title: r.full_name, detail: null, route: '/settings/dentists' }))
      })
    }
  }

  if ((!moduleFilter || moduleFilter === 'inventory') && actorCan(actor, 'inventory.view')) {
    const rows = ctx.db.prepare(`
      SELECT id, name, sku FROM inventory_items WHERE is_active = 1 AND (name LIKE $q${ESC} OR sku LIKE $q${ESC}) LIMIT ${lim}
    `).all(params) as { id: number; name: string; sku: string }[]
    if (rows.length) {
      groups.push({
        module: 'inventory', label: 'Inventory',
        items: rows.map((r) => ({ id: r.id, title: r.name, detail: r.sku, route: `/inventory/${r.id}` }))
      })
    }
  }

  if ((!moduleFilter || moduleFilter === 'suppliers') && actorCan(actor, 'supplier.view')) {
    const rows = ctx.db.prepare(
      `SELECT id, name, phone FROM suppliers WHERE is_active = 1 AND (name LIKE $q${ESC} OR phone LIKE $q${ESC}) LIMIT ${lim}`
    ).all(params) as { id: number; name: string; phone: string | null }[]
    if (rows.length) {
      groups.push({
        module: 'suppliers', label: 'Suppliers',
        items: rows.map((r) => ({ id: r.id, title: r.name, detail: r.phone, route: '/inventory/suppliers' }))
      })
    }
  }

  if ((!moduleFilter || moduleFilter === 'staff') && actorCan(actor, 'staff.view')) {
    const rows = ctx.db.prepare(`
      SELECT id, name, designation FROM staff WHERE (name LIKE $q${ESC} OR designation LIKE $q${ESC}) LIMIT ${lim}
    `).all(params) as { id: number; name: string; designation: string | null }[]
    if (rows.length) {
      groups.push({
        module: 'staff', label: 'Staff',
        items: rows.map((r) => ({ id: r.id, title: r.name, detail: r.designation, route: '/staff' }))
      })
    }
  }

  if ((!moduleFilter || moduleFilter === 'notes') && actorCan(actor, 'visit.view')) {
    const rows = ctx.db.prepare(`
      SELECT v.id, p.full_name, v.visit_date, substr(COALESCE(v.diagnosis, v.chief_complaint, v.notes), 1, 80) AS snippet
      FROM visits v JOIN patients p ON p.id = v.patient_id
      WHERE (v.diagnosis LIKE $q${ESC} OR v.chief_complaint LIKE $q${ESC} OR v.notes LIKE $q${ESC} OR v.examination LIKE $q${ESC})
      ORDER BY v.visit_date DESC LIMIT ${lim}
    `).all(params) as { id: number; full_name: string; visit_date: string; snippet: string | null }[]
    if (rows.length) {
      groups.push({
        module: 'notes', label: 'Clinical Notes',
        items: rows.map((r) => ({ id: r.id, title: `${r.full_name} — ${r.visit_date}`, detail: r.snippet, route: `/visits/${r.id}` }))
      })
    }
  }

  return groups
}
