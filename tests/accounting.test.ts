import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestEnv, completeSetupLogin, type TestEnv } from './helpers'
import { accountingCategories, accountingSaveCategory, accountingSave, accountingList, accountingDelete, accountingSummary } from '../src/main/services/accounting'
import { patientCreate } from '../src/main/services/patients'
import { invoiceCreate } from '../src/main/services/invoices'
import { paymentCreate, paymentVoid } from '../src/main/services/payments'
import { todayISO } from '../src/shared/dates'

let env: TestEnv
let incomeCatId: number
let labFeeId: number

beforeAll(() => {
  env = createTestEnv()
  completeSetupLogin(env)
})

afterAll(() => {
  env.cleanup()
})

function labFeeCatId(): number {
  return labFeeId ?? accountingCategories(env.ctx).find((c) => c.kind === 'expense')!.id
}

function makeTxn(over: Record<string, unknown> = {}): number {
  const cats = accountingCategories(env.ctx)
  const expenseCat = cats.find((c) => c.kind === 'expense' && c.isSystem) ?? cats.find((c) => c.kind === 'expense')!
  const t = accountingSave(env.ctx, env.owner, {
    kind: 'expense', categoryId: expenseCat.id, txnDate: todayISO(), amount: 250000,
    method: 'cash', description: 'Gloves purchase', ...over
  })
  return t.id
}

describe('accounting categories', () => {
  it('lists system categories and allows custom ones', () => {
    const cats = accountingCategories(env.ctx)
    incomeCatId = cats.find((c) => c.name === 'Service Income')?.id ?? cats[0].id
    expect(cats.length).toBeGreaterThanOrEqual(2)
    const custom = accountingSaveCategory(env.ctx, env.owner, { name: 'Lab Fee', kind: 'expense' })
    labFeeId = custom.find((c) => c.name === 'Lab Fee')!.id
    expect(custom.some((c) => c.name === 'Lab Fee')).toBe(true)
  })

  it('locks system category names/kinds', () => {
    const cats = accountingCategories(env.ctx)
    const sysCat = cats.find((c) => c.isSystem)!
    expect(() => accountingSaveCategory(env.ctx, env.owner, { id: sysCat.id, name: 'Renamed', kind: 'income' })).toThrowError(/system/i)
  })
})

describe('accounting transactions', () => {
  it('creates, edits and deletes manual transactions', () => {
    const id = makeTxn()
    const list = accountingList(env.ctx, { preset: '30d', page: 1, pageSize: 10 })
    expect(list.total).toBe(1)
    accountingSave(env.ctx, env.owner, { id, kind: 'expense', categoryId: labFeeCatId(), txnDate: todayISO(), amount: 300000, method: 'cash', description: 'Lab fee revised' })
    const list2 = accountingList(env.ctx, { preset: '30d', page: 1, pageSize: 10 })
    expect(list2.rows[0].amount).toBe(300000)
    accountingDelete(env.ctx, env.owner, id)
    expect(accountingList(env.ctx, { preset: '30d', page: 1, pageSize: 10 }).total).toBe(0)
  })

  it('payment-linked income rows cannot be edited or deleted directly', () => {
    const p = patientCreate(env.ctx, env.owner, { fullName: 'Acct Patient', gender: 'male', age: 30 })
    const inv = invoiceCreate(env.ctx, env.owner, {
      patientId: p.id, invoiceDate: todayISO(),
      lines: [{ description: 'Scaling', quantity: 1, unitPrice: 150000 }]
    })
    paymentCreate(env.ctx, env.owner, { patientId: p.id, invoiceId: inv.id, paymentDate: todayISO(), amount: 150000, method: 'cash' })
    const linked = env.db.prepare('SELECT * FROM financial_transactions WHERE payment_id IS NOT NULL').all() as { id: number; payment_id: number }[]
    expect(linked.length).toBe(1)
    expect(() =>
      accountingSave(env.ctx, env.owner, { id: linked[0].id, kind: 'income', categoryId: incomeCatId, txnDate: todayISO(), amount: 1, method: 'cash', description: 'tamper' })
    ).toThrowError(/payment|void/i)
    expect(() => accountingDelete(env.ctx, env.owner, linked[0].id)).toThrowError(/payment|void/i)
  })

  it('voiding the payment removes its auto income row', () => {
    const linked = env.db.prepare('SELECT * FROM financial_transactions WHERE payment_id IS NOT NULL').all() as { id: number; payment_id: number }[]
    expect(linked.length).toBe(1)
    paymentVoid(env.ctx, env.owner, linked[0].payment_id, 'Entered on wrong invoice')
    expect((env.db.prepare('SELECT COUNT(*) AS c FROM financial_transactions WHERE payment_id IS NOT NULL').get() as { c: number }).c).toBe(0)
  })

  it('summarizes income, expenses and net correctly', () => {
    // one manual expense + one payment-driven income (150000, still valid from earlier? voided above)
    makeTxn({ amount: 100000, description: 'Rent share' })
    const summary = accountingSummary(env.ctx, { preset: '30d' })
    expect(summary.income).toBe(0)
    expect(summary.expense).toBe(100000)
    expect(summary.net).toBe(-100000)
    expect(summary.byCategory.length).toBeGreaterThanOrEqual(1)
  })
})
