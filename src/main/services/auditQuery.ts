import type { AppContext, Actor } from '../core/context'
import type { AuditEntry } from '@shared/types'
import { resolveRange } from '@shared/dates'
import { audit } from './audit'

export function auditList(
  ctx: AppContext,
  _actor: Actor,
  query: { preset?: string; from?: string; to?: string; userId?: number; entity?: string; action?: string; search?: string; page: number; pageSize: number }
): { rows: AuditEntry[]; total: number; page: number; pageSize: number } {
  const page = Math.max(1, query.page | 0 || 1)
  const pageSize = Math.min(200, Math.max(5, query.pageSize | 0 || 25))
  const db = ctx.db
  const where: string[] = []
  const params: Record<string, unknown> = {}
  const range = query.preset === 'all' ? null : resolveRange((query.preset || '30d') as '30d', { from: query.from, to: query.to })
  if (range) {
    where.push('created_at >= $fromIso AND created_at <= $toIso')
    params.$fromIso = `${range.from}T00:00:00.000Z`
    params.$toIso = `${range.to}T23:59:59.999Z`
  }
  if (query.userId) { where.push('user_id = $user'); params.$user = query.userId }
  if (query.entity) { where.push('entity = $entity'); params.$entity = query.entity }
  if (query.action) { where.push('action = $action'); params.$action = query.action }
  if (query.search) {
    const s = query.search.replace(/[\\%_]/g, (c) => `\\${c}`)
    where.push('(username LIKE $q ESCAPE "\\" OR entity LIKE $q ESCAPE "\\" OR context LIKE $q ESCAPE "\\" OR entity_id LIKE $q ESCAPE "\\")')
    params.$q = `%${s}%`
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM audit_log ${whereSql}`).get(params) as { c: number }).c
  const rows = db.prepare(`SELECT * FROM audit_log ${whereSql} ORDER BY created_at DESC, id DESC LIMIT $limit OFFSET $offset`)
    .all({ ...params, $limit: pageSize, $offset: (page - 1) * pageSize }) as Record<string, unknown>[]
  return {
    rows: rows.map((r) => ({
      id: r.id as number,
      userId: (r.user_id as number | null) ?? null,
      username: r.username as string,
      action: r.action as string,
      entity: r.entity as string,
      entityId: (r.entity_id as string | null) ?? null,
      oldValue: r.old_value ? safeJson(r.old_value as string) : null,
      newValue: r.new_value ? safeJson(r.new_value as string) : null,
      context: (r.context as string | null) ?? null,
      createdAt: r.created_at as string
    })),
    total, page, pageSize
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

export { audit }
