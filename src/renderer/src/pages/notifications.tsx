import { useCallback, useEffect, useState } from 'react'
import { CheckCheck } from 'lucide-react'
import { call } from '../ipc'
import { useApp } from '../store'
import { Button, EmptyState, Loading } from '../ui'
import { formatDateTimeHuman } from '@shared/dates'

export function NotificationsPage(): React.ReactNode {
  const { notifications, refreshNotifications, markAllRead, unread } = useApp()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      await refreshNotifications()
    } finally {
      setLoading(false)
    }
  }, [refreshNotifications])

  useEffect(() => {
    void load()
  }, [load])

  const list = unreadOnly ? notifications.filter((n) => !n.isRead) : notifications

  return (
    <div className="col narrow" style={{ gap: 14 }}>
      <div className="row">
        <h1 style={{ margin: 0, fontSize: 18 }}>Notifications</h1>
        {unread > 0 ? <span className="badge badge-red">{unread} unread</span> : null}
        <div className="spacer" />
        <label className="row text-small" style={{ gap: 5 }}>
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread only
        </label>
        {unread > 0 ? <Button size="sm" onClick={() => void markAllRead()}><CheckCheck size={14} /> Mark all read</Button> : null}
      </div>

      <div className="card">
        {loading && notifications.length === 0 ? (
          <Loading />
        ) : list.length === 0 ? (
          <EmptyState title="No notifications" hint="Daily summaries, stock alerts and backup reminders appear here." />
        ) : (
          list.map((n) => (
            <div
              key={n.id}
              className={`notification-item ${!n.isRead ? 'unread' : ''}`}
              style={{ cursor: n.route ? 'pointer' : 'default' }}
              onClick={async () => {
                if (!n.isRead) {
                  await call('notification.markRead', { ids: [n.id] }).catch(() => undefined)
                  await refreshNotifications()
                }
                if (n.route) window.location.hash = n.route
              }}
            >
              <span
                className="notif-dot"
                style={{ background: n.severity === 'error' ? 'var(--danger)' : n.severity === 'warning' ? 'var(--warning)' : n.severity === 'success' ? 'var(--success)' : 'var(--info)' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: !n.isRead ? 700 : 600 }}>{n.title}</div>
                <div className="text-soft text-small">{n.body}</div>
                <div className="text-faint text-small mt-1">{formatDateTimeHuman(n.createdAt)}</div>
              </div>
              <span className={`badge ${n.audience === 'all' ? 'badge-gray' : n.audience === 'financial' ? 'badge-green' : n.audience === 'inventory' ? 'badge-amber' : 'badge-blue'}`}>
                {n.audience}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
