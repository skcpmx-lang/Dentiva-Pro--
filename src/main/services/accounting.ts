import { z } from 'zod'
import type { AppContext, Actor } from '../core/context'
import { errValidation, errNotFound, errConflict } from '@shared/errors'
import type { RangeQuery } from '@shared/ipc'
import type { FinancialTxn, AccountingCategory, AccountingSummary, PaymentMethod } from '@shared/types'
import { resolveRange } from '@shared/dates'
import { audit } from './audit'

function mapTxn(r: Record<string, unknown>): FinancialTxn {
  return {
    id: r.id as number,
    kind: r.kind as 'income' | 'expense',
    categoryId: r.category_id as number,
    categoryName: r.categoryName as string,
    amount: r.amount as number,
    txnDate: r.txn_date as string,
    method: r.method as PaymentMethod,
    description: (r.description as string | null) ?? null,
    reference: (r.reference as string | null) ?? null,
    paymentId: (r.payment_id as number | null) ?? null,
    createdBy: (r.createdBy as string | null) ?? '—',
    createdAt: r.created_at as string
  }
}

const SELECT = `
  SELECT t.*, c.name AS categoryName, u.display_name AS createdBy
  FROM financial_transactions t JOIN accounting_categories c ON c.id = t.category_id
  LEFT JOIN users u ON u.id = t.created_by
`

export function accountingList(ctx: AppContext, query: RangeQuery & { kind?: string; categoryId?: number; page: number; pageSize: number }) {
  const page = Math.max(1, query.page | 0 || 1)
  const pageSize = Math.min(200, Math.max(5, query.pageSize | 0 || 25))
  const range = resolveRange((query.preset ?? '30d') as '30d', { from: query.from, to: query.to }, ctx.clock())
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (query.preset !== 'all') { where.push('t.txn_date >= $from AND t.txn_date <= $to'); params.from = range.from; params.to = range.to }
  if (query.kind) { where.push('t.kind = $kind'); params.kind = query.kind }
  if (query.categoryId) { where.push('t.category_id = $cat'); params.cat = query.categoryId }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = (ctx.db.prepare(`SELECT COUNT(*) AS c FROM financial_transactions t ${whereSql}`).get(params) as { c: number }).c
  const rows = ctx.db.prepare(`${SELECT} ${whereSql} ORDER BY t.txn_date DESC, t.id DESC LIMIT $limit OFFSET $offset`)
    .all({ ...params,limit: pageSize,offset: (page - 1) * pageSize }) as Record<string, unknown>[]
  return { rows: rows.map(mapTxn), total, page, pageSize }
}

const txnSchema = z.object({
  kind: z.enum(['income', 'expense']),
  categoryId: z.number().int().positive(),
  amount: z.number().int().positive('Amount must be greater than zero.'),
  txnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: z.enum(['cash', 'bank', 'card', 'bkash', 'nagad', 'rocket', 'upay', 'other']),
  description: z.string().max(500).nullable().optional(),
  reference: z.string().max(100).nullable().optional()
})

export function accountingSave(ctx: AppContext, actor: Actor, input: Record<string, unknown>): FinancialTxn {
  const res = txnSchema.safeParse(input)
  if (!res.success) throw errValidation(Object.values(res.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid transaction.')
  const d = res.data
  const cat = ctx.db.prepare('SELECT * FROM accounting_categories WHERE id = ?').get(d.categoryId) as (AccountingCategory & { kind: string }) | undefined
  if (!cat) throw errNotFound('Category not found.')
  if (cat.kind !== d.kind) throw errValidation('The selected category does not match the transaction type.')
  const id = (input as { id?: number }).id
  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction((): number => {
    if (id) {
      const existing = ctx.db.prepare('SELECT * FROM financial_transactions WHERE id = ?').get(id)
      if (!existing) throw errNotFound('Transaction not found.')
      if ((existing as { payment_id: number | null }).payment_id) {
        throw errConflict('This entry was created automatically from a payment and cannot be edited here.')
      }
      ctx.db.prepare(
        'UPDATE financial_transactions SET kind = ?, category_id = ?, amount = ?, txn_date = ?, method = ?, description = ?, reference = ? WHERE id = ?'
      ).run(d.kind, d.categoryId, d.amount, d.txnDate, d.method, d.description ?? null, d.reference ?? null, id)
      audit(ctx, actor, { action: 'update', entity: 'financial_transaction', entityId: id, oldValue: existing, newValue: d })
      return id
    }
    const r = ctx.db.prepare(`
      INSERT INTO financial_transactions (kind, category_id, amount, txn_date, method, description, reference, payment_id, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(d.kind, d.categoryId, d.amount, d.txnDate, d.method, d.description ?? null, d.reference ?? null, actor.userId, ts)
    const newId = Number(r.lastInsertRowid)
    audit(ctx, actor, { action: 'create', entity: 'financial_transaction', entityId: newId, newValue: d })
    return newId
  })
  const row = ctx.db.prepare(`${SELECT} WHERE t.id = ?`).get(run()) as Record<string, unknown>
  return mapTxn(row)
}

export function accountingDelete(ctx: AppContext, actor: Actor, id: number): void {
  const existing = ctx.db.prepare('SELECT * FROM financial_transactions WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!existing) throw errNotFound('Transaction not found.')
  if (existing.payment_id) throw errConflict('This entry is linked to a payment. Void the payment instead — accounting history stays consistent automatically.')
  const run = ctx.db.transaction(() => {
    ctx.db.prepare('DELETE FROM financial_transactions WHERE id = ?').run(id)
    audit(ctx, actor, { action: 'delete', entity: 'financial_transaction', entityId: id, oldValue: existing })
  })
  run()
}

export function accountingCategories(ctx: AppContext): AccountingCategory[] {
  return (ctx.db.prepare('SELECT * FROM accounting_categories ORDER BY kind, name').all() as Record<string, unknown>[]).map((r) => ({
    id: r.id as number,
    kind: r.kind as 'income' | 'expense',
    name: r.name as string,
    isSystem: r.is_system === 1,
    isActive: r.is_active === 1
  }))
}

const categorySchema = z.object({
  id: z.number().int().positive().optional(),
  kind: z.enum(['income', 'expense']),
  name: z.string().trim().min(1).max(60),
  isSystem: z.boolean().optional(),
  isActive: z.boolean().optional()
})

export function accountingSaveCategory(ctx: AppContext, actor: Actor, input: Record<string, unknown>): AccountingCategory[] {
  const res = categorySchema.safeParse(input)
  if (!res.success) throw errValidation(Object.values(res.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid category.')
  const d = res.data
  const run = ctx.db.transaction(() => {
    if (d.id) {
      const existing = ctx.db.prepare('SELECT * FROM accounting_categories WHERE id = ?').get(d.id) as Record<string, unknown> | undefined
      if (!existing) throw errNotFound('Category not found.')
      if (existing.is_system === 1 && (d.kind !== existing.kind || d.name !== existing.name)) {
        throw errValidation('System categories cannot be renamed or re-typed.')
      }
      ctx.db.prepare('UPDATE accounting_categories SET kind = ?, name = ?, is_active = ? WHERE id = ?')
        .run(d.kind, d.name, d.isActive === false ? 0 : 1, d.id)
      audit(ctx, actor, { action: 'update', entity: 'accounting_category', entityId: d.id, oldValue: existing, newValue: d })
    } else {
      const dup = ctx.db.prepare('SELECT id FROM accounting_categories WHERE kind = ? AND name = ?').get(d.kind, d.name)
      if (dup) throw errConflict('A category with this name already exists.')
      ctx.db.prepare('INSERT INTO accounting_categories (kind, name, is_system, is_active) VALUES (?, ?, 0, ?)')
        .run(d.kind, d.name, d.isActive === false ? 0 : 1)
      audit(ctx, actor, { action: 'create', entity: 'accounting_category', newValue: d })
    }
  })
  run()
  return accountingCategories(ctx)
}

export function accountingSummary(ctx: AppContext, query: RangeQuery): AccountingSummary {
  const range = resolveRange((query.preset ?? '30d') as '30d', { from: query.from, to: query.to }, ctx.clock())
  const params: Record<string, unknown> = { from: range.from ?? '0000-01-01',to: range.to }
  const income = (ctx.db.prepare(
    "SELECT COALESCE(SUM(amount),0) AS s FROM financial_transactions WHERE kind = 'income' AND txn_date >= $from AND txn_date <= $to"
  ).get(params) as { s: number }).s
  const expense = (ctx.db.prepare(
    "SELECT COALESCE(SUM(amount),0) AS s FROM financial_transactions WHERE kind = 'expense' AND txn_date >= $from AND txn_date <= $to"
  ).get(params) as { s: number }).s
  const byCategoryRows = ctx.db.prepare(`
    SELECT c.name AS name, t.kind AS kind, COALESCE(SUM(t.amount),0) AS s
    FROM financial_transactions t JOIN accounting_categories c ON c.id = t.category_id
    WHERE t.txn_date >= $from AND t.txn_date <= $to GROUP BY c.name, t.kind ORDER BY s DESC
  `).all(params) as { name: string; kind: string; s: number }[]
  const byMonthRows = ctx.db.prepare(`
    SELECT substr(txn_date, 1, 7) AS month, kind, COALESCE(SUM(amount),0) AS s
    FROM financial_transactions WHERE txn_date >= $from AND txn_date <= $to
    GROUP BY month, kind ORDER BY month
  `).all(params) as { month: string; kind: string; s: number }[]
  const monthMap = new Map<string, { month: string; income: number; expense: number }>()
  for (const r of byMonthRows) {
    const m = monthMap.get(r.month) ?? { month: r.month, income: 0, expense: 0 }
    if (r.kind === 'income') m.income = r.s
    else m.expense = r.s
    monthMap.set(r.month, m)
  }
  return {
    income, expense, net: income - expense,
    byCategory: byCategoryRows.map((r) => ({ name: `${r.name} (${r.kind === 'income' ? 'Income' : 'Expense'})`, amount: r.s })),
    byMonth: [...monthMap.values()]
  }
}
