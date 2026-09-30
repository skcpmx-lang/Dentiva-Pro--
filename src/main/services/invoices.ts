import { z } from 'zod'
import type { AppContext, Actor } from '../core/context'
import { errValidation, errNotFound, errConflict } from '@shared/errors'
import type { InvoiceInput, InvoiceListQuery } from '@shared/ipc'
import type { Paginated } from '@shared/types'
import type { InvoiceStatus } from '@shared/types'
import type { Invoice, InvoiceLine } from '@shared/types'
import { resolveRange, isValidDateStr } from '@shared/dates'
import { lineTotalPaisa } from '@shared/money'
import { nextSequence, getSettings } from './settings'
import { audit } from './audit'

const lineSchema = z.object({
  treatmentId: z.number().int().positive().nullable().optional(),
  description: z.string().trim().min(1, 'Line item description is required.').max(300),
  quantity: z.number().int().min(1).max(999),
  unitPrice: z.number().int().min(0)
})

const invoiceSchema = z.object({
  patientId: z.number().int().positive(),
  visitId: z.number().int().positive().nullable().optional(),
  dentistId: z.number().int().positive().nullable().optional(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  discount: z.number().int().min(0).default(0),
  notes: z.string().max(1000).nullable().optional(),
  lines: z.array(lineSchema).min(1, 'Add at least one line item.').max(100)
})

function computeTotals(lines: { quantity: number; unitPrice: number }[], discount: number) {
  const subtotal = lines.reduce((s, l) => s + lineTotalPaisa(l.quantity, l.unitPrice), 0)
  const total = Math.max(0, subtotal - Math.min(discount, subtotal))
  return { subtotal, total }
}

const SELECT = `
  SELECT i.*, p.full_name AS patientName, p.patient_code AS patientCode, p.phone AS patientPhone, d.full_name AS dentistName
  FROM invoices i JOIN patients p ON p.id = i.patient_id LEFT JOIN dentists d ON d.id = i.dentist_id
`

function mapInvoice(r: Record<string, unknown>, lines: InvoiceLine[]): Invoice {
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
    status: r.status as InvoiceStatus,
    notes: (r.notes as string | null) ?? null,
    voidedReason: (r.voided_reason as string | null) ?? null,
    createdAt: r.created_at as string,
    patientName: r.patientName as string,
    patientCode: r.patientCode as string,
    patientPhone: (r.patientPhone as string | null) ?? null,
    dentistName: (r.dentistName as string | null) ?? null,
    lines
  }
}

export function invoiceGet(ctx: AppContext, id: number): Invoice {
  const row = ctx.db.prepare(`${SELECT} WHERE i.id = ?`).get(id) as Record<string, unknown> | undefined
  if (!row) throw errNotFound('Invoice not found.')
  const lines = (ctx.db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id').all(id) as Record<string, unknown>[]).map(
    (l): InvoiceLine => ({
      id: l.id as number,
      treatmentId: (l.treatment_id as number | null) ?? null,
      description: l.description as string,
      quantity: l.quantity as number,
      unitPrice: l.unit_price as number,
      lineTotal: l.line_total as number
    })
  )
  return mapInvoice(row, lines)
}

export function invoiceList(ctx: AppContext, query: InvoiceListQuery): Paginated<Invoice> {
  const page = Math.max(1, query.page | 0 || 1)
  const pageSize = Math.min(100, Math.max(5, query.pageSize | 0 || 25))
  const range = resolveRange(query.preset ?? '30d', { from: query.from, to: query.to }, ctx.clock())
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (query.patientId) { where.push('i.patient_id = $patient'); params.patient = query.patientId }
  if (query.status) { where.push('i.status = $status'); params.status = query.status }
  if (query.preset !== 'all') { where.push('i.invoice_date >= $from AND i.invoice_date <= $to'); params.from = range.from; params.to = range.to }
  if (query.search) {
    const s = query.search.replace(/[\\%_]/g, (c) => `\\${c}`)
    where.push('(i.invoice_no LIKE $q ESCAPE \'\\\' OR p.full_name LIKE $q ESCAPE \'\\\' OR p.patient_code LIKE $q ESCAPE \'\\\')')
    params.q = `%${s}%`
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = (ctx.db.prepare(
    `SELECT COUNT(*) AS c FROM invoices i JOIN patients p ON p.id = i.patient_id ${whereSql}`
  ).get(params) as { c: number }).c
  const rows = ctx.db.prepare(`${SELECT} ${whereSql} ORDER BY i.created_at DESC LIMIT $limit OFFSET $offset`)
    .all({ ...params,limit: pageSize,offset: (page - 1) * pageSize }) as Record<string, unknown>[]
  const getLines = ctx.db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id')
  return {
    rows: rows.map((r) => {
      const lines = (getLines.all(r.id) as Record<string, unknown>[]).map((l) => ({
        id: l.id as number,
        treatmentId: (l.treatment_id as number | null) ?? null,
        description: l.description as string,
        quantity: l.quantity as number,
        unitPrice: l.unit_price as number,
        lineTotal: l.line_total as number
      }))
      return mapInvoice(r, lines)
    }),
    total, page, pageSize
  }
}

export function nextInvoiceNumber(ctx: AppContext): string {
  const prefix = getSettings(ctx).general.invoicePrefix
  return `${prefix}${String(getSettings(ctx).general.invoiceNext).padStart(5, '0')}`
}

function validateRefs(ctx: AppContext, d: z.infer<typeof invoiceSchema>): void {
  if (!ctx.db.prepare('SELECT id FROM patients WHERE id = ?').get(d.patientId)) throw errNotFound('Patient not found.')
  if (d.visitId && !ctx.db.prepare('SELECT id FROM visits WHERE id = ? AND patient_id = ?').get(d.visitId, d.patientId)) {
    throw errValidation('The linked visit does not belong to this patient.')
  }
  if (d.dentistId && !ctx.db.prepare('SELECT id FROM dentists WHERE id = ?').get(d.dentistId)) throw errNotFound('Dentist not found.')
}

export function invoiceCreate(ctx: AppContext, actor: Actor, input: InvoiceInput): Invoice {
  const res = invoiceSchema.safeParse(input)
  if (!res.success) throw errValidation(Object.values(res.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid invoice.', res.error.flatten().fieldErrors)
  const d = res.data
  if (!isValidDateStr(d.invoiceDate)) throw errValidation('Invalid invoice date.')
  validateRefs(ctx, d)
  const { subtotal, total } = computeTotals(d.lines, d.discount)

  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction((): number => {
    const prefix = getSettings(ctx).general.invoicePrefix
    const invoiceNo = `${prefix}${String(nextSequence(ctx, 'invoiceNext')).padStart(5, '0')}`
    const r = ctx.db.prepare(`
      INSERT INTO invoices (invoice_no, patient_id, visit_id, dentist_id, invoice_date, subtotal, discount, total,
        paid_amount, due_amount, status, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'unpaid', ?, ?, ?, ?)
    `).run(invoiceNo, d.patientId, d.visitId ?? null, d.dentistId ?? null, d.invoiceDate, subtotal, d.discount, total, total, d.notes ?? null, actor.userId, ts, ts)
    const id = Number(r.lastInsertRowid)
    const ins = ctx.db.prepare(
      'INSERT INTO invoice_lines (invoice_id, treatment_id, description, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?)'
    )
    for (const l of d.lines) {
      ins.run(id, l.treatmentId ?? null, l.description, l.quantity, l.unitPrice, lineTotalPaisa(l.quantity, l.unitPrice))
    }
    audit(ctx, actor, { action: 'create', entity: 'invoice', entityId: id, newValue: { invoiceNo, patientId: d.patientId, total, lines: d.lines.length } })
    return id
  })
  return invoiceGet(ctx, run())
}

export function invoiceUpdate(ctx: AppContext, actor: Actor, id: number, input: InvoiceInput): Invoice {
  const existing = ctx.db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!existing) throw errNotFound('Invoice not found.')
  if (existing.status === 'void') throw errConflict('Void invoices cannot be edited.')
  const payments = ctx.db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE invoice_id = ? AND status = 'valid'").get(id) as { s: number }
  if (payments.s > 0) {
    throw errConflict('This invoice has payments recorded. Void it and issue a corrected invoice instead of editing the historical document.')
  }
  const res = invoiceSchema.safeParse(input)
  if (!res.success) throw errValidation(Object.values(res.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid invoice.')
  const d = res.data
  validateRefs(ctx, d)
  const { subtotal, total } = computeTotals(d.lines, d.discount)
  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction(() => {
    ctx.db.prepare(`
      UPDATE invoices SET patient_id = ?, visit_id = ?, dentist_id = ?, invoice_date = ?, subtotal = ?, discount = ?,
        total = ?, due_amount = ?, notes = ?, updated_at = ? WHERE id = ?
    `).run(d.patientId, d.visitId ?? null, d.dentistId ?? null, d.invoiceDate, subtotal, d.discount, total, total, d.notes ?? null, ts, id)
    ctx.db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').run(id)
    const ins = ctx.db.prepare(
      'INSERT INTO invoice_lines (invoice_id, treatment_id, description, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?)'
    )
    for (const l of d.lines) {
      ins.run(id, l.treatmentId ?? null, l.description, l.quantity, l.unitPrice, lineTotalPaisa(l.quantity, l.unitPrice))
    }
    audit(ctx, actor, { action: 'update', entity: 'invoice', entityId: id, oldValue: { total: existing.total, lines: undefined }, newValue: { total } })
  })
  run()
  return invoiceGet(ctx, id)
}

export function invoiceVoid(ctx: AppContext, actor: Actor, id: number, reason: string): Invoice {
  const existing = ctx.db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!existing) throw errNotFound('Invoice not found.')
  if (existing.status === 'void') throw errConflict('Invoice is already void.')
  if (!reason?.trim()) throw errValidation('A reason is required to void an invoice.')

  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction(() => {
    // Void linked valid payments (reverses their auto income entries as well).
    const payments = ctx.db.prepare("SELECT id FROM payments WHERE invoice_id = ? AND status = 'valid'").all(id) as { id: number }[]
    const voidPayment = ctx.db.prepare(
      "UPDATE payments SET status = 'void', voided_reason = ?, voided_by = ?, voided_at = ? WHERE id = ?"
    )
    const reverseIncome = ctx.db.prepare('DELETE FROM financial_transactions WHERE payment_id = ?')
    for (const p of payments) {
      voidPayment.run(`Invoice ${existing.invoice_no} voided: ${reason}`, actor.userId, ts, p.id)
      reverseIncome.run(p.id)
    }
    ctx.db.prepare("UPDATE invoices SET status = 'void', voided_reason = ?, due_amount = 0, updated_at = ? WHERE id = ?").run(reason, ts, id)
    audit(ctx, actor, { action: 'void', entity: 'invoice', entityId: id, context: reason, newValue: { status: 'void' } })
    audit(ctx, actor, { action: 'void', entity: 'payments_for_invoice', entityId: id, context: `Voided ${payments.length} payment(s) with invoice` })
  })
  run()
  return invoiceGet(ctx, id)
}

export function invoiceDelete(ctx: AppContext, actor: Actor, id: number): void {
  const existing = ctx.db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!existing) throw errNotFound('Invoice not found.')
  const payments = ctx.db.prepare('SELECT COUNT(*) AS c FROM payments WHERE invoice_id = ?').get(id) as { c: number }
  if (payments.c > 0) throw errConflict('Invoices with payment history cannot be deleted. Void the invoice instead — financial history must be preserved.')
  if (existing.status !== 'unpaid') throw errConflict('Only unpaid, uncollected invoices can be deleted. Void is the safe correction path.')
  const run = ctx.db.transaction(() => {
    ctx.db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').run(id)
    ctx.db.prepare('DELETE FROM invoices WHERE id = ?').run(id)
    audit(ctx, actor, { action: 'delete', entity: 'invoice', entityId: id, oldValue: { invoiceNo: existing.invoice_no, total: existing.total } })
  })
  run()
}
