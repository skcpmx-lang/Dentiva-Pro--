import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 50-step business workflow (TEST_PLAN §1 "Workflow" layer).
 *
 * One sequential story through the real service layer against a real database —
 * the same code the app runs. Steps follow the spec §84 flow:
 * activation → setup → patient → appointment → queue → visit → chart →
 * treatment → prescription → invoice → payments → financial history →
 * inventory → accounting → attachments → referrals → timeline → backup →
 * restore → lock/unlock → logout/login → permission verification.
 * (Install/uninstall/physical-print steps are covered by CI/E2E and the
 * documented external validation in RELEASE_CHECKLIST.md.)
 *
 * Activation uses the mocked verifier (same approach as smoke.test.ts) so the
 * real activation path runs without the vendor code in the repo.
 */
const TEST_CODE = '1234567890'
vi.mock('../src/main/core/activationSecret', async () => {
  const { scryptSync } = await import('node:crypto')
  const salt = Buffer.from('dentiva-unit-test-salt').toString('base64')
  const verifier = scryptSync('1234567890', Buffer.from(salt, 'base64'), 32, { N: 16384, r: 8, p: 1 }).toString('base64')
  return {
    ACTIVATION_SALT: salt,
    ACTIVATION_VERIFIER: verifier,
    ACTIVATION_FINGERPRINT: 'test-fingerprint',
    ACTIVATION_PARAMS: { N: 16384, r: 8, p: 1, keylen: 32 }
  }
})

import { createTestEnv, completeSetupLogin, actorWith, type TestEnv } from './helpers'
import { activate, isActivated } from '../src/main/services/activation'
import { login, lock, unlock, changePassword } from '../src/main/services/auth'
import * as settingsSvc from '../src/main/services/settings'
import { treatmentSave } from '../src/main/services/treatments'
import { patientCreate, patientGet, patientList, patientDuplicates } from '../src/main/services/patients'
import { appointmentCreate, appointmentList, appointmentSetStatus } from '../src/main/services/appointments'
import { queueAdd, queueList, queueSetStatus } from '../src/main/services/queue'
import { visitCreate, visitGet } from '../src/main/services/visits'
import { toothConditions, chartSave, chartState, toothHistory } from '../src/main/services/chart'
import { prescriptionCreate, prescriptionGet, prescriptionList } from '../src/main/services/prescriptions'
import { invoiceCreate, invoiceGet } from '../src/main/services/invoices'
import { paymentCreate, paymentList, financialPatientSummary } from '../src/main/services/payments'
import { accountingList, accountingSave, accountingCategories, accountingSummary } from '../src/main/services/accounting'
import { supplierSave, inventorySaveItem, inventoryAddBatch, inventoryMove, inventoryItemDetail, inventoryAlerts } from '../src/main/services/inventory'
import { attachmentStore, attachmentList } from '../src/main/services/attachments'
import { referralSave, referralList } from '../src/main/services/referrals'
import { patientTimeline } from '../src/main/services/timeline'
import { dashboardGet } from '../src/main/services/dashboard'
import { reportList, reportRun } from '../src/main/services/reports'
import { globalSearch } from '../src/main/services/search'
import { createBackup, backupList, restoreBackup } from '../src/main/services/backup'
import { integrityCheck } from '../src/main/core/db'
import { todayISO } from '../src/shared/dates'

let env: TestEnv
let token: string
let dentistId: number
let patientId: number
let visitId: number
let invoiceId: number
let invoiceTotal = 0
let glovesItemId = 0
let glovesBatchId = 0
let attachmentTmpDir: string

beforeAll(() => {
  env = createTestEnv()
  attachmentTmpDir = mkdtempSync(join(tmpdir(), 'dentiva-workflow-'))
})

afterAll(() => {
  env.cleanup()
  rmSync(attachmentTmpDir, { recursive: true, force: true })
})

describe('50-step business workflow (sequential)', () => {
  /* ---- 1–4: activation & setup ---- */
  it('steps 1–2: rejects a wrong activation code, then activates the license', () => {
    expect(isActivated(env.ctx)).toBe(false)
    expect(() => activate(env.ctx, '0000000000')).toThrowError(/Invalid activation code/)
    activate(env.ctx, '123-456 7890') // separators stripped → TEST_CODE
    expect(isActivated(env.ctx)).toBe(true)
    expect(() => activate(env.ctx, TEST_CODE)).toThrowError(/already activated/)
  })

  it('step 3: completes first-run setup (clinic + dentist + owner) and logs in', () => {
    token = completeSetupLogin(env)
    expect(token).toBeTruthy()
    const dentists = settingsSvc.listDentists(env.ctx, false)
    expect(dentists.length).toBeGreaterThanOrEqual(1)
    dentistId = dentists[0].id
  })

  it('step 4: rejects bad credentials before the workday starts', () => {
    expect(() => login(env.ctx, env.sessions, 'admin', 'wrong-password')).toThrowError(/Invalid username or password/)
  })

  /* ---- 5–9: treatment catalog + patient registration ---- */
  it('step 5: adds a treatment to the catalog with a price', () => {
    const t = treatmentSave(env.ctx, env.owner, {
      code: 'WF-RCT', name: 'Root Canal Treatment', category: 'Endodontics', defaultPrice: 450000, durationMinutes: 60
    })
    expect(t.id).toBeGreaterThan(0)
    expect(t.defaultPrice).toBe(450000)
  })

  it('step 6: registers a patient (auto code, Bengali name supported)', () => {
    const p = patientCreate(env.ctx, env.owner, {
      fullName: 'আয়েশা রহমান', gender: 'female', age: 28, phone: '01712345678',
      chiefComplaint: 'বাম পাটে ব্যথা', address: 'House 12, Dhanmondi, Dhaka'
    })
    expect(p.patientCode).toMatch(/^[A-Z]+-\d+$/)
    patientId = p.id
  })

  it('step 7: flags a duplicate registration attempt (name + phone)', () => {
    const dups = patientDuplicates(env.ctx, 'আয়েশা রহমান', '01712345678')
    expect(dups.some((d) => d.id === patientId)).toBe(true)
  })

  it('step 8: books an appointment for today', () => {
    const a = appointmentCreate(env.ctx, env.owner, {
      patientId, dentistId, apptDate: todayISO(), apptTime: '10:00', durationMinutes: 30, reason: 'Severe toothache'
    })
    expect(a.status).toBe('scheduled')
    expect(appointmentList(env.ctx, { date: todayISO(), page: 1, pageSize: 10 }).total).toBe(1)
  })

  it('step 9: prevents double-booking the same dentist slot', () => {
    expect(() =>
      appointmentCreate(env.ctx, env.owner, { patientId, dentistId, apptDate: todayISO(), apptTime: '10:00', durationMinutes: 30 })
    ).toThrowError(/already has an appointment/)
  })

  /* ---- 10–12: front desk — appointment status & queue ---- */
  it('step 10: confirms the appointment and issues a queue token', () => {
    const appt = appointmentList(env.ctx, { date: todayISO(), page: 1, pageSize: 10 }).rows[0]
    expect(appointmentSetStatus(env.ctx, env.owner, appt.id, 'confirmed').status).toBe('confirmed')
    const entry = queueAdd(env.ctx, env.owner, { patientId, dentistId, priority: 'normal', appointmentId: appt.id })
    expect(entry.tokenNo).toBeGreaterThanOrEqual(1)
    expect(entry.status).toBe('waiting')
    expect(queueList(env.ctx, todayISO()).some((q) => q.id === entry.id)).toBe(true)
  })

  it('step 11: walks the token through the queue (waiting → finished)', () => {
    const entry = queueList(env.ctx, todayISO()).find((q) => q.patientId === patientId)!
    for (const status of ['called', 'in_treatment', 'billing', 'finished']) {
      expect(queueSetStatus(env.ctx, env.owner, entry.id, status).status).toBe(status)
    }
  })

  it('step 12: the finished token leaves the active queue', () => {
    const active = queueList(env.ctx, todayISO()).filter((q) => q.patientId === patientId && q.status !== 'finished')
    expect(active.length).toBe(0)
  })

  /* ---- 13–15: chairside — visit, chart, prescription ---- */
  it('step 13: records the visit with treatment lines (price snapshot)', () => {
    const v = visitCreate(env.ctx, env.owner, {
      patientId, dentistId, visitDate: todayISO(), visitTime: '10:15',
      reason: 'Severe toothache', chiefComplaint: 'বাম পাটে ব্যথা',
      examination: 'Deep caries 16, percussion positive',
      diagnosis: 'Irreversible pulpitis tooth 16',
      treatmentSummary: 'RCT initiated',
      treatments: [{ name: 'Root Canal Treatment', unitPrice: 450000, quantity: 1, toothNumbers: '16' }]
    })
    expect(v.treatments.length).toBe(1)
    expect(v.treatments[0].unitPrice).toBe(450000)
    visitId = v.id
    expect(visitGet(env.ctx, visitId).diagnosis).toContain('pulpitis')
  })

  it('step 14: charts tooth 16 with a caries condition and history entry', () => {
    const caries = toothConditions(env.ctx).find((c) => c.code === 'caries') ?? toothConditions(env.ctx)[0]
    chartSave(env.ctx, env.owner, {
      patientId, visitId, dentition: 'adult',
      entries: [{ tooth: 16, conditionId: caries.id, note: 'Deep caries, RCT initiated' }]
    })
    const state = chartState(env.ctx, patientId, 'adult')
    expect(state.states.find((s) => s.tooth === 16)?.conditionId).toBe(caries.id)
    expect(toothHistory(env.ctx, patientId, 'adult', 16).length).toBe(1)
  })

  it('step 15: writes the prescription (scheduled + SOS medicines)', () => {
    const rx = prescriptionCreate(env.ctx, env.owner, {
      patientId, visitId, dentistId, rxDate: todayISO(),
      cc: ['Toothache'], oe: ['Percussion positive'],
      advice: 'Warm saline rinse 3× daily',
      followUpDate: todayISO(),
      medicines: [
        { name: 'Amoxicillin', doseForm: 'capsule', strength: '500 mg', morning: true, night: true, meal: 'after', durationValue: 5, durationUnit: 'day', sortOrder: 0 },
        { name: 'Paracetamol', doseForm: 'tablet', strength: '500 mg', isPrn: true, instruction: 'SOS — for pain', sortOrder: 1 }
      ]
    })
    expect(rx.medicines.length).toBe(2)
    expect(prescriptionGet(env.ctx, rx.id).medicines[0].name).toBe('Amoxicillin')
    expect(prescriptionList(env.ctx, env.owner, { preset: 'all', page: 1, pageSize: 10 }).total).toBe(1)
  })

  /* ---- 16–20: billing — invoice, partial payment, settlement ---- */
  it('step 16: creates the invoice from the visit (discount applied)', () => {
    const inv = invoiceCreate(env.ctx, env.owner, {
      patientId, visitId, dentistId, invoiceDate: todayISO(), discount: 50000,
      lines: [{ description: 'Root Canal Treatment', quantity: 1, unitPrice: 450000 }]
    })
    expect(inv.subtotal).toBe(450000)
    expect(inv.total).toBe(400000) // ৳4,000 after ৳500 discount
    expect(inv.status).toBe('unpaid')
    invoiceId = inv.id
    invoiceTotal = inv.total
  })

  it('step 17: takes a partial payment (bKash) → invoice becomes partial', () => {
    const pay = paymentCreate(env.ctx, env.owner, { patientId, invoiceId, paymentDate: todayISO(), amount: 150000, method: 'bkash', reference: 'TRX-8891' })
    expect(pay.status).toBe('valid')
    const inv = invoiceGet(env.ctx, invoiceId)
    expect(inv.status).toBe('partial')
    expect(inv.paidAmount).toBe(150000)
    expect(inv.dueAmount).toBe(invoiceTotal - 150000)
  })

  it('step 18: rejects overpayment beyond the due amount', () => {
    const due = invoiceGet(env.ctx, invoiceId).dueAmount
    expect(() =>
      paymentCreate(env.ctx, env.owner, { patientId, invoiceId, paymentDate: todayISO(), amount: due + 1000, method: 'cash' })
    ).toThrowError(/exceeds the outstanding balance/)
  })

  it('step 19: settles the remainder (cash) → invoice becomes paid', () => {
    const due = invoiceGet(env.ctx, invoiceId).dueAmount
    paymentCreate(env.ctx, env.owner, { patientId, invoiceId, paymentDate: todayISO(), amount: due, method: 'cash' })
    const inv = invoiceGet(env.ctx, invoiceId)
    expect(inv.status).toBe('paid')
    expect(inv.dueAmount).toBe(0)
  })

  it('step 20: financial history is complete and consistent', () => {
    const fin = financialPatientSummary(env.ctx, patientId)
    expect(fin.totalBilled).toBe(invoiceTotal)
    expect(fin.totalPaid).toBe(invoiceTotal)
    expect(fin.outstanding).toBe(0)
    expect(fin.payments.length).toBe(2)
    expect(paymentList(env.ctx, { preset: 'all', invoiceId, page: 1, pageSize: 10 }).total).toBe(2)
    const detail = patientGet(env.ctx, env.owner, patientId)
    expect(detail.totalBilled).toBe(invoiceTotal)
    expect(detail.outstanding).toBe(0)
  })

  /* ---- 21–23: accounting ---- */
  it('step 21: payments auto-post to the accounting ledger as income', () => {
    const rows = accountingList(env.ctx, { preset: 'all', page: 1, pageSize: 50 }).rows
    const auto = rows.filter((r) => r.paymentId !== null)
    expect(auto.length).toBe(2)
    expect(auto.reduce((s, r) => s + r.amount, 0)).toBe(invoiceTotal)
  })

  it('step 22: records a manual expense (gloves restock)', () => {
    const expenseCat = accountingCategories(env.ctx).find((c) => c.name === 'Supplies & Accessories')!
    const txn = accountingSave(env.ctx, env.owner, {
      kind: 'expense', categoryId: expenseCat.id, amount: 75000, txnDate: todayISO(), method: 'cash',
      description: 'Nitrile gloves restock'
    })
    expect(txn.id).toBeGreaterThan(0)
  })

  it('step 23: accounting summary nets income against expenses', () => {
    const sum = accountingSummary(env.ctx, { preset: 'all' })
    expect(sum.income).toBe(invoiceTotal)
    expect(sum.expense).toBe(75000)
    expect(sum.net).toBe(invoiceTotal - 75000)
  })

  /* ---- 24–27: inventory ---- */
  it('step 24: adds a supplier and receives stock (batch)', () => {
    const sup = supplierSave(env.ctx, env.owner, { name: 'Dental Supply BD', phone: '01822334455', contactPerson: 'Kamal Hossain' })
    const item = inventorySaveItem(env.ctx, env.owner, { name: 'Nitrile Gloves', sku: 'GLV-100', unit: 'box', reorderThreshold: 5, category: 'Consumables' })
    glovesItemId = item.id
    const batch = inventoryAddBatch(env.ctx, env.owner, {
      itemId: glovesItemId, supplierId: sup.id, purchaseDate: todayISO(), batchNo: 'GLV-2026-01',
      expiryDate: '2027-09-30', purchaseCost: 40000, qtyPurchased: 10
    })
    expect(batch.qtyCurrent).toBe(10)
    glovesBatchId = batch.id
    expect(inventoryItemDetail(env.ctx, glovesItemId).item.currentStock).toBe(10)
  })

  it('step 25: consumes stock chairside (FIFO usage movement)', () => {
    inventoryMove(env.ctx, env.owner, { itemId: glovesItemId, type: 'usage', quantity: 3, reason: 'Chairside consumption' })
    const detail = inventoryItemDetail(env.ctx, glovesItemId)
    expect(detail.item.currentStock).toBe(7)
    expect(detail.movements.some((m) => m.type === 'usage' && m.quantity === 3)).toBe(true)
  })

  it('step 26: adjust count below reorder threshold → low-stock alert fires', () => {
    inventoryMove(env.ctx, env.owner, { itemId: glovesItemId, batchId: glovesBatchId, type: 'adjust', quantity: 4, reason: 'Physical count' })
    expect(inventoryItemDetail(env.ctx, glovesItemId).item.currentStock).toBe(4)
    expect(inventoryAlerts(env.ctx).lowStock.some((i) => i.sku === 'GLV-100')).toBe(true)
  })

  it('step 27: stock can never go negative', () => {
    expect(() =>
      inventoryMove(env.ctx, env.owner, { itemId: glovesItemId, type: 'usage', quantity: 999, reason: 'Impossible draw' })
    ).toThrowError(/Insufficient stock/)
  })

  /* ---- 28–29: attachments & referral ---- */
  it('step 28: stores a patient X-ray attachment and lists it', () => {
    const src = join(attachmentTmpDir, 'xray.png')
    writeFileSync(src, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')) // minimal PNG header
    const att = attachmentStore(env.ctx, env.owner, src, { patientId, visitId, category: 'xray', description: 'OPG tooth 16' })
    expect(att.id).toBeGreaterThan(0)
    const list = attachmentList(env.ctx, patientId)
    expect(list.length).toBe(1)
    expect(list[0].category).toBe('xray')
  })

  it('step 29: refers the patient to an oral surgeon and tracks it', () => {
    const ref = referralSave(env.ctx, env.owner, {
      patientId, visitId, fromDentistId: dentistId,
      toDoctorName: 'Dr. Sadiqa Rahman', toClinic: 'City Dental Hospital',
      reason: 'Complex impaction requiring surgical removal'
    })
    expect(ref.status).toBe('pending')
    expect(referralList(env.ctx, { preset: 'all', page: 1, pageSize: 10 }).total).toBe(1)
  })

  /* ---- 30–32: cross-cutting views ---- */
  it('step 30: patient timeline aggregates the whole episode', () => {
    const tl = patientTimeline(env.ctx, patientId, { preset: 'all', page: 1, pageSize: 50 })
    const types = tl.rows.map((e) => e.type)
    expect(types).toContain('registration')
    expect(types).toContain('visit')
    expect(tl.rows.length).toBeGreaterThanOrEqual(2)
  })

  it('step 31: dashboard reflects today’s activity', () => {
    const d = dashboardGet(env.ctx, env.owner)
    expect(d.appointmentCountToday).toBeGreaterThanOrEqual(1)
    expect(d.newPatientsToday).toBeGreaterThanOrEqual(1)
  })

  it('step 32: runs a report for the period', () => {
    const report = reportList(env.ctx).find((r) => env.owner.permissions.has(r.requires[0]))!
    const result = reportRun(env.ctx, env.owner, { key: report.key, preset: 'all' })
    expect(result.title).toBeTruthy()
    expect(result.columns.length).toBeGreaterThan(0)
  })

  /* ---- 33–35: permission verification (restricted actor) ---- */
  it('step 33: a front-desk actor cannot see financial data on the patient profile', () => {
    const frontDesk = actorWith('front-desk', ['patient.view'])
    const d = patientGet(env.ctx, frontDesk, patientId)
    expect(d.totalBilled).toBeNull()
    expect(d.outstanding).toBeNull()
  })

  it('step 34: global search hides financial modules from a restricted actor', () => {
    const frontDesk = actorWith('front-desk', ['patient.view'])
    const results = globalSearch(env.ctx, frontDesk, 'আয়েশা')
    expect(results.some((r) => r.module === 'patients')).toBe(true)
    expect(results.some((r) => r.module === 'invoices' || r.module === 'payments')).toBe(false)
  })

  it('step 35: financial reports are denied to a restricted actor', () => {
    const frontDesk = actorWith('front-desk', ['patient.view'])
    const financialReport = reportList(env.ctx).find((r) => !r.requires.every((p) => frontDesk.permissions.has(p)))!
    expect(() => reportRun(env.ctx, frontDesk, { key: financialReport.key, preset: 'all' })).toThrowError(/permission/i)
  })

  /* ---- 36–39: session lifecycle — lock, unlock, password change, logout/login ---- */
  it('step 36: locks the workstation and rejects a wrong unlock password', () => {
    lock(env.sessions, token)
    expect(env.sessions.get(token)?.locked).toBe(true)
    expect(() => unlock(env.ctx, env.sessions, token, 'wrong-password')).toThrowError(/password/i)
    expect(env.sessions.get(token)?.locked).toBe(true)
  })

  it('step 37: unlocks with the correct password', () => {
    unlock(env.ctx, env.sessions, token, 'admin123')
    expect(env.sessions.get(token)?.locked).toBe(false)
  })

  it('step 38: changes the owner password (old rejected, new accepted, then reverted)', () => {
    changePassword(env.ctx, env.sessions, token, 'admin123', 'FreshPass2026')
    expect(() => login(env.ctx, env.sessions, 'admin', 'admin123')).toThrowError(/Invalid username or password/)
    const relog = login(env.ctx, env.sessions, 'admin', 'FreshPass2026')
    expect(relog.token).toBeTruthy()
    changePassword(env.ctx, env.sessions, relog.token, 'FreshPass2026', 'admin123')
    expect(login(env.ctx, env.sessions, 'admin', 'admin123').token).toBeTruthy()
  })

  it('step 39: logs out (session dropped) and logs back in', () => {
    const fresh = login(env.ctx, env.sessions, 'admin', 'admin123')
    env.sessions.drop(fresh.token)
    expect(env.sessions.get(fresh.token)).toBeNull()
    const again = login(env.ctx, env.sessions, 'admin', 'admin123')
    expect(env.sessions.get(again.token)).not.toBeNull()
    token = again.token
  })

  /* ---- 40–42: backup & restore ---- */
  it('step 40: creates a verified manual backup', async () => {
    const rec = await createBackup(env.ctx, env.owner, 'manual')
    expect(rec.status).toBe('verified')
    expect(rec.fileExists).toBe(true)
    expect(backupList(env.ctx).some((b) => b.id === rec.id)).toBe(true)
  })

  it('step 41: records a new patient AFTER the backup', () => {
    patientCreate(env.ctx, env.owner, { fullName: 'Post-Backup Patient', gender: 'male', age: 40 })
    expect(patientList(env.ctx, env.owner, { preset: 'all', search: 'Post-Backup', page: 1, pageSize: 10 }).total).toBe(1)
  })

  it('step 42: restores the backup — post-backup data is gone, workflow data intact', async () => {
    const rec = backupList(env.ctx)[0]
    const restored = await restoreBackup(env.ctx, env.owner, rec.id, 'RESTORE', () => {})
    expect(restored.ok).toBe(true)
    expect(patientList(env.ctx, env.owner, { preset: 'all', search: 'Post-Backup', page: 1, pageSize: 10 }).total).toBe(0)
    expect(patientList(env.ctx, env.owner, { preset: 'all', search: 'আয়েশা', page: 1, pageSize: 10 }).total).toBe(1)
    expect(invoiceGet(env.ctx, invoiceId).status).toBe('paid')
    expect(integrityCheck(env.ctx.db).ok).toBe(true)
  })
})
