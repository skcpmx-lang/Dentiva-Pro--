import { z } from 'zod'
import type { AppContext, Actor } from '../core/context'
import { errValidation, errNotFound, errConflict, errIo } from '@shared/errors'
import type { PaymentInput, RangeQuery, ReceiptData } from '@shared/ipc'
import type { Payment, PaymentSummary, PaymentMethod } from '@shared/types'
import { resolveRange, todayISO, isValidDateStr } from '@shared/dates'
import { getSettings, getClinic } from './settings'
import { audit } from './audit'

const paymentSchema = z.object({
  patientId: z.number().int().positive(),
  invoiceId: z.number().int().positive().nullable().optional(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().int().positive('Payment amount must be greater than zero.'),
  method: z.enum(['cash', 'bank', 'card', 'bkash', 'nagad', 'rocket', 'upay', 'other']),
  reference: z.string().max(100).nullable().optional(),
  notes: z.string().max(500).nullable().optional()
})

const SELECT = `
  SELECT pay.*, i.invoice_no AS invoiceNo, p.full_name AS patientName, p.patient_code AS patientCode
  FROM payments pay JOIN patients p ON p.id = pay.patient_id LEFT JOIN invoices i ON i.id = pay.invoice_id
`

function mapRow(r: Record<string, unknown>): Payment {
  return {
    id: r.id as number,
    patientId: r.patient_id as number,
    invoiceId: (r.invoice_id as number | null) ?? null,
    paymentDate: r.payment_date as string,
    paymentTime: r.payment_time as string,
    amount: r.amount as number,
    method: r.method as PaymentMethod,
    reference: (r.reference as string | null) ?? null,
    receivedBy: (r.receivedBy as string | null) ?? '—',
    notes: (r.notes as string | null) ?? null,
    status: r.status as 'valid' | 'void',
    voidedReason: (r.voided_reason as string | null) ?? null,
    invoiceNo: (r.invoiceNo as string | null) ?? null,
    patientName: r.patientName as string,
    patientCode: r.patientCode as string
  }
}

export function paymentList(ctx: AppContext, query: { preset?: string; from?: string; to?: string; method?: string; search?: string; invoiceId?: number; page: number; pageSize: number }) {
  const page = Math.max(1, query.page | 0 || 1)
  const pageSize = Math.min(200, Math.max(5, query.pageSize | 0 || 25))
  const range = resolveRange((query.preset ?? 'today') as 'today', { from: query.from, to: query.to }, ctx.clock())
  const where: string[] = ["pay.status = 'valid'"]
  const params: Record<string, unknown> = {}
  if (query.preset !== 'all') { where.push('pay.payment_date >= $from AND pay.payment_date <= $to'); params.from = range.from; params.to = range.to }
  if (query.method) { where.push('pay.method = $method'); params.method = query.method }
  if (query.invoiceId) { where.push('pay.invoice_id = $invoice'); params.invoice = query.invoiceId }
  if (query.search) {
    const s = query.search.replace(/[\\%_]/g, (c) => `\\${c}`)
    where.push('(p.full_name LIKE $q ESCAPE \'\\\' OR p.patient_code LIKE $q ESCAPE \'\\\' OR pay.reference LIKE $q ESCAPE \'\\\' OR i.invoice_no LIKE $q ESCAPE \'\\\')')
    params.q = `%${s}%`
  }
  const whereSql = `WHERE ${where.join(' AND ')}`
  const total = (ctx.db.prepare(
    `SELECT COUNT(*) AS c FROM payments pay JOIN patients p ON p.id = pay.patient_id LEFT JOIN invoices i ON i.id = pay.invoice_id ${whereSql}`
  ).get(params) as { c: number }).c
  const rows = ctx.db.prepare(`
    ${SELECT} ${whereSql} ORDER BY pay.payment_date DESC, pay.id DESC LIMIT $limit OFFSET $offset
  `).all({ ...params,limit: pageSize,offset: (page - 1) * pageSize }) as Record<string, unknown>[]
  return { rows: rows.map(mapRow), total, page, pageSize }
}

function getWithReceiver(ctx: AppContext, id: number): Payment {
  const r = ctx.db.prepare(`
    SELECT pay.*, u.display_name AS receivedBy, i.invoice_no AS invoiceNo, p.full_name AS patientName, p.patient_code AS patientCode
    FROM payments pay JOIN patients p ON p.id = pay.patient_id LEFT JOIN invoices i ON i.id = pay.invoice_id
    LEFT JOIN users u ON u.id = pay.received_by WHERE pay.id = ?
  `).get(id) as Record<string, unknown>
  return mapRow(r)
}

/** Recompute invoice aggregates from valid payments — the single source of truth for invoice state. */
function refreshInvoice(ctx: AppContext, invoiceId: number): void {
  const invoice = ctx.db.prepare('SELECT total FROM invoices WHERE id = ?').get(invoiceId) as { total: number } | undefined
  if (!invoice) return
  const paid = (ctx.db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE invoice_id = ? AND status = 'valid'").get(invoiceId) as { s: number }).s
  const due = Math.max(0, invoice.total - paid)
  const status = due <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
  ctx.db.prepare('UPDATE invoices SET paid_amount = ?, due_amount = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(paid, due, status, new Date(ctx.clock().getTime()).toISOString(), invoiceId)
}

function serviceIncomeCategoryId(ctx: AppContext): number {
  const row = ctx.db.prepare("SELECT id FROM accounting_categories WHERE kind = 'income' AND name = 'Service Income'").get() as { id: number }
  return row.id
}

export function paymentCreate(ctx: AppContext, actor: Actor, input: PaymentInput): Payment {
  const res = paymentSchema.safeParse(input)
  if (!res.success) throw errValidation(Object.values(res.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid payment.', res.error.flatten().fieldErrors)
  const d = res.data
  if (!isValidDateStr(d.paymentDate)) throw errValidation('Invalid payment date.')
  if (!ctx.db.prepare('SELECT id FROM patients WHERE id = ?').get(d.patientId)) throw errNotFound('Patient not found.')

  interface InvoiceRow { id: number; patient_id: number; total: number; status: string }
  let invoice: InvoiceRow | null = null
  if (d.invoiceId) {
    invoice = ctx.db.prepare('SELECT id, patient_id, total, status FROM invoices WHERE id = ?').get(d.invoiceId) as InvoiceRow | null
    if (!invoice) throw errNotFound('Invoice not found.')
    if (invoice.patient_id !== d.patientId) throw errValidation('The invoice does not belong to this patient.')
    if (invoice.status === 'void') throw errConflict('This invoice is void — payments cannot be recorded against it.')
    if (invoice.status === 'paid') throw errConflict('This invoice is already fully paid.')
    const due = (ctx.db.prepare("SELECT due_amount FROM invoices WHERE id = ?").get(d.invoiceId) as { due_amount: number }).due_amount
    const allowOver = getSettings(ctx).security.allowOverpayment
    if (!allowOver && d.amount > due) {
      throw errValidation(`Payment exceeds the outstanding balance (৳ due: ${(due / 100).toFixed(2)}). Record a payment of the due amount or less.`)
    }
  }

  const clock = ctx.clock()
  const ts = clock.toISOString()
  const timeHHmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hour12: false }).format(clock)

  const run = ctx.db.transaction((): number => {
    const r = ctx.db.prepare(`
      INSERT INTO payments (patient_id, invoice_id, payment_date, payment_time, amount, method, reference, received_by, notes, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'valid', ?)
    `).run(d.patientId, d.invoiceId ?? null, d.paymentDate, timeHHmm, d.amount, d.method, d.reference ?? null, actor.userId, d.notes ?? null, ts)
    const id = Number(r.lastInsertRowid)
    if (d.invoiceId) refreshInvoice(ctx, d.invoiceId)
    // Auto income entry (single-entry cashbook, AD-009) — linked to the payment for reversal.
    ctx.db.prepare(`
      INSERT INTO financial_transactions (kind, category_id, amount, txn_date, method, description, reference, payment_id, created_by, created_at)
      VALUES ('income', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      serviceIncomeCategoryId(ctx), d.amount, d.paymentDate, d.method,
      `Payment received — ${mapRow(ctx.db.prepare(`${SELECT} WHERE pay.id = ?`).get(id) as Record<string, unknown>).patientName}`,
      d.reference ?? null, id, actor.userId, ts
    )
    audit(ctx, actor, {
      action: 'create', entity: 'payment', entityId: id,
      newValue: { amount: d.amount, method: d.method, invoiceId: d.invoiceId ?? null, patientId: d.patientId }
    })
    return id
  })
  return getWithReceiver(ctx, run())
}

export function paymentVoid(ctx: AppContext, actor: Actor, id: number, reason: string): Payment {
  const existing = ctx.db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!existing) throw errNotFound('Payment not found.')
  if (existing.status === 'void') throw errConflict('Payment is already void.')
  if (!reason?.trim()) throw errValidation('A reason is required to void a payment.')
  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction(() => {
    ctx.db.prepare("UPDATE payments SET status = 'void', voided_reason = ?, voided_by = ?, voided_at = ? WHERE id = ?")
      .run(reason, actor.userId, ts, id)
    if (existing.invoice_id) refreshInvoice(ctx, existing.invoice_id as number)
    ctx.db.prepare('DELETE FROM financial_transactions WHERE payment_id = ?').run(id)
    audit(ctx, actor, { action: 'void', entity: 'payment', entityId: id, context: reason, oldValue: { amount: existing.amount }, newValue: { status: 'void' } })
  })
  run()
  return getWithReceiver(ctx, id)
}

export function paymentDelete(ctx: AppContext, actor: Actor, id: number): void {
  const existing = ctx.db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!existing) throw errNotFound('Payment not found.')
  throw errConflict('Payments are part of the financial record and cannot be deleted. Void the payment instead — the audit trail and history are preserved.')
}

export function paymentSummary(ctx: AppContext, query: RangeQuery): PaymentSummary {
  const range = resolveRange((query.preset ?? 'today') as 'today', { from: query.from, to: query.to }, ctx.clock())
  const params: Record<string, unknown> = {}
  let dateFilter = ''
  if (query.preset !== 'all') {
    dateFilter = 'AND payment_date >= $from AND payment_date <= $to'
    params.from = range.from
    params.to = range.to
  }
  const byMethodRows = ctx.db.prepare(`
    SELECT method, COALESCE(SUM(amount),0) AS s FROM payments WHERE status = 'valid' ${dateFilter} GROUP BY method
  `).all(params) as { method: PaymentMethod; s: number }[]
  const byMethod: Record<PaymentMethod, number> = {
    cash: 0, bank: 0, card: 0, bkash: 0, nagad: 0, rocket: 0, upay: 0, other: 0
  }
  for (const r of byMethodRows) byMethod[r.method] = r.s
  const totalCollected = Object.values(byMethod).reduce((a, b) => a + b, 0)
  const transactionCount = (ctx.db.prepare(
    `SELECT COUNT(*) AS c FROM payments WHERE status = 'valid' ${dateFilter}`
  ).get(params) as { c: number }).c
  const outstanding = (ctx.db.prepare(
    "SELECT COALESCE(SUM(due_amount),0) AS s FROM invoices WHERE status IN ('unpaid','partial')"
  ).get() as { s: number }).s
  return {
    totalCollected,
    byMethod,
    transactionCount,
    cash: byMethod.cash,
    bank: byMethod.bank,
    card: byMethod.card,
    mobileWallet: byMethod.bkash + byMethod.nagad + byMethod.rocket + byMethod.upay,
    other: byMethod.other,
    outstanding
  }
}

export function receiptData(ctx: AppContext, actor: Actor, id: number): ReceiptData {
  const payment = getWithReceiver(ctx, id)
  let invoiceNo: string | null = null
  let balanceAfter: number | null = null
  if (payment.invoiceId) {
    const inv = ctx.db.prepare('SELECT invoice_no, due_amount FROM invoices WHERE id = ?').get(payment.invoiceId) as
      { invoice_no: string; due_amount: number } | undefined
    invoiceNo = inv?.invoice_no ?? null
    balanceAfter = inv?.due_amount ?? null
  } else {
    const outstanding = (ctx.db.prepare(`
      SELECT COALESCE(SUM(i.due_amount),0) AS s FROM invoices i
      WHERE i.patient_id = ? AND i.status IN ('unpaid','partial') AND i.invoice_date <= ?
    `).get(payment.patientId, payment.paymentDate) as { s: number }).s
    balanceAfter = outstanding
  }
  return {
    clinic: getClinicForPrint(ctx),
    payment,
    invoiceNo,
    balanceAfter,
    operator: actor.displayName
  }
}

function getClinicForPrint(ctx: AppContext): ReceiptData['clinic'] {
  try {
    const c = getClinic(ctx)
    return {
      name: c.name,
      address: c.address ?? '',
      phone: c.phone ?? '',
      phone2: c.phone2,
      email: c.email,
      logoPath: c.logoPath,
      tagline: c.tagline,
      footerMessage: c.footerMessage,
      doctorTiming: c.doctorTiming
    }
  } catch {
    throw errIo('Clinic profile is missing.')
  }
}

export function financialPatientSummary(ctx: AppContext, patientId: number) {
  if (!ctx.db.prepare('SELECT id FROM patients WHERE id = ?').get(patientId)) throw errNotFound('Patient not found.')
  const invoicesList = ctx.db.prepare(`
    SELECT i.*, p.full_name AS patientName, p.patient_code AS patientCode FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE i.patient_id = ? ORDER BY i.invoice_date DESC, i.id DESC
  `).all(patientId) as Record<string, unknown>[]
  const paymentRows = ctx.db.prepare(`
    SELECT pay.*, u.display_name AS receivedBy, i.invoice_no AS invoiceNo, p.full_name AS patientName, p.patient_code AS patientCode
    FROM payments pay JOIN patients p ON p.id = pay.patient_id LEFT JOIN invoices i ON i.id = pay.invoice_id
    LEFT JOIN users u ON u.id = pay.received_by
    WHERE pay.patient_id = ? ORDER BY pay.payment_date DESC, pay.id DESC
  `).all(patientId) as Record<string, unknown>[]
  const totalBilled = (ctx.db.prepare("SELECT COALESCE(SUM(total),0) AS s FROM invoices WHERE patient_id = ? AND status != 'void'").get(patientId) as { s: number }).s
  const totalPaid = (ctx.db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE patient_id = ? AND status = 'valid'").get(patientId) as { s: number }).s
  const outstanding = (ctx.db.prepare("SELECT COALESCE(SUM(due_amount),0) AS s FROM invoices WHERE patient_id = ? AND status IN ('unpaid','partial')").get(patientId) as { s: number }).s

  const getLines = ctx.db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id')
  const invoiceObjs = invoicesList.map((r) => {
    const lines = (getLines.all(r.id) as Record<string, unknown>[]).map((l) => ({
      id: l.id as number,
      treatmentId: (l.treatment_id as number | null) ?? null,
      description: l.description as string,
      quantity: l.quantity as number,
      unitPrice: l.unit_price as number,
      lineTotal: l.line_total as number
    }))
    return {
      id: r.id as number,
      invoiceNo: r.invoice_no as string,
      patientId: r.patient_id as number,
      visitId: (r.visit_id as number | null) ?? null,
      dentistId: (r.dentist_id as number | null) ?? null,
      invoiceDate: r.invoice_date as string,
      subtotal: r.subtotal as number,
      discount: r.discount as number,
      total: r.total as number,
      paidAmount: r.paid_amount as number,
      dueAmount: r.due_amount as number,
      status: r.status as 'unpaid' | 'partial' | 'paid' | 'void',
      notes: (r.notes as string | null) ?? null,
      voidedReason: (r.voided_reason as string | null) ?? null,
      createdAt: r.created_at as string,
      patientName: r.patientName as string,
      patientCode: r.patientCode as string,
      dentistName: null,
      lines
    }
  })
  return { totalBilled, totalPaid, outstanding, invoices: invoiceObjs, payments: paymentRows.map(mapRow) }
}

export function financialDashboard(ctx: AppContext, query: RangeQuery) {
  const range = resolveRange((query.preset ?? '30d') as '30d', { from: query.from, to: query.to }, ctx.clock())
  const today = todayISO(ctx.clock())
  const summary = paymentSummary(ctx, query)
  const expenses = (ctx.db.prepare(`
    SELECT COALESCE(SUM(amount),0) AS s FROM financial_transactions WHERE kind = 'expense' AND txn_date >= $from AND txn_date <= $to
  `).get({ from: range.from ?? '0000-01-01',to: range.to }) as { s: number }).s
  const revenueToday = (ctx.db.prepare(
    "SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status = 'valid' AND payment_date = ?"
  ).get(today) as { s: number }).s
  const byDay: { date: string; collected: number }[] = []
  const rows = ctx.db.prepare(`
    SELECT payment_date AS date, COALESCE(SUM(amount),0) AS s FROM payments
    WHERE status = 'valid' AND payment_date >= $from AND payment_date <= $to GROUP BY payment_date ORDER BY payment_date
  `).all({ from: range.from ?? '0000-01-01',to: range.to }) as { date: string; s: number }[]
  for (const r of rows) byDay.push({ date: r.date, collected: r.s })
  return {
    revenueToday,
    revenueRange: summary.totalCollected,
    expensesRange: expenses,
    netRange: summary.totalCollected - expenses,
    outstandingTotal: summary.outstanding,
    paymentSummary: summary,
    byDay
  }
}
