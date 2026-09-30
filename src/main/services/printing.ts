import { z } from 'zod'
import type { AppContext, Actor } from '../core/context'
import { errValidation, errNotFound } from '@shared/errors'
import type { PrinterProfile } from '@shared/types'
import { audit } from './audit'

function mapRow(r: Record<string, unknown>): PrinterProfile {
  return {
    id: r.id as number,
    name: r.name as string,
    deviceName: (r.device_name as string | null) ?? null,
    paper: r.paper as PrinterProfile['paper'],
    widthMm: (r.width_mm as number | null) ?? null,
    heightMm: (r.height_mm as number | null) ?? null,
    marginMm: r.margin_mm as number,
    scale: r.scale as number,
    useFor: r.use_for as PrinterProfile['useFor'],
    isDefault: r.is_default === 1
  }
}

export function printerProfileList(ctx: AppContext): PrinterProfile[] {
  return (ctx.db.prepare('SELECT * FROM printer_profiles ORDER BY name').all() as Record<string, unknown>[]).map(mapRow)
}

const profileSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(80),
  deviceName: z.string().trim().max(200).nullable().optional(),
  paper: z.enum(['a4', 'a5', 'letter', 'thermal80', 'thermal58', 'custom']),
  widthMm: z.number().min(30).max(350).nullable().optional(),
  heightMm: z.number().min(30).max(350).nullable().optional(),
  marginMm: z.number().min(0).max(40),
  scale: z.number().min(50).max(150),
  useFor: z.enum(['prescription', 'invoice', 'receipt', 'report', 'any']),
  isDefault: z.boolean()
})

export function printerProfileSave(ctx: AppContext, actor: Actor, input: Record<string, unknown>): PrinterProfile[] {
  const res = profileSchema.safeParse(input)
  if (!res.success) throw errValidation(Object.values(res.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid printer profile.')
  const d = res.data
  if (d.paper === 'custom' && (!d.widthMm || !d.heightMm)) throw errValidation('Custom paper needs a width and height in millimetres.')
  const run = ctx.db.transaction(() => {
    if (d.isDefault && d.useFor !== 'any') {
      ctx.db.prepare('UPDATE printer_profiles SET is_default = 0 WHERE use_for = ?').run(d.useFor)
    } else if (d.isDefault) {
      ctx.db.prepare('UPDATE printer_profiles SET is_default = 0 WHERE use_for = ?').run('any')
    }
    if (d.id) {
      if (!ctx.db.prepare('SELECT id FROM printer_profiles WHERE id = ?').get(d.id)) throw errNotFound('Printer profile not found.')
      ctx.db.prepare(`
        UPDATE printer_profiles SET name = ?, device_name = ?, paper = ?, width_mm = ?, height_mm = ?, margin_mm = ?,
        scale = ?, use_for = ?, is_default = ? WHERE id = ?
      `).run(d.name, d.deviceName ?? null, d.paper, d.widthMm ?? null, d.heightMm ?? null, d.marginMm, d.scale, d.useFor, d.isDefault ? 1 : 0, d.id)
      audit(ctx, actor, { action: 'update', entity: 'printer_profile', entityId: d.id, newValue: d })
    } else {
      ctx.db.prepare(`
        INSERT INTO printer_profiles (name, device_name, paper, width_mm, height_mm, margin_mm, scale, use_for, is_default, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(d.name, d.deviceName ?? null, d.paper, d.widthMm ?? null, d.heightMm ?? null, d.marginMm, d.scale, d.useFor, d.isDefault ? 1 : 0, new Date(ctx.clock().getTime()).toISOString())
      audit(ctx, actor, { action: 'create', entity: 'printer_profile', newValue: d })
    }
  })
  run()
  return printerProfileList(ctx)
}

export function printerProfileDelete(ctx: AppContext, actor: Actor, id: number): PrinterProfile[] {
  if (!ctx.db.prepare('SELECT id FROM printer_profiles WHERE id = ?').get(id)) throw errNotFound('Printer profile not found.')
  const run = ctx.db.transaction(() => {
    ctx.db.prepare('DELETE FROM printer_profiles WHERE id = ?').run(id)
    audit(ctx, actor, { action: 'delete', entity: 'printer_profile', entityId: id })
  })
  run()
  return printerProfileList(ctx)
}
