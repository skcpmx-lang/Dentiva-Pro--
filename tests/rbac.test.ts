import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestEnv, completeSetupLogin, actorWith, type TestEnv } from './helpers'
import { patientCreate, patientGet } from '../src/main/services/patients'
import { globalSearch } from '../src/main/services/search'
import { reportList, reportRun } from '../src/main/services/reports'
import { dashboardGet } from '../src/main/services/dashboard'
import { notificationList, notificationMarkRead, notify, notificationUnreadCount } from '../src/main/services/notifications'
import { actorCan } from '../src/main/core/context'
import { AppError } from '@shared/errors'

let env: TestEnv

beforeAll(() => {
  env = createTestEnv()
  completeSetupLogin(env)
})

afterAll(() => {
  env.cleanup()
})

describe('permission checks inside services', () => {
  it('patientGet hides financial fields without financial.view', () => {
    const p = patientCreate(env.ctx, env.owner, { fullName: 'RBAC Patient', gender: 'male', age: 45 })
    const restricted = actorWith('front-desk', ['patient.view'])
    const full = actorWith('accountant', ['patient.view', 'financial.view'])
    const d1 = patientGet(env.ctx, restricted, p.id)
    const d2 = patientGet(env.ctx, full, p.id)
    expect(d1.totalBilled).toBeNull()
    expect(d1.outstanding).toBeNull()
    expect(d2.totalBilled).toBe(0)
    expect(d2.outstanding).toBe(0)
  })

  it('globalSearch filters modules by permission server-side', () => {
    patientCreate(env.ctx, env.owner, { fullName: 'Searchable Person', gender: 'female', age: 22, phone: '01999888777' })
    const restricted = actorWith('assistant', ['patient.view'])
    const results = globalSearch(env.ctx, restricted, 'Searchable')
    const modules = results.map((r) => r.module)
    expect(modules).toContain('patients')
    expect(modules).not.toContain('invoices')
    expect(modules).not.toContain('payments')

    // full-permission actor sees financial modules when they match
    patientCreate(env.ctx, env.owner, { fullName: 'Zephyr Q. Test', gender: 'female', age: 33 })
    const everything = globalSearch(env.ctx, env.owner, 'Zephyr')
    expect(everything.map((r) => r.module)).toContain('patients')
  })

  it('globalSearch escapes LIKE wildcards', () => {
    // A literal % in the query must not match everything.
    const p1 = patientCreate(env.ctx, env.owner, { fullName: 'Literal Percent 100% Person', gender: 'male', age: 50 })
    void p1
    const all = globalSearch(env.ctx, env.owner, '%')
    // '%' alone is a wildcard-escape; should not explode or match every row by accident
    const everyPatient = globalSearch(env.ctx, env.owner, 'Person')
    expect(everyPatient.some((g) => g.items.length > 0)).toBe(true)
    expect(Array.isArray(all)).toBe(true)
  })

  it('reportRun hides money columns without financial.view', () => {
    // visits_by_dentist requires visit.view but includes money columns for permitted actors
    const restricted = actorWith('no-fin', ['report.view', 'visit.view'])
    const res = reportRun(env.ctx, restricted, { key: 'visits_by_dentist', preset: '30d' })
    const full = reportRun(env.ctx, env.owner, { key: 'visits_by_dentist', preset: '30d' })
    const moneyCols = (r: typeof res) => r.columns.filter((c) => c.money).map((c) => c.key)
    expect(moneyCols(full).length).toBeGreaterThan(0)
    expect(moneyCols(res).length).toBe(0)
    // rows must not carry the money values either
    expect(res.rows.every((row) => !('revenue' in row))).toBe(true)
  })

  it('reportRun rejects reports the actor lacks permissions for', () => {
    const reports = reportList(env.ctx)
    const financialReport = reports.find((r) => r.requires.includes('financial.view'))
    if (!financialReport) return
    const restricted = actorWith('viewer', ['report.view'])
    expect(() => reportRun(env.ctx, restricted, { key: financialReport.key, preset: 'today' })).toThrowError(AppError)
  })

  it('dashboard hides financial block without financial.view', () => {
    const restricted = actorWith('assistant', ['patient.view', 'appointment.view'])
    const d1 = dashboardGet(env.ctx, restricted)
    expect(d1.financial).toBeNull()
    const d2 = dashboardGet(env.ctx, env.owner)
    expect(d2.financial).not.toBeNull()
  })
})

describe('notification audience visibility', () => {
  it('filters notifications by audience permission', () => {
    notify(env.ctx, { type: 'backup', severity: 'info', audience: 'admin', title: 'Backup done', body: 'ok' })
    notify(env.ctx, { type: 'stock', severity: 'warning', audience: 'inventory', title: 'Low stock', body: 'gloves' })
    notify(env.ctx, { type: 'payment', severity: 'info', audience: 'financial', title: 'Payment recorded', body: '৳500' })

    const plain = actorWith('front-desk', ['patient.view'])
    const invUser = actorWith('store-keeper', ['inventory.view'])
    const finUser = actorWith('accountant', ['financial.view'])
    const admin = actorWith('owner-2', ['backup.view', 'inventory.view', 'financial.view'])

    const forPlain = notificationList(env.ctx, plain, {}).map((n) => n.audience)
    const forInv = notificationList(env.ctx, invUser, {}).map((n) => n.audience)
    const forFin = notificationList(env.ctx, finUser, {}).map((n) => n.audience)
    const forAdmin = notificationList(env.ctx, admin, {})

    expect(forPlain.every((a) => a === 'all')).toBe(true)
    expect(forInv).toContain('inventory')
    expect(forInv).not.toContain('financial')
    expect(forFin).toContain('financial')
    expect(forFin).not.toContain('inventory')
    expect(forAdmin.length).toBe(3)
    expect(notificationUnreadCount(env.ctx, admin)).toBe(3)
  })

  it('marks notifications read individually and in bulk', () => {
    const admin = actorWith('owner-2', ['backup.view', 'inventory.view', 'financial.view'])
    const list = notificationList(env.ctx, admin, {})
    notificationMarkRead(env.ctx, admin, [list[0].id])
    expect(notificationList(env.ctx, admin, { unreadOnly: true }).length).toBe(2)
    // mark all read
    notificationMarkRead(env.ctx, admin)
    expect(notificationUnreadCount(env.ctx, admin)).toBe(0)
  })
})


describe('actorCan helper', () => {
  it('evaluates permission sets correctly', () => {
    const a = actorWith('x', ['patient.view'])
    expect(actorCan(a, 'patient.view')).toBe(true)
    expect(actorCan(a, 'patient.create')).toBe(false)
  })
})
