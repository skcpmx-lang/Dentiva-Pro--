import type { AppContext, Actor } from '../core/context'
import type { ReportDescriptor, ReportRunPayload, ReportResult } from '@shared/ipc'
import { actorCan } from '../core/context'
import { errValidation, errPermission } from '@shared/errors'
import { resolveRange, formatDateHuman } from '@shared/dates'
import { paisaToDecimalString, formatPaisa } from '@shared/money'

export function reportList(_ctx: AppContext): ReportDescriptor[] {
  return [
    { key: 'patients_new', title: 'New Patients', description: 'Patients registered in the selected period.', requires: ['patient.view'] },
    { key: 'visits_by_dentist', title: 'Visits by Dentist', description: 'Visit counts and treatment revenue per dentist.', requires: ['visit.view'] },
    { key: 'treatments_usage', title: 'Treatment Usage', description: 'Most-performed treatments with totals.', requires: ['treatment.view'] },
    { key: 'prescriptions_count', title: 'Prescriptions', description: 'Prescriptions issued per dentist.', requires: ['prescription.view'] },
    { key: 'appointments_status', title: 'Appointments by Status', description: 'Status breakdown for the period.', requires: ['appointment.view'] },
    { key: 'payments_by_method', title: 'Payments by Method', description: 'Collections split by payment method.', requires: ['payment.view'] },
    { key: 'income_expense', title: 'Income & Expense', description: 'Accounting summary with net result.', requires: ['accounting.view'] },
    { key: 'outstanding', title: 'Outstanding Dues', description: 'Unpaid and partially paid invoices.', requires: ['financial.view'] },
    { key: 'inventory_stock', title: 'Inventory Stock', description: 'Current stock levels and status.', requires: ['inventory.view'] },
    { key: 'inventory_expiry', title: 'Inventory Expiry', description: 'Batches expiring soon or already expired.', requires: ['inventory.view'] }
  ]
}

export function reportRun(ctx: AppContext, actor: Actor, payload: ReportRunPayload): ReportResult {
  const descriptor = reportList(ctx).find((r) => r.key === payload.key)
  if (!descriptor) throw errValidation('Unknown report.')
  for (const perm of descriptor.requires) {
    if (!actorCan(actor, perm)) throw errPermission(`This report requires the ${perm} permission.`)
  }
  const range = resolveRange((payload.preset || '30d') as '30d', { from: payload.from, to: payload.to }, ctx.clock())
  const from = range.from ?? '0000-01-01'
  const to = range.to
  const periodLabel = range.from ? `${formatDateHuman(from)} – ${formatDateHuman(to)}` : `All time (to ${formatDateHuman(to)})`

  switch (payload.key) {
    case 'patients_new': {
      const rows = ctx.db.prepare(`
        SELECT registered_at AS date, COUNT(*) AS count FROM patients
        WHERE registered_at >= ? AND registered_at <= ? GROUP BY registered_at ORDER BY registered_at DESC
      `).all(from, to) as { date: string; count: number }[]
      const total = rows.reduce((s, r) => s + r.count, 0)
      return {
        title: 'New Patients', columns: [{ key: 'date', label: 'Date' }, { key: 'count', label: 'Patients' }],
        rows, summary: [{ label: 'Period', value: periodLabel }, { label: 'Total new patients', value: String(total) }]
      }
    }
    case 'visits_by_dentist': {
      const rows = ctx.db.prepare(`
        SELECT d.full_name AS dentist, COUNT(v.id) AS visits, COALESCE(SUM(vt.line_total), 0) AS revenue
        FROM dentists d
        LEFT JOIN visits v ON v.dentist_id = d.id AND v.visit_date >= ? AND v.visit_date <= ?
        LEFT JOIN visit_treatments vt ON vt.visit_id = v.id
        GROUP BY d.id ORDER BY visits DESC
      `).all(from, to) as { dentist: string; visits: number; revenue: number }[]
      const money = actorCan(actor, 'financial.view')
      return {
        title: 'Visits by Dentist',
        columns: [{ key: 'dentist', label: 'Dentist' }, { key: 'visits', label: 'Visits' }, ...(money ? [{ key: 'revenue', label: 'Treatment Value', money: true }] : [])],
        rows: money ? rows : rows.map((r) => ({ dentist: r.dentist, visits: r.visits })),
        summary: [{ label: 'Period', value: periodLabel }, { label: 'Total visits', value: String(rows.reduce((s, r) => s + r.visits, 0)) }]
      }
    }
    case 'treatments_usage': {
      const rows = ctx.db.prepare(`
        SELECT vt.name AS treatment, COUNT(*) AS times, COALESCE(SUM(vt.line_total),0) AS total
        FROM visit_treatments vt JOIN visits v ON v.id = vt.visit_id
        WHERE v.visit_date >= ? AND v.visit_date <= ? GROUP BY vt.name ORDER BY times DESC
      `).all(from, to) as { treatment: string; times: number; total: number }[]
      const money = actorCan(actor, 'financial.view')
      return {
        title: 'Treatment Usage',
        columns: [{ key: 'treatment', label: 'Treatment' }, { key: 'times', label: 'Times performed' }, ...(money ? [{ key: 'total', label: 'Total Value', money: true }] : [])],
        rows: money ? rows : rows.map((r) => ({ treatment: r.treatment, times: r.times })),
        summary: [{ label: 'Period', value: periodLabel }]
      }
    }
    case 'prescriptions_count': {
      const rows = ctx.db.prepare(`
        SELECT d.full_name AS dentist, COUNT(rx.id) AS prescriptions
        FROM dentists d LEFT JOIN prescriptions rx ON rx.dentist_id = d.id AND rx.rx_date >= ? AND rx.rx_date <= ?
        GROUP BY d.id ORDER BY prescriptions DESC
      `).all(from, to) as { dentist: string; prescriptions: number }[]
      return {
        title: 'Prescriptions', columns: [{ key: 'dentist', label: 'Dentist' }, { key: 'prescriptions', label: 'Prescriptions' }],
        rows, summary: [{ label: 'Period', value: periodLabel }]
      }
    }
    case 'appointments_status': {
      const rows = ctx.db.prepare(`
        SELECT status, COUNT(*) AS count FROM appointments WHERE appt_date >= ? AND appt_date <= ? GROUP BY status ORDER BY count DESC
      `).all(from, to) as { status: string; count: number }[]
      return {
        title: 'Appointments by Status',
        columns: [{ key: 'status', label: 'Status' }, { key: 'count', label: 'Count' }],
        rows: rows.map((r) => ({ status: r.status.replace(/_/g, ' '), count: r.count })),
        summary: [{ label: 'Period', value: periodLabel }]
      }
    }
    case 'payments_by_method': {
      const rows = ctx.db.prepare(`
        SELECT method, COUNT(*) AS count, COALESCE(SUM(amount),0) AS total
        FROM payments WHERE status = 'valid' AND payment_date >= ? AND payment_date <= ? GROUP BY method ORDER BY total DESC
      `).all(from, to) as { method: string; count: number; total: number }[]
      return {
        title: 'Payments by Method',
        columns: [{ key: 'method', label: 'Method' }, { key: 'count', label: 'Transactions' }, { key: 'total', label: 'Collected', money: true }],
        rows,
        summary: [
          { label: 'Period', value: periodLabel },
          { label: 'Total collected', value: formatPaisa(rows.reduce((s, r) => s + r.total, 0)) }
        ]
      }
    }
    case 'income_expense': {
      const rows = ctx.db.prepare(`
        SELECT c.name AS category, t.kind AS kind, COALESCE(SUM(t.amount),0) AS amount
        FROM financial_transactions t JOIN accounting_categories c ON c.id = t.category_id
        WHERE t.txn_date >= ? AND t.txn_date <= ? GROUP BY c.name, t.kind ORDER BY amount DESC
      `).all(from, to) as { category: string; kind: string; amount: number }[]
      const income = rows.filter((r) => r.kind === 'income').reduce((s, r) => s + r.amount, 0)
      const expense = rows.filter((r) => r.kind === 'expense').reduce((s, r) => s + r.amount, 0)
      return {
        title: 'Income & Expense',
        columns: [{ key: 'category', label: 'Category' }, { key: 'kind', label: 'Type' }, { key: 'amount', label: 'Amount', money: true }],
        rows: rows.map((r) => ({ category: r.category, kind: r.kind === 'income' ? 'Income' : 'Expense', amount: r.amount })),
        summary: [
          { label: 'Period', value: periodLabel },
          { label: 'Income', value: formatPaisa(income) },
          { label: 'Expense', value: formatPaisa(expense) },
          { label: 'Net', value: formatPaisa(income - expense) }
        ]
      }
    }
    case 'outstanding': {
      const rows = ctx.db.prepare(`
        SELECT i.invoice_no AS invoice, p.full_name AS patient, i.invoice_date AS date, i.due_amount AS due
        FROM invoices i JOIN patients p ON p.id = i.patient_id
        WHERE i.status IN ('unpaid','partial') ORDER BY i.invoice_date
      `).all() as { invoice: string; patient: string; date: string; due: number }[]
      return {
        title: 'Outstanding Dues',
        columns: [{ key: 'invoice', label: 'Invoice' }, { key: 'patient', label: 'Patient' }, { key: 'date', label: 'Date' }, { key: 'due', label: 'Due', money: true }],
        rows,
        summary: [
          { label: 'Period', value: periodLabel },
          { label: 'Total outstanding', value: formatPaisa(rows.reduce((s, r) => s + r.due, 0)) }
        ]
      }
    }
    case 'inventory_stock': {
      const rows = ctx.db.prepare(`
        SELECT i.name AS item, i.sku AS sku, i.unit AS unit, i.reorder_threshold AS threshold,
          COALESCE((SELECT SUM(qty_current) FROM inventory_batches b WHERE b.item_id = i.id AND b.status = 'active'), 0) AS stock
        FROM inventory_items i WHERE i.is_active = 1 ORDER BY i.name
      `).all() as { item: string; sku: string; unit: string; threshold: number; stock: number }[]
      return {
        title: 'Inventory Stock',
        columns: [{ key: 'item', label: 'Item' }, { key: 'sku', label: 'SKU' }, { key: 'stock', label: 'Current Stock' }, { key: 'unit', label: 'Unit' }, { key: 'threshold', label: 'Reorder At' }],
        rows: rows.map((r) => ({ ...r, status: r.stock <= 0 ? 'OUT' : r.stock <= r.threshold ? 'LOW' : 'OK' })),
        summary: [{ label: 'Generated', value: new Date(ctx.clock().getTime()).toISOString().slice(0, 10) }]
      }
    }
    case 'inventory_expiry': {
      const rows = ctx.db.prepare(`
        SELECT i.name AS item, b.batch_no AS batch, b.expiry_date AS expiry, b.qty_current AS qty
        FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id
        WHERE b.qty_current > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <= date('now', '+90 days')
        ORDER BY b.expiry_date
      `).all() as { item: string; batch: string | null; expiry: string; qty: number }[]
      return {
        title: 'Inventory Expiry (next 90 days)',
        columns: [{ key: 'item', label: 'Item' }, { key: 'batch', label: 'Batch' }, { key: 'expiry', label: 'Expiry' }, { key: 'qty', label: 'Qty' }],
        rows,
        summary: [{ label: 'Batches listed', value: String(rows.length) }]
      }
    }
    default:
      throw errValidation('Unknown report.')
  }
}

export function reportExportCsv(ctx: AppContext, actor: Actor, payload: ReportRunPayload): { csv: string; title: string; count: number } {
  const result = reportRun(ctx, actor, payload)
  const header = result.columns.map((c) => c.label).join(',')
  const lines = [header]
  for (const row of result.rows) {
    lines.push(result.columns.map((c) => {
      const v = row[c.key]
      if (v === null || v === undefined) return '""'
      if (c.money) return paisaToDecimalString(Number(v))
      return `"${String(v).replace(/"/g, '""')}"`
    }).join(','))
  }
  return { csv: lines.join('\r\n'), title: result.title, count: result.rows.length }
}
