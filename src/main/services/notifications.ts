import type { AppContext, Actor } from '../core/context'
import type { NotificationItem, NotificationAudience, NotificationSeverity } from '@shared/types'
import { actorCan } from '../core/context'

export function notify(
  ctx: AppContext,
  item: {
    type: string
    severity: NotificationSeverity
    audience: NotificationAudience
    title: string
    body: string
    route?: string | null
  }
): void {
  ctx.db.prepare(`
    INSERT INTO notifications (type, severity, title, body, route, audience, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `).run(item.type, item.severity, item.title, item.body, item.route ?? null, item.audience, new Date(ctx.clock().getTime()).toISOString())
  // Keep the notification center lean: cap unread rows per type+audience.
  ctx.db.prepare(`
    DELETE FROM notifications WHERE is_read = 1 AND id NOT IN (
      SELECT id FROM notifications WHERE is_read = 1 ORDER BY created_at DESC LIMIT 500
    )
  `).run()
}

function audienceVisible(actor: Actor, audience: NotificationAudience): boolean {
  if (audience === 'all') return true
  if (audience === 'financial') return actorCan(actor, 'financial.view')
  if (audience === 'inventory') return actorCan(actor, 'inventory.view')
  if (audience === 'admin') return actorCan(actor, 'backup.view') || actorCan(actor, 'user.view')
  return false
}

function mapRow(r: Record<string, unknown>): NotificationItem {
  return {
    id: r.id as number,
    type: r.type as string,
    severity: r.severity as NotificationSeverity,
    title: r.title as string,
    body: r.body as string,
    route: (r.route as string | null) ?? null,
    audience: r.audience as NotificationAudience,
    isRead: r.is_read === 1,
    createdAt: r.created_at as string
  }
}

export function notificationList(ctx: AppContext, actor: Actor, opts: { unreadOnly?: boolean; limit?: number }): NotificationItem[] {
  const rows = (
    opts.unreadOnly
      ? ctx.db.prepare('SELECT * FROM notifications WHERE is_read = 0 ORDER BY created_at DESC LIMIT ?').all(opts.limit ?? 100)
      : ctx.db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?').all(opts.limit ?? 100)
  ) as Record<string, unknown>[]
  return rows.map(mapRow).filter((n) => audienceVisible(actor, n.audience))
}

export function notificationUnreadCount(ctx: AppContext, actor: Actor): number {
  return notificationList(ctx, actor, { unreadOnly: true, limit: 1000 }).length
}

export function notificationMarkRead(ctx: AppContext, actor: Actor, ids?: number[]): void {
  if (ids && ids.length > 0) {
    const stmt = ctx.db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?')
    for (const id of ids) stmt.run(id)
  } else {
    ctx.db.prepare('UPDATE notifications SET is_read = 1').run()
  }
  void actor
}

/** Startup sweep: generate practical, non-spammy notifications (spec §56). */
export function generateStartupNotifications(ctx: AppContext): void {
  const settings = ctx.db.prepare("SELECT value FROM settings WHERE key = 'settings'").get() as { value: string } | undefined
  const prefs = settings ? JSON.parse(settings.value) : null
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(ctx.clock())

  if (prefs?.notifications?.appointments !== false) {
    const count = (ctx.db.prepare(
      "SELECT COUNT(*) AS c FROM appointments WHERE appt_date = ? AND status NOT IN ('cancelled','no_show','rescheduled','completed')"
    ).get(today) as { c: number }).c
    if (count > 0) {
      const existing = ctx.db.prepare(
        "SELECT id FROM notifications WHERE type = 'appointments_today' AND created_at >= ? LIMIT 1"
      ).get(`${today}T00:00:00`) as { id: number } | undefined
      if (!existing) {
        notify(ctx, {
          type: 'appointments_today', severity: 'info', audience: 'all',
          title: `${count} appointment${count > 1 ? 's' : ''} today`,
          body: 'Check the Appointments screen for today\u2019s schedule.', route: '/appointments'
        })
      }
    }
  }

  if (prefs?.notifications?.lowStock !== false) {
    const low = ctx.db.prepare(`
      SELECT COUNT(*) AS c FROM inventory_items i WHERE i.is_active = 1 AND (
        SELECT COALESCE(SUM(qty_current),0) FROM inventory_batches b WHERE b.item_id = i.id AND b.status = 'active'
      ) <= i.reorder_threshold
    `).get() as { c: number }
    if (low.c > 0) {
      const existing = ctx.db.prepare(
        "SELECT id FROM notifications WHERE type = 'low_stock' AND created_at >= ? LIMIT 1"
      ).get(`${today}T00:00:00`) as { id: number } | undefined
      if (!existing) {
        notify(ctx, {
          type: 'low_stock', severity: 'warning', audience: 'inventory',
          title: `${low.c} item${low.c > 1 ? 's' : ''} at or below reorder level`,
          body: 'Review inventory and reorder as needed.', route: '/inventory'
        })
      }
    }
    const expDays = prefs?.notifications?.expiryDays ?? 30
    const expiring = ctx.db.prepare(`
      SELECT COUNT(*) AS c FROM inventory_batches b
      WHERE b.status = 'active' AND b.qty_current > 0 AND b.expiry_date IS NOT NULL
        AND b.expiry_date <= date('now', '+' || ? || ' days')
    `).get(expDays) as { c: number }
    if (expiring.c > 0) {
      const existing = ctx.db.prepare(
        "SELECT id FROM notifications WHERE type = 'expiry' AND created_at >= ? LIMIT 1"
      ).get(`${today}T00:00:00`) as { id: number } | undefined
      if (!existing) {
        notify(ctx, {
          type: 'expiry', severity: 'warning', audience: 'inventory',
          title: `${expiring.c} batch${expiring.c > 1 ? 'es' : ''} expiring soon`,
          body: `Stock expiring within ${expDays} days needs attention.`, route: '/inventory'
        })
      }
    }
  }
}
