import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

/**
 * Production activation uses a verifier derived from the vendor-issued code,
 * which is intentionally absent from this repository. Tests substitute a
 * verifier derived from a known throwaway code so the real activation path
 * (normalization, single-use, audit) is still exercised.
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
import { createTestEnv, completeSetupLogin, type TestEnv } from './helpers'
import { activate, isActivated } from '../src/main/services/activation'
import { getSetupState } from '../src/main/services/setup'
import { patientCreate, patientList, patientGet, patientDuplicates } from '../src/main/services/patients'
import { visitCreate, visitList } from '../src/main/services/visits'
import { prescriptionCreate } from '../src/main/services/prescriptions'
import { invoiceCreate, invoiceGet } from '../src/main/services/invoices'
import { paymentCreate, paymentSummary, financialPatientSummary } from '../src/main/services/payments'
import { appointmentCreate, appointmentList } from '../src/main/services/appointments'
import { queueAdd, queueList, queueSetStatus } from '../src/main/services/queue'
import { login } from '../src/main/services/auth'
import { todayISO } from '../src/shared/dates'

let env: TestEnv
let token: string

beforeAll(() => {
  env = createTestEnv()
})

afterAll(() => {
  env.cleanup()
})

describe('activation + first-run setup', () => {
  it('rejects wrong activation codes', () => {
    expect(isActivated(env.ctx)).toBe(false)
    expect(() => activate(env.ctx, '0000000000')).toThrowError(/Invalid activation code/)
    expect(() => activate(env.ctx, 'not-a-code')).toThrowError()
    expect(isActivated(env.ctx)).toBe(false)
  })

  it('activates with the correct code (normalization strips separators)', () => {
    activate(env.ctx, '123-456 7890') // normalizes to TEST_CODE
    expect(isActivated(env.ctx)).toBe(true)
    expect(() => activate(env.ctx, TEST_CODE)).toThrowError(/already activated/)
  })

  it('completes setup and logs in the owner', () => {
    token = completeSetupLogin(env)
    expect(token).toBeTruthy()
    const state = getSetupState(env.ctx)
    expect(state.initialized).toBe(true)
    expect(state.activated).toBe(true)
  })

  it('rejects bad login credentials', () => {
    expect(() => login(env.ctx, env.sessions, 'admin', 'wrongpass1')).toThrowError(/Invalid username or password/)
    expect(() => login(env.ctx, env.sessions, 'ghost', 'whatever1')).toThrowError()
  })
})

describe('patient lifecycle', () => {
  it('creates a patient with an auto-generated unique code', () => {
    const p = patientCreate(env.ctx, env.owner, {
      fullName: 'আরিফুল ইসলাম',
      gender: 'male',
      age: 32,
      phone: '01712345678',
      chiefComplaint: 'Tooth pain',
      address: 'ধানমন্ডি, ঢাকা'
    })
    expect(p.patientCode).toMatch(/^DP-\d+$/)
    expect(p.fullName).toBe('আরিফুল ইসলাম')
    const p2 = patientCreate(env.ctx, env.owner, { fullName: 'Karim Uddin', gender: 'male', phone: '01812345678' })
    expect(p2.patientCode).not.toBe(p.patientCode)
  })

  it('detects duplicate patients by name/phone', () => {
    const dups = patientDuplicates(env.ctx, 'আরিফুল ইসলাম', '01712345678')
    expect(dups.length).toBe(1)
  })

  it('lists patients with today default and search (Bengali)', () => {
    const list = patientList(env.ctx, env.owner, { preset: 'today', page: 1, pageSize: 25 })
    expect(list.total).toBe(2)
    const search = patientList(env.ctx, env.owner, { preset: 'all', search: 'আরিফুল', page: 1, pageSize: 25 })
    expect(search.total).toBe(1)
  })

  it('returns patient list rows in the camelCase shape the UI renders', () => {
    // Regression: patientList once leaked raw snake_case rows (full_name,
    // patient_code…) — every list column and patient picker rendered blank.
    const list = patientList(env.ctx, env.owner, { preset: 'all', page: 1, pageSize: 25, status: 'all' })
    const row = list.rows.find((r) => r.fullName === 'আরিফুল ইসলাম')
    expect(row).toBeDefined()
    expect(row?.patientCode).toMatch(/^DP-\d+$/)
    expect(row?.phone).toBe('01712345678')
    expect(row?.chiefComplaint).toBe('Tooth pain')
    expect(row?.gender).toBe('male')
    expect(row?.visitCount).toBe(0)
    expect(row?.lastVisitDate).toBeNull()
    expect(row?.registeredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(row?.archived).toBe(false)
    // the snake_case keys must not leak across the IPC boundary
    expect(Object.keys(row ?? {})).not.toContain('full_name')
    expect(Object.keys(row ?? {})).not.toContain('patient_code')
  })

  it('sorts the patient list by last visit without a SQL error', () => {
    // Regression: ORDER BY lastVisit referenced a non-existent column.
    expect(() => patientList(env.ctx, env.owner, { preset: 'all', page: 1, pageSize: 25, sort: 'lastVisit' })).not.toThrow()
    expect(() => patientList(env.ctx, env.owner, { preset: 'all', page: 1, pageSize: 25, sort: 'name' })).not.toThrow()
  })

  it('blocks duplicate patient codes', () => {
    expect(() =>
      patientCreate(env.ctx, env.owner, { fullName: 'Code Clash', gender: 'female', patientCode: 'DP-00001' })
    ).toThrowError(/already in use/)
  })

  it('rejects invalid patient data with clear messages', () => {
    expect(() => patientCreate(env.ctx, env.owner, { fullName: 'A', gender: 'male' })).toThrowError(/name/i)
    expect(() => patientCreate(env.ctx, env.owner, { fullName: 'Valid Name', gender: 'alien' as never })).toThrowError()
  })
})

describe('appointments + queue', () => {
  it('creates an appointment and adds the patient to the queue', () => {
    const patients = patientList(env.ctx, env.owner, { preset: 'all', page: 1, pageSize: 10 })
    const patientId = patients.rows[0].id
    const dentist = env.db.prepare('SELECT id FROM dentists').get() as { id: number }
    const appt = appointmentCreate(env.ctx, env.owner, {
      patientId, dentistId: dentist.id, apptDate: todayISO(), apptTime: '10:30', reason: 'Check-up'
    })
    expect(appt.status).toBe('scheduled')
    const q = queueAdd(env.ctx, env.owner, { patientId, dentistId: dentist.id, priority: 'normal', appointmentId: appt.id })
    expect(q.tokenNo).toBe(1)
    expect(q.status).toBe('waiting')
    const called = queueSetStatus(env.ctx, env.owner, q.id, 'called')
    expect(called.status).toBe('called')
    const today = queueList(env.ctx)
    expect(today.length).toBe(1)
  })

  it('prevents double booking the same dentist slot', () => {
    const patients = patientList(env.ctx, env.owner, { preset: 'all', page: 1, pageSize: 10 })
    const dentist = env.db.prepare('SELECT id FROM dentists').get() as { id: number }
    expect(() =>
      appointmentCreate(env.ctx, env.owner, {
        patientId: patients.rows[1].id, dentistId: dentist.id, apptDate: todayISO(), apptTime: '10:30', durationMinutes: 30
      })
    ).toThrowError(/already has an appointment/)
    const list = appointmentList(env.ctx, { date: todayISO(), page: 1, pageSize: 10 })
    expect(list.total).toBe(1)
  })
})

describe('visits + prescription', () => {
  it('records a visit with treatments (price snapshots)', () => {
    const patients = patientList(env.ctx, env.owner, { preset: 'all', page: 1, pageSize: 10 })
    const patientId = patients.rows[0].id
    const dentist = env.db.prepare('SELECT id FROM dentists').get() as { id: number }
    const treatment = env.db.prepare('SELECT id, default_price FROM treatments LIMIT 1').get() as { id: number; default_price: number }
    const visit = visitCreate(env.ctx, env.owner, {
      patientId, dentistId: dentist.id, visitDate: todayISO(), visitTime: '11:00',
      chiefComplaint: 'Pain', diagnosis: 'Caries', treatments: [
        { treatmentId: treatment.id, name: 'Composite Filling', unitPrice: treatment.default_price, quantity: 1 }
      ]
    })
    expect(visit.treatments.length).toBe(1)
    expect(visit.treatments[0].unitPrice).toBe(treatment.default_price)
    const list = visitList(env.ctx, env.owner, { preset: '30d', page: 1, pageSize: 10 })
    expect(list.total).toBe(1)
  })

  it('creates a prescription with multiple structured medicines', () => {
    const patients = patientList(env.ctx, env.owner, { preset: 'all', page: 1, pageSize: 10 })
    const patientId = patients.rows[0].id
    const dentist = env.db.prepare('SELECT id FROM dentists').get() as { id: number }
    const rx = prescriptionCreate(env.ctx, env.owner, {
      patientId, dentistId: dentist.id, rxDate: todayISO(),
      cc: ['Pain', 'Sensitivity'], oe: ['Caries', 'Pulpitis'],
      advice: 'Rinse with warm salt water.',
      medicines: [
        { name: 'Amoxicillin', doseForm: 'capsule', strength: '500 mg', morning: true, noon: true, night: true, meal: 'after', durationValue: 5, durationUnit: 'day', sortOrder: 0 },
        { name: 'Paracetamol', doseForm: 'tablet', strength: '500 mg', morning: true, night: true, meal: 'after', isPrn: true, instruction: 'when required', sortOrder: 1 }
      ]
    })
    expect(rx.rxNo).toMatch(/^RX-\d+$/)
    expect(rx.medicines.length).toBe(2)
    expect(rx.dentistQualifications).toContain('BDS')
    expect(rx.dentistDesignations).toContain('Consultant')
    expect(() =>
      prescriptionCreate(env.ctx, env.owner, {
        patientId, dentistId: dentist.id, rxDate: todayISO(), cc: [], oe: [], medicines: []
      })
    ).toThrowError(/at least one medicine/i)
  })
})

describe('financial integrity', () => {
  it('invoice → partial payment → outstanding → full settlement stays consistent', () => {
    const patients = patientList(env.ctx, env.owner, { preset: 'all', page: 1, pageSize: 10 })
    const patientId = patients.rows[0].id
    const invoice = invoiceCreate(env.ctx, env.owner, {
      patientId, invoiceDate: todayISO(), discount: 10000,
      lines: [
        { description: 'Root Canal Treatment', quantity: 1, unitPrice: 600000 },
        { description: 'Crown', quantity: 1, unitPrice: 800000 }
      ]
    })
    // 14000 - 100 = 13900 taka = 1390000 paisa
    expect(invoice.total).toBe(1390000)
    expect(invoice.status).toBe('unpaid')
    expect(invoice.dueAmount).toBe(1390000)

    const pay1 = paymentCreate(env.ctx, env.owner, {
      patientId, invoiceId: invoice.id, paymentDate: todayISO(), amount: 500000, method: 'cash'
    })
    expect(pay1.amount).toBe(500000)
    const after1 = invoiceGet(env.ctx, invoice.id)
    expect(after1.paidAmount).toBe(500000)
    expect(after1.dueAmount).toBe(890000)
    expect(after1.status).toBe('partial')

    // Overpayment blocked by default
    expect(() =>
      paymentCreate(env.ctx, env.owner, { patientId, invoiceId: invoice.id, paymentDate: todayISO(), amount: 900000, method: 'cash' })
    ).toThrowError(/exceeds the outstanding balance/)

    const pay2 = paymentCreate(env.ctx, env.owner, {
      patientId, invoiceId: invoice.id, paymentDate: todayISO(), amount: 890000, method: 'bkash', reference: 'TRX123'
    })
    void pay2
    const after2 = invoiceGet(env.ctx, invoice.id)
    expect(after2.status).toBe('paid')
    expect(after2.dueAmount).toBe(0)

    const summary = paymentSummary(env.ctx, { preset: 'today' })
    expect(summary.totalCollected).toBe(1390000)
    expect(summary.byMethod.cash).toBe(500000)
    expect(summary.byMethod.bkash).toBe(890000)
    expect(summary.transactionCount).toBe(2)

    const fin = financialPatientSummary(env.ctx, patientId)
    expect(fin.totalBilled).toBe(1390000)
    expect(fin.totalPaid).toBe(1390000)
    expect(fin.outstanding).toBe(0)
  })

  it('auto-creates accounting income for payments', () => {
    const rows = env.db.prepare("SELECT * FROM financial_transactions WHERE kind = 'income'").all() as { amount: number; payment_id: number }[]
    expect(rows.length).toBe(2)
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(1390000)
  })

  it('patient profile exposes financial data only for permitted actors', () => {
    const patients = patientList(env.ctx, env.owner, { preset: 'all', page: 1, pageSize: 10 })
    const detail = patientGet(env.ctx, env.owner, patients.rows[0].id)
    expect(detail.totalBilled).toBe(1390000)
    expect(detail.outstanding).toBe(0)

    const noPerm = { userId: 5, username: 'assistant', displayName: 'A', permissions: new Set(['patient.view']) }
    const detail2 = patientGet(env.ctx, noPerm, patients.rows[0].id)
    expect(detail2.totalBilled).toBeNull()
    expect(detail2.outstanding).toBeNull()
  })
})
