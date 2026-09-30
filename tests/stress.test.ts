import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, migrate, integrityCheck, type Db } from '../src/main/core/db'
import { seed } from '../src/main/core/seed'
import { buildPaths, type AppPaths } from '../src/main/core/paths'
import type { AppContext, Actor } from '../src/main/core/context'
import { ALL_PERMISSIONS } from '../src/shared/permissions'
import { patientList, patientGet } from '../src/main/services/patients'
import { invoiceList } from '../src/main/services/invoices'
import { paymentList, paymentSummary } from '../src/main/services/payments'
import { patientTimeline } from '../src/main/services/timeline'
import { createBackup, backupList } from '../src/main/services/backup'
import { dashboardGet } from '../src/main/services/dashboard'
import { globalSearch } from '../src/main/services/search'

/**
 * Stress layer (TEST_PLAN §1): generated dataset at the spec volumes —
 * 10k+ patients / 20k+ visits / 15k+ invoices + payments — then measure the
 * hot paths: list, search, profile, financial summary, dashboard, timeline,
 * backup. Timings are printed to stdout for the delivery report and asserted
 * against generous ceilings so CI catches pathological regressions.
 */

const N_PATIENTS = 10_000
const N_VISITS = 20_000
const N_INVOICES = 15_000

let dir: string
let db: Db
let ctx: AppContext
let paths: AppPaths
const owner: Actor = { userId: 0, username: 'stress', displayName: 'Stress', permissions: new Set(ALL_PERMISSIONS) }

function ms(fn: () => void): number {
  const t0 = process.hrtime.bigint()
  fn()
  return Number(process.hrtime.bigint() - t0) / 1e6
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'dentiva-stress-'))
  paths = buildPaths(dir)
  db = openDatabase(paths.dbPath)
  migrate(db)
  seed(db)
  ctx = { db, paths, clock: () => new Date(), appVersion: '1.0.0-test' }
})

afterAll(() => {
  try { db.close() } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true })
})

describe('stress: generated dataset at spec volumes', () => {
  it(`seeds ${N_PATIENTS} patients, ${N_VISITS} visits, ${N_INVOICES} invoices+payments (bulk, transactional)`, () => {
    const t0 = Date.now()

    const run = db.transaction(() => {
      const insPatient = db.prepare(
        `INSERT INTO patients (patient_code, full_name, age, gender, phone, address, status, registered_at, created_at, updated_at)
         VALUES (?, ?, ?, 'male', ?, ?, 'active', ?, ?, ?)`
      )
      for (let i = 0; i < N_PATIENTS; i++) {
        const ts = '2026-01-01T00:00:00.000Z'
        insPatient.run(`SP-${String(i + 1).padStart(6, '0')}`, `Stress Patient ${i + 1} রহমান`, 20 + (i % 60),
          `017${String(100000000 + i).slice(0, 8)}`, `House ${i}, Road ${i % 500}, Dhaka`, ts, ts, ts)
      }
      // seed() creates roles but no dentists/users (first-run setup does) — add them directly.
      const dentistId = Number(db.prepare(
        `INSERT INTO dentists (full_name, is_active, created_at, updated_at) VALUES ('Stress Dentist', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
      ).run().lastInsertRowid)
      const roleId = (db.prepare('SELECT id FROM roles LIMIT 1').get() as { id: number }).id
      const userId = Number(db.prepare(
        `INSERT INTO users (username, password_hash, display_name, role_id, is_active, must_change_password, created_at, updated_at)
         VALUES ('stress-user', 'x', 'Stress User', ?, 1, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
      ).run(roleId).lastInsertRowid)
      owner.userId = userId // real user row → audit/received_by FKs stay valid
      const insVisit = db.prepare(
        `INSERT INTO visits (patient_id, dentist_id, visit_date, visit_time, reason, diagnosis, status, created_at, updated_at)
         VALUES (?, ?, ?, '10:00', 'Check-up', 'Routine', 'completed', ?, ?)`
      )
      for (let i = 0; i < N_VISITS; i++) {
        const pid = (i % N_PATIENTS) + 1
        const d = `2026-0${(i % 9) + 1}-15`
        insVisit.run(pid, dentistId, d, d, d)
      }
      const insInvoice = db.prepare(
        `INSERT INTO invoices (invoice_no, patient_id, visit_id, dentist_id, invoice_date, subtotal, discount, total, paid_amount, due_amount, status, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, 100000, 0, 100000, 100000, 0, 'paid', ?, ?)`
      )
      const insPayment = db.prepare(
        `INSERT INTO payments (invoice_id, patient_id, payment_date, payment_time, amount, method, received_by, status, created_at)
         VALUES (?, ?, ?, '10:30', 100000, 'cash', ?, 'valid', ?)`
      )
      for (let i = 0; i < N_INVOICES; i++) {
        const pid = (i % N_PATIENTS) + 1
        const d = `2026-0${(i % 9) + 1}-16`
        const ts = `${d}T10:30:00.000Z`
        const r = insInvoice.run(`SP-INV-${String(i + 1).padStart(6, '0')}`, pid, dentistId, d, ts, ts)
        insPayment.run(Number(r.lastInsertRowid), pid, d, userId, ts)
      }
    })
    run()
    const secs = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`    seeded dataset in ${secs}s`)
    expect((db.prepare('SELECT COUNT(*) AS c FROM patients').get() as { c: number }).c).toBeGreaterThanOrEqual(N_PATIENTS)
    expect((db.prepare('SELECT COUNT(*) AS c FROM visits').get() as { c: number }).c).toBeGreaterThanOrEqual(N_VISITS)
    expect((db.prepare('SELECT COUNT(*) AS c FROM invoices').get() as { c: number }).c).toBeGreaterThanOrEqual(N_INVOICES)
    expect(integrityCheck(db).ok).toBe(true)
  })

  it('patient list + search stay interactive (< 500 ms)', () => {
    const tList = ms(() => { patientList(ctx, owner, { preset: 'all', page: 1, pageSize: 25 }) })
    const tSearch = ms(() => { patientList(ctx, owner, { preset: 'all', search: 'রহমান 9999', page: 1, pageSize: 25 }) })
    const found = patientList(ctx, owner, { preset: 'all', search: 'Stress Patient 10000', page: 1, pageSize: 25 })
    console.log(`    patientList: ${tList.toFixed(0)} ms · bengali search: ${tSearch.toFixed(0)} ms`)
    expect(tList).toBeLessThan(500)
    expect(tSearch).toBeLessThan(500)
    expect(found.total).toBe(1)
  })

  it('patient profile (aggregates + timeline) stays interactive (< 300 ms)', () => {
    const t = ms(() => {
      patientGet(ctx, owner, 1)
      patientTimeline(ctx, 1, { preset: 'all', page: 1, pageSize: 50 })
    })
    console.log(`    patientGet + timeline: ${t.toFixed(0)} ms`)
    expect(t).toBeLessThan(300)
    const detail = patientGet(ctx, owner, 1)
    expect(detail.visitCount).toBeGreaterThanOrEqual(1)
  })

  it('billing queries stay interactive (invoices / payments / summary < 500 ms)', () => {
    const tInv = ms(() => { invoiceList(ctx, { preset: 'all', page: 1, pageSize: 25 }) })
    const tPay = ms(() => { paymentList(ctx, { preset: 'all', page: 1, pageSize: 25 }) })
    const tSum = ms(() => { paymentSummary(ctx, { preset: 'all' }) })
    console.log(`    invoiceList: ${tInv.toFixed(0)} ms · paymentList: ${tPay.toFixed(0)} ms · paymentSummary: ${tSum.toFixed(0)} ms`)
    expect(tInv).toBeLessThan(500)
    expect(tPay).toBeLessThan(500)
    expect(tSum).toBeLessThan(500)
  })

  it('dashboard + global search stay interactive (< 800 ms)', () => {
    const tDash = ms(() => { dashboardGet(ctx, owner) })
    const tSearch = ms(() => { globalSearch(ctx, owner, 'Stress Patient 5') })
    console.log(`    dashboard: ${tDash.toFixed(0)} ms · globalSearch: ${tSearch.toFixed(0)} ms`)
    expect(tDash).toBeLessThan(800)
    expect(tSearch).toBeLessThan(800)
  })

  it('backup of the full stress dataset completes and verifies (< 60 s)', async () => {
    const t0 = Date.now()
    const rec = await createBackup(ctx, owner, 'manual')
    const secs = (Date.now() - t0) / 1000
    console.log(`    backup: ${secs.toFixed(1)} s · ${(rec.sizeBytes / 1024 / 1024).toFixed(1)} MB · ${rec.status}`)
    expect(rec.status).toBe('verified')
    expect(secs).toBeLessThan(60)
    expect(backupList(ctx).length).toBeGreaterThanOrEqual(1)
  }, 120_000)
})
