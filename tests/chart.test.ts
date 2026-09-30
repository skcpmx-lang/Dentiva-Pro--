import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestEnv, completeSetupLogin, type TestEnv } from './helpers'
import { toothConditions, chartState, chartSave, toothHistory, conditionSave, conditionDelete } from '../src/main/services/chart'
import { patientCreate, patientList } from '../src/main/services/patients'
import { visitCreate } from '../src/main/services/visits'

let env: TestEnv
let patientId: number
let visitId: number
let cariesId: number
let filledId: number

beforeAll(() => {
  env = createTestEnv()
  completeSetupLogin(env)
  const p = patientCreate(env.ctx, env.owner, { fullName: 'Chart Patient', gender: 'female', age: 28 })
  patientId = p.id
  const dentist = env.db.prepare('SELECT id FROM dentists').get() as { id: number }
  const v = visitCreate(env.ctx, env.owner, { patientId, dentistId: dentist.id, visitDate: '2026-03-01', visitTime: '10:00', chiefComplaint: 'Check-up' })
  visitId = v.id
  const conds = toothConditions(env.ctx)
  cariesId = conds.find((c) => c.code === 'caries')?.id ?? conds[0].id
  filledId = conds.find((c) => c.code === 'filled')?.id ?? conds[1].id
})

afterAll(() => {
  env.cleanup()
})

describe('dental chart', () => {
  it('validates FDI tooth numbers per dentition', () => {
    expect(() =>
      chartSave(env.ctx, env.owner, { patientId, visitId, dentition: 'adult', entries: [{ tooth: 99, conditionId: cariesId }] })
    ).toThrowError(/tooth|FDI/i)
    expect(() =>
      chartSave(env.ctx, env.owner, { patientId, visitId, dentition: 'pediatric', entries: [{ tooth: 11, conditionId: cariesId }] })
    ).toThrowError(/tooth|FDI|pediatric/i)
  })

  it('saves conditions and builds per-dentition state', () => {
    chartSave(env.ctx, env.owner, {
      patientId, visitId, dentition: 'adult',
      entries: [
        { tooth: 16, conditionId: cariesId, note: 'Occlusal caries' },
        { tooth: 26, conditionId: filledId }
      ]
    })
    const state = chartState(env.ctx, patientId, 'adult')
    const t16 = state.states.find((s) => s.tooth === 16)
    const t26 = state.states.find((s) => s.tooth === 26)
    expect(t16?.conditionId).toBe(cariesId)
    expect(t16?.note).toBe('Occlusal caries')
    expect(t26?.conditionId).toBe(filledId)
    // all 32 adult teeth are represented; only two carry a condition
    expect(state.states.filter((s) => s.conditionId !== null).length).toBe(2)
    expect(state.states.length).toBe(32)

    // pediatric dentition is independent
    const ped = chartState(env.ctx, patientId, 'pediatric')
    expect(ped.states.filter((s) => s.conditionId !== null).length).toBe(0)
  })

  it('keeps history per tooth (latest state wins)', () => {
    chartSave(env.ctx, env.owner, { patientId, visitId, dentition: 'adult', entries: [{ tooth: 16, conditionId: filledId, note: 'Restored' }] })
    const state = chartState(env.ctx, patientId, 'adult')
    expect(state.states.find((s) => s.tooth === 16)?.conditionId).toBe(filledId)
    const history = toothHistory(env.ctx, patientId, 'adult', 16)
    expect(history.length).toBe(2)
    expect(history[0].conditionId).toBe(filledId) // newest first
  })

  it('prevents charting for another patient\'s visit', () => {
    const p2 = patientCreate(env.ctx, env.owner, { fullName: 'Other Patient', gender: 'male', age: 40 })
    expect(() =>
      chartSave(env.ctx, env.owner, { patientId: p2.id, visitId, dentition: 'adult', entries: [{ tooth: 11, conditionId: cariesId }] })
    ).toThrowError(/visit/i)
  })

  it('deactivates system conditions instead of deleting them', () => {
    const conds = toothConditions(env.ctx)
    const systemCond = conds.find((c) => c.isSystem)
    if (!systemCond) return
    expect(() => conditionDelete(env.ctx, env.owner, systemCond.id)).toThrowError(/system|deactivate/i)
  })

  it('blocks deleting conditions that are in use', () => {
    const custom = conditionSave(env.ctx, env.owner, { code: 'crown_missing_t', name: 'Crown Missing (test)', color: '#aa0000', isActive: true })
    chartSave(env.ctx, env.owner, { patientId, visitId, dentition: 'adult', entries: [{ tooth: 36, conditionId: custom.find((c) => c.code === 'crown_missing_t')!.id }] })
    const usedId = custom.find((c) => c.code === 'crown_missing_t')!.id
    expect(() => conditionDelete(env.ctx, env.owner, usedId)).toThrowError(/in use|used/i)
  })

  it('patient list is unaffected by chart data (regression guard)', () => {
    expect(patientList(env.ctx, env.owner, { preset: 'all', page: 1, pageSize: 50 }).total).toBeGreaterThanOrEqual(2)
  })
})
