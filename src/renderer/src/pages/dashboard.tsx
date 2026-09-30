import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarCheck, UserPlus, CheckCircle2, XCircle, AlertTriangle, Boxes, Wallet, ArrowRight } from 'lucide-react'
import { call } from '../ipc'
import { useApp, can } from '../store'
import { Loading, StatusBadge, money } from '../ui'
import { todayISO } from '@shared/dates'

export function DashboardPage(): React.ReactNode {
  const { clinic } = useApp()
  const [data, setData] = useState<Awaited<ReturnType<typeof call<'dashboard.get'>>> | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setData(null)
    void call('dashboard.get').then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load dashboard.'))
  }, [])

  if (error) return <div className="empty">{error}</div>
  if (!data) return <Loading />

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const userName = useApp.getState().session?.user.displayName.split(' ')[0]

  return (
    <div className="col" style={{ gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22, letterSpacing: -0.3 }}>
          {greeting}{userName ? `, ${userName}` : ''}
        </h1>
        <div className="text-soft">{clinic?.name ?? ''} · {todayISO()}</div>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="icon-wrap" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}><CalendarCheck size={17} /></div>
          <div className="stat-label">Appointments today</div>
          <div className="stat-value">{data.appointmentCountToday}</div>
        </div>
        <div className="stat">
          <div className="icon-wrap" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}><CheckCircle2 size={17} /></div>
          <div className="stat-label">Visits completed</div>
          <div className="stat-value">{data.completedVisitsToday}</div>
        </div>
        <div className="stat">
          <div className="icon-wrap" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}><XCircle size={17} /></div>
          <div className="stat-label">No-shows today</div>
          <div className="stat-value">{data.noShowsToday}</div>
        </div>
        <div className="stat">
          <div className="icon-wrap" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}><UserPlus size={17} /></div>
          <div className="stat-label">New patients today</div>
          <div className="stat-value">{data.newPatientsToday}</div>
        </div>
        {can('inventory.view') ? (
          <div className="stat">
            <div className="icon-wrap" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}><Boxes size={17} /></div>
            <div className="stat-label">Stock alerts</div>
            <div className="stat-value">{data.lowStockCount + data.outOfStockCount + data.expiringCount}</div>
            <div className="stat-foot">{data.lowStockCount} low · {data.outOfStockCount} out · {data.expiringCount} expiring</div>
          </div>
        ) : null}
        {data.financial ? (
          <>
            <div className="stat">
              <div className="icon-wrap" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}><Wallet size={17} /></div>
              <div className="stat-label">Collected today</div>
              <div className="stat-value">{money(data.financial.collectedToday)}</div>
            </div>
            <div className="stat">
              <div className="icon-wrap" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}><Wallet size={17} /></div>
              <div className="stat-label">Outstanding dues</div>
              <div className="stat-value">{money(data.financial.outstandingTotal)}</div>
            </div>
          </>
        ) : null}
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <div className="card-title">Today&apos;s appointments</div>
            {can('appointment.view') ? (
              <Link className="card-actions text-small" to="/appointments" style={{ color: 'var(--primary)', textDecoration: 'none' }}>
                View all <ArrowRight size={13} />
              </Link>
            ) : null}
          </div>
          {data.appointmentsToday.length === 0 ? (
            <div className="empty">No appointments scheduled for today.</div>
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr><th>Time</th><th>Patient</th><th>Dentist</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {data.appointmentsToday.map((a) => (
                    <tr key={a.id} className="clickable" onClick={() => { window.location.hash = `/patients/${a.patientId}` }}>
                      <td className="nowrap text-mono">{a.apptTime}</td>
                      <td><b>{a.patientName}</b> <span className="text-faint text-small">{a.patientCode}</span></td>
                      <td>{a.dentistName}</td>
                      <td><StatusBadge status={a.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="col" style={{ gap: 16 }}>
          {can('queue.view') ? (
            <div className="card">
              <div className="card-head">
                <div className="card-title">Waiting queue</div>
                <Link className="card-actions text-small" to="/queue" style={{ color: 'var(--primary)', textDecoration: 'none' }}>
                  Open queue <ArrowRight size={13} />
                </Link>
              </div>
              {data.waitingQueue.length === 0 ? (
                <div className="empty">The queue is empty.</div>
              ) : (
                <div style={{ padding: '6px 0' }}>
                  {data.waitingQueue.slice(0, 6).map((q) => (
                    <div key={q.id} className="row" style={{ padding: '8px 18px', borderBottom: '1px solid var(--border)' }}>
                      <b className="text-mono" style={{ width: 34 }}>#{q.tokenNo}</b>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{q.patientName}</div>
                        <div className="text-faint text-small">{q.dentistName}</div>
                      </div>
                      {q.priority === 'urgent' ? <span className="badge badge-red">urgent</span> : null}
                      <StatusBadge status={q.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {data.upcomingFollowUps.length > 0 ? (
            <div className="card">
              <div className="card-head"><div className="card-title">Upcoming follow-ups</div></div>
              <div style={{ padding: '6px 0' }}>
                {data.upcomingFollowUps.map((f) => (
                  <div key={f.visitId} className="row" style={{ padding: '8px 18px', borderBottom: '1px solid var(--border)' }}>
                    <AlertTriangle size={15} style={{ color: 'var(--warning)' }} />
                    <div style={{ flex: 1 }}>{f.patientName}</div>
                    <span className="text-mono text-soft">{f.followUpDate}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
