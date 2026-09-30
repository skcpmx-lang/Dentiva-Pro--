import { z } from 'zod'
import type { AppContext, Actor } from '../core/context'
import { errValidation, errNotFound } from '@shared/errors'
import type { ChartSavePayload } from '@shared/ipc'
import type { ChartEntry, ToothState, ToothCondition } from '@shared/types'
import { ADULT_TEETH, PEDIATRIC_TEETH, type Dentition } from '@shared/enums'
import { audit } from './audit'

export function toothConditions(ctx: AppContext): ToothCondition[] {
  const rows = ctx.db.prepare('SELECT * FROM tooth_conditions ORDER BY sort_order, name').all() as Array<{
    id: number; code: string; name: string; color: string; is_system: number; is_active: number; sort_order: number
  }>
  // Map to the camelCase ToothCondition contract — the chart UI filters on
  // isActive, so a raw snake_case row would hide every condition.
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    color: r.color,
    isSystem: r.is_system === 1,
    isActive: r.is_active === 1,
    sortOrder: r.sort_order
  }))
}

const conditionSchema = z.object({
  id: z.number().int().positive().optional(),
  code: z.string().trim().regex(/^[a-z0-9_]+$/, 'Code must be lowercase letters, numbers and underscores.').max(30),
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  isActive: z.boolean()
})

export function conditionSave(ctx: AppContext, actor: Actor, input: Record<string, unknown>): ToothCondition[] {
  const res = conditionSchema.safeParse(input)
  if (!res.success) throw errValidation(Object.values(res.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid condition.')
  const d = res.data
  const run = ctx.db.transaction(() => {
    if (d.id) {
      const existing = ctx.db.prepare('SELECT * FROM tooth_conditions WHERE id = ?').get(d.id)
      if (!existing) throw errNotFound('Condition not found.')
      ctx.db.prepare('UPDATE tooth_conditions SET code = ?, name = ?, color = ?, is_active = ? WHERE id = ?')
        .run(d.code, d.name, d.color, d.isActive ? 1 : 0, d.id)
      audit(ctx, actor, { action: 'update', entity: 'tooth_condition', entityId: d.id, oldValue: existing, newValue: d })
    } else {
      const dup = ctx.db.prepare('SELECT id FROM tooth_conditions WHERE code = ?').get(d.code)
      if (dup) throw errValidation('A condition with this code already exists.')
      const maxSort = ctx.db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM tooth_conditions').get() as { m: number }
      ctx.db.prepare('INSERT INTO tooth_conditions (code, name, color, is_system, is_active, sort_order) VALUES (?, ?, ?, 0, ?, ?)')
        .run(d.code, d.name, d.color, d.isActive ? 1 : 0, maxSort.m + 1)
      audit(ctx, actor, { action: 'create', entity: 'tooth_condition', newValue: d })
    }
  })
  run()
  return toothConditions(ctx)
}

export function conditionDelete(ctx: AppContext, actor: Actor, id: number): ToothCondition[] {
  const existing = ctx.db.prepare('SELECT * FROM tooth_conditions WHERE id = ?').get(id) as (ToothCondition & { is_system: number }) | undefined
  if (!existing) throw errNotFound('Condition not found.')
  if (existing.is_system) throw errValidation('System conditions cannot be deleted. Deactivate them instead.')
  const used = ctx.db.prepare('SELECT COUNT(*) AS c FROM chart_entries WHERE condition_id = ?').get(id) as { c: number }
  if (used.c > 0) throw errValidation('This condition is used in patient charts and cannot be deleted. Deactivate it instead.')
  const run = ctx.db.transaction(() => {
    ctx.db.prepare('DELETE FROM tooth_conditions WHERE id = ?').run(id)
    audit(ctx, actor, { action: 'delete', entity: 'tooth_condition', entityId: id, oldValue: existing })
  })
  run()
  return toothConditions(ctx)
}

function validTeeth(dentition: Dentition): number[] {
  return dentition === 'adult' ? ADULT_TEETH : PEDIATRIC_TEETH
}

export function chartState(ctx: AppContext, patientId: number, dentition: Dentition): { states: ToothState[]; history: ChartEntry[] } {
  const patient = ctx.db.prepare('SELECT id FROM patients WHERE id = ?').get(patientId)
  if (!patient) throw errNotFound('Patient not found.')
  const teeth = validTeeth(dentition)
  const states: ToothState[] = teeth.map((tooth) => ({ tooth, conditionId: null, conditionName: null, conditionColor: null, note: null, lastRecordedAt: null }))
  const rows = ctx.db.prepare(`
    SELECT ce.*, tc.name AS conditionName, tc.color AS conditionColor, u.display_name AS recordedBy
    FROM chart_entries ce
    JOIN tooth_conditions tc ON tc.id = ce.condition_id
    LEFT JOIN users u ON u.id = ce.recorded_by
    WHERE ce.patient_id = ? AND ce.dentition = ?
    ORDER BY ce.recorded_at DESC, ce.id DESC
  `).all(patientId, dentition) as Record<string, unknown>[]
  const map = new Map<number, ToothState>()
  for (const s of states) map.set(s.tooth, s)
  const history: ChartEntry[] = []
  for (const r of rows) {
    const entry = mapEntry(r)
    history.push(entry)
    const st = map.get(entry.tooth)
    if (st && st.conditionId === null) {
      st.conditionId = entry.conditionId
      st.conditionName = entry.conditionName
      st.conditionColor = entry.conditionColor
      st.note = entry.note
      st.lastRecordedAt = entry.recordedAt
    }
  }
  return { states, history: history.slice(0, 100) }
}

function mapEntry(r: Record<string, unknown>): ChartEntry {
  return {
    id: r.id as number,
    patientId: r.patient_id as number,
    visitId: (r.visit_id as number | null) ?? null,
    dentition: r.dentition as Dentition,
    tooth: r.tooth as number,
    conditionId: r.condition_id as number,
    conditionName: r.conditionName as string,
    conditionColor: r.conditionColor as string,
    note: (r.note as string | null) ?? null,
    recordedBy: (r.recordedBy as string | null) ?? '—',
    recordedAt: r.recorded_at as string
  }
}

const saveSchema = z.object({
  patientId: z.number().int().positive(),
  visitId: z.number().int().positive().nullable().optional(),
  dentition: z.enum(['adult', 'pediatric']),
  entries: z.array(z.object({
    tooth: z.number().int().positive(),
    conditionId: z.number().int().positive(),
    note: z.string().max(500).nullable().optional()
  })).min(1, 'Select at least one tooth condition to record.').max(32)
})

export function chartSave(ctx: AppContext, actor: Actor, payload: ChartSavePayload): void {
  const res = saveSchema.safeParse(payload)
  if (!res.success) throw errValidation(Object.values(res.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid chart data.')
  const d = res.data
  if (!ctx.db.prepare('SELECT id FROM patients WHERE id = ?').get(d.patientId)) throw errNotFound('Patient not found.')
  const teeth = new Set(validTeeth(d.dentition))
  for (const e of d.entries) {
    if (!teeth.has(e.tooth)) throw errValidation(`Tooth ${e.tooth} is not a valid ${d.dentition} FDI tooth number.`)
    if (!ctx.db.prepare('SELECT id FROM tooth_conditions WHERE id = ?').get(e.conditionId)) throw errNotFound('Condition not found.')
  }
  if (d.visitId && !ctx.db.prepare('SELECT id FROM visits WHERE id = ? AND patient_id = ?').get(d.visitId, d.patientId)) {
    throw errValidation('The linked visit does not belong to this patient.')
  }
  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction(() => {
    const ins = ctx.db.prepare(
      'INSERT INTO chart_entries (patient_id, visit_id, dentition, tooth, condition_id, note, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    for (const e of d.entries) ins.run(d.patientId, d.visitId ?? null, d.dentition, e.tooth, e.conditionId, e.note ?? null, actor.userId, ts)
    audit(ctx, actor, {
      action: 'create', entity: 'chart_entry', entityId: d.patientId,
      newValue: { dentition: d.dentition, teeth: d.entries.map((e) => e.tooth), visitId: d.visitId ?? null }
    })
  })
  run()
}

export function toothHistory(ctx: AppContext, patientId: number, dentition: Dentition, tooth: number): ChartEntry[] {
  const rows = ctx.db.prepare(`
    SELECT ce.*, tc.name AS conditionName, tc.color AS conditionColor, u.display_name AS recordedBy
    FROM chart_entries ce
    JOIN tooth_conditions tc ON tc.id = ce.condition_id
    LEFT JOIN users u ON u.id = ce.recorded_by
    WHERE ce.patient_id = ? AND ce.dentition = ? AND ce.tooth = ?
    ORDER BY ce.recorded_at DESC, ce.id DESC
  `).all(patientId, dentition, tooth) as Record<string, unknown>[]
  return rows.map(mapEntry)
}
