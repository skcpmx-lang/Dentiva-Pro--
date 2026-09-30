import type { Actor, AppContext } from '../core/context'

export interface AuditPayload {
  action: string
  entity: string
  entityId?: string | number | null
  oldValue?: unknown
  newValue?: unknown
  context?: string | null
}

/**
 * Writes an audit row. Runs inside the caller's transaction when one is open,
 * so business mutations and their audit trail commit or roll back atomically.
 */
export function audit(ctx: AppContext, actor: Actor | null, payload: AuditPayload): void {
  const serialize = (v: unknown): string | null => {
    if (v === undefined || v === null) return null
    try {
      return typeof v === 'string' ? v : JSON.stringify(v)
    } catch {
      return '[unserializable]'
    }
  }
  ctx.db
    .prepare(
      `INSERT INTO audit_log (user_id, username, action, entity, entity_id, old_value, new_value, context, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      actor?.userId ?? null,
      actor?.username ?? 'system',
      payload.action,
      payload.entity,
      payload.entityId != null ? String(payload.entityId) : null,
      serialize(payload.oldValue),
      serialize(payload.newValue),
      payload.context ?? null,
      new Date(ctx.clock().getTime()).toISOString()
    )
}
