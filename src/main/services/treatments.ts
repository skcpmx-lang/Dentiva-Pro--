import { z } from 'zod'
import type { AppContext, Actor } from '../core/context'
import { errValidation, errNotFound, errConflict } from '@shared/errors'
import type { TreatmentInput } from '@shared/ipc'
import type { Treatment, Paginated } from '@shared/types'
import { audit } from './audit'

const schema = z.object({
  id: z.number().int().positive().optional(),
  code: z.string().trim().max(20).nullable().optional(),
  name: z.string().trim().min(2).max(160),
  category: z.string().trim().max(60).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  defaultPrice: z.number().int().min(0),
  durationMinutes: z.number().int().min(0).max(600).nullable().optional(),
  isActive: z.boolean().optional()
})

function mapRow(r: Record<string, unknown>): Treatment {
  return {
    id: r.id as number,
    code: (r.code as string | null) ?? null,
    name: r.name as string,
    category: (r.category as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    defaultPrice: r.default_price as number,
    durationMinutes: (r.duration_minutes as number | null) ?? null,
    isActive: r.is_active === 1
  }
}

export function treatmentList(ctx: AppContext, opts: { search?: string; activeOnly?: boolean; page?: number; pageSize?: number }): Paginated<Treatment> {
  const page = Math.max(1, opts.page ?? 1)
  const pageSize = Math.min(200, Math.max(5, opts.pageSize ?? 50))
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (opts.activeOnly) where.push('is_active = 1')
  if (opts.search) {
    const s = opts.search.replace(/[\\%_]/g, (c) => `\\${c}`)
    where.push('(name LIKE $q ESCAPE "\\" OR code LIKE $q ESCAPE "\\" OR category LIKE $q ESCAPE "\\")')
    params.$q = `%${s}%`
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = (ctx.db.prepare(`SELECT COUNT(*) AS c FROM treatments ${whereSql}`).get(params) as { c: number }).c
  const rows = ctx.db.prepare(`SELECT * FROM treatments ${whereSql} ORDER BY name COLLATE NOCASE LIMIT $limit OFFSET $offset`)
    .all({ ...params, $limit: pageSize, $offset: (page - 1) * pageSize }) as Record<string, unknown>[]
  return { rows: rows.map(mapRow), total, page, pageSize }
}

export function treatmentSave(ctx: AppContext, actor: Actor, input: TreatmentInput): Treatment {
  const res = schema.safeParse(input)
  if (!res.success) throw errValidation(Object.values(res.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid treatment.')
  const d = res.data
  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction((): number => {
    let id = d.id
    if (d.code) {
      const dup = ctx.db.prepare('SELECT id FROM treatments WHERE code = ? AND id != ?').get(d.code, id ?? -1)
      if (dup) throw errConflict(`Treatment code "${d.code}" is already in use.`)
    }
    if (id) {
      const existing = ctx.db.prepare('SELECT * FROM treatments WHERE id = ?').get(id)
      if (!existing) throw errNotFound('Treatment not found.')
      ctx.db.prepare(
        'UPDATE treatments SET code = ?, name = ?, category = ?, description = ?, default_price = ?, duration_minutes = ?, is_active = ?, updated_at = ? WHERE id = ?'
      ).run(d.code ?? null, d.name, d.category ?? null, d.description ?? null, d.defaultPrice, d.durationMinutes ?? null, d.isActive === false ? 0 : 1, ts, id)
      audit(ctx, actor, { action: 'update', entity: 'treatment', entityId: id, oldValue: existing, newValue: d })
    } else {
      const r = ctx.db.prepare(
        'INSERT INTO treatments (code, name, category, description, default_price, duration_minutes, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(d.code ?? null, d.name, d.category ?? null, d.description ?? null, d.defaultPrice, d.durationMinutes ?? null, d.isActive === false ? 0 : 1, ts, ts)
      id = Number(r.lastInsertRowid)
      audit(ctx, actor, { action: 'create', entity: 'treatment', entityId: id, newValue: d })
    }
    return id!
  })
  return mapRow(ctx.db.prepare('SELECT * FROM treatments WHERE id = ?').get(run()) as Record<string, unknown>)
}

export function treatmentDelete(ctx: AppContext, actor: Actor, id: number): void {
  const existing = ctx.db.prepare('SELECT * FROM treatments WHERE id = ?').get(id)
  if (!existing) throw errNotFound('Treatment not found.')
  const usedVisits = ctx.db.prepare('SELECT COUNT(*) AS c FROM visit_treatments WHERE treatment_id = ?').get(id) as { c: number }
  const usedInvoices = ctx.db.prepare('SELECT COUNT(*) AS c FROM invoice_lines WHERE treatment_id = ?').get(id) as { c: number }
  if (usedVisits.c > 0 || usedInvoices.c > 0) {
    throw errConflict('This treatment is used in visit or invoice history. Deactivate it instead of deleting — historical records must keep their references.')
  }
  const run = ctx.db.transaction(() => {
    ctx.db.prepare('DELETE FROM treatments WHERE id = ?').run(id)
    audit(ctx, actor, { action: 'delete', entity: 'treatment', entityId: id, oldValue: existing })
  })
  run()
}
