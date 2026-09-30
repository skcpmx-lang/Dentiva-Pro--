import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, CalendarClock, ListOrdered, Stethoscope, ClipboardList, FileText,
  ReceiptText, Boxes, Calculator, BarChart3, Bell, UserCog, ShieldCheck, ScrollText, Settings,
  Lock, LogOut, Search, Grid3x3
} from 'lucide-react'
import { useApp, can } from './store'
import { call } from './ipc'
import { Button, ToastStack, toast, Modal, Field } from './ui'
import { SetupPage, LoginPage, LockedPage } from './pages/auth'
import { DashboardPage } from './pages/dashboard'
import { PatientsPage, PatientDetailPage } from './pages/patients'
import { AppointmentsPage } from './pages/appointments'
import { QueuePage } from './pages/queue'
import { VisitsPage } from './pages/visits'
import { ChartPage } from './pages/chart'
import { PrescriptionsPage } from './pages/prescriptions'
import { BillingPage } from './pages/billing'
import { InventoryPage } from './pages/inventory'
import { AccountingPage } from './pages/accounting'
import { ReportsPage } from './pages/reports'
import { NotificationsPage } from './pages/notifications'
import { StaffPage } from './pages/staff'
import { AccessPage } from './pages/access'
import { AuditPage } from './pages/audit'
import { SettingsPage } from './pages/settings'

export function App(): React.ReactNode {
  const { phase, boot, session } = useApp()

  useEffect(() => {
    void boot()
    const off = window.dentiva.onEvent((event) => {
      if (event.type === 'locked') useApp.setState({ phase: 'locked' })
      if (event.type === 'restored') toast('Backup restored — data reloaded.', 'info')
    })
    return off
  }, [boot])

  if (phase === 'loading') {
    return <div className="center-screen"><div className="spinner" style={{ borderTopColor: '#7ee3c8' }} /></div>
  }
  if (phase === 'setup') return <><SetupPage /><ToastStack /></>
  if (phase === 'login') return <><LoginPage /><ToastStack /></>
  if (phase === 'locked') return <><LockedPage /><ToastStack /></>

  const name = session?.user.displayName ?? 'User'
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <HashRouter>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-head">
            <div className="sidebar-logo"><Stethoscope size={18} /></div>
            <div>
              <div className="sidebar-title">Dentiva Pro</div>
              <div className="sidebar-sub">{useApp.getState().clinic?.name ?? 'Dental Clinic'}</div>
            </div>
          </div>
          <nav className="nav">
            <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <LayoutDashboard className="icon" size={17} /> Dashboard
            </NavLink>
            {can('patient.view') ? (
              <NavLink to="/patients" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <Users className="icon" size={17} /> Patients
              </NavLink>
            ) : null}
            {can('appointment.view') ? (
              <NavLink to="/appointments" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <CalendarClock className="icon" size={17} /> Appointments
              </NavLink>
            ) : null}
            {can('queue.view') ? (
              <NavLink to="/queue" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <ListOrdered className="icon" size={17} /> Queue
              </NavLink>
            ) : null}
            {can('visit.view') ? (
              <NavLink to="/visits" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <ClipboardList className="icon" size={17} /> Visits
              </NavLink>
            ) : null}
            {can('chart.view') ? (
              <NavLink to="/chart" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <Grid3x3 className="icon" size={17} /> Dental Chart
              </NavLink>
            ) : null}
            {can('prescription.view') ? (
              <NavLink to="/prescriptions" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <FileText className="icon" size={17} /> Prescriptions
              </NavLink>
            ) : null}
            {can('invoice.view') ? (
              <NavLink to="/billing" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <ReceiptText className="icon" size={17} /> Billing
              </NavLink>
            ) : null}
            <div className="nav-label">Manage</div>
            {can('inventory.view') ? (
              <NavLink to="/inventory" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <Boxes className="icon" size={17} /> Inventory
              </NavLink>
            ) : null}
            {can('accounting.view') ? (
              <NavLink to="/accounting" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <Calculator className="icon" size={17} /> Accounting
              </NavLink>
            ) : null}
            {can('report.view') ? (
              <NavLink to="/reports" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <BarChart3 className="icon" size={17} /> Reports
              </NavLink>
            ) : null}
            {can('staff.view') ? (
              <NavLink to="/staff" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <Users className="icon" size={17} /> Staff
              </NavLink>
            ) : null}
            {can('user.view') ? (
              <NavLink to="/access" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <UserCog className="icon" size={17} /> Users &amp; Roles
              </NavLink>
            ) : null}
            {can('audit.view') ? (
              <NavLink to="/audit" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <ScrollText className="icon" size={17} /> Audit Log
              </NavLink>
            ) : null}
            {can('settings.view') ? (
              <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <Settings className="icon" size={17} /> Settings
              </NavLink>
            ) : null}
          </nav>
          <div className="sidebar-foot">
            <UserMenu initials={initials} name={name} role={session?.user.roleName ?? ''} />
          </div>
        </aside>
        <div className="main-area">
          <TopBar />
          <main className="page">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/patients" element={<PatientsPage />} />
              <Route path="/patients/:id" element={<PatientDetailPage />} />
              <Route path="/appointments" element={<AppointmentsPage />} />
              <Route path="/queue" element={<QueuePage />} />
              <Route path="/visits" element={<VisitsPage />} />
              <Route path="/chart" element={<ChartPage />} />
              <Route path="/prescriptions" element={<PrescriptionsPage />} />
              <Route path="/billing" element={<BillingPage />} />
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="/accounting" element={<AccountingPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/staff" element={<StaffPage />} />
              <Route path="/access" element={<AccessPage />} />
              <Route path="/audit" element={<AuditPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>
      <ToastStack />
    </HashRouter>
  )
}

function TopBar(): React.ReactNode {
  const { unread, refreshNotifications } = useApp()
  useEffect(() => {
    const t = setInterval(() => void refreshNotifications(), 60_000)
    return () => clearInterval(t)
  }, [refreshNotifications])
  return (
    <header className="topbar">
      <GlobalSearch />
      <div className="topbar-actions">
        <NavLink to="/notifications" style={{ position: 'relative', color: 'var(--text-soft)' }}>
          <Bell size={18} />
          {unread > 0 ? <span className="nav-badge" style={{ position: 'absolute', top: -5, right: -8 }}>{unread}</span> : null}
        </NavLink>
      </div>
    </header>
  )
}

function GlobalSearch(): React.ReactNode {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Awaited<ReturnType<typeof call<'search.global'>>> | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults(null)
      return
    }
    const t = setTimeout(() => {
      void call('search.global', { q: q.trim(), limit: 5 })
        .then((r) => {
          setResults(r)
          setOpen(true)
        })
        .catch(() => setResults(null))
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  return (
    <div style={{ position: 'relative', width: 380 }}>
      <div className="searchbar">
        <Search className="icon" size={16} />
        <input
          className="input" value={q} placeholder="Search patients, invoices, prescriptions…  (Ctrl+K)"
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            if (e.key === 'k' && e.ctrlKey) e.currentTarget.select()
          }}
        />
      </div>
      {open && results && results.length > 0 ? (
        <div className="card" style={{ position: 'absolute', top: 40, left: 0, right: 0, zIndex: 50, maxHeight: 420, overflowY: 'auto' } as React.CSSProperties}>
          {results.map((group) => (
            <div key={group.module}>
              <div className="nav-label" style={{ padding: '8px 14px 3px' }}>{group.label}</div>
              {group.items.map((item) => (
                <div
                  key={`${group.module}-${item.id}`} className="nav-item" style={{ color: 'var(--text)' }}
                  onClick={() => {
                    setOpen(false)
                    if (item.route) window.location.hash = item.route
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{item.title}</div>
                    {item.detail ? <div className="text-small text-faint">{item.detail}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function UserMenu({ initials, name, role }: { initials: string; name: string; role: string }): React.ReactNode {
  const { logout, lock } = useApp()
  const [open, setOpen] = useState(false)
  const [changeOpen, setChangeOpen] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <div className="user-chip" onClick={() => setOpen(!open)}>
        <div className="avatar">{initials}</div>
        <div style={{ minWidth: 0 }}>
          <div className="user-name">{name}</div>
          <div className="user-role">{role || 'Signed in'}</div>
        </div>
      </div>
      {open ? (
        <div className="card" style={{ position: 'absolute', bottom: 44, left: 0, right: 0, zIndex: 70, padding: 6 }}>
          <button className="nav-item" style={{ color: 'var(--text)' }} onClick={() => { setOpen(false); setChangeOpen(true) }}>
            <ShieldCheck size={15} /> Change password
          </button>
          <button className="nav-item" style={{ color: 'var(--text)' }} onClick={() => { setOpen(false); void lock() }}>
            <Lock size={15} /> Lock now
          </button>
          <button className="nav-item" style={{ color: 'var(--danger)' }} onClick={() => { setOpen(false); void logout() }}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
      ) : null}
      {changeOpen ? <ChangePasswordModal onClose={() => setChangeOpen(false)} /> : null}
    </div>
  )
}

function ChangePasswordModal({ onClose }: { onClose: () => void }): React.ReactNode {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <Modal
      title="Change password" onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={async () => {
            setBusy(true); setError('')
            try {
              await call('auth.changePassword', { currentPassword: current, newPassword: next })
              toast('Password updated.')
              onClose()
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Failed.')
            } finally { setBusy(false) }
          }}>Update</Button>
        </>
      }
    >
      <div className="col">
        <Field label="Current password" required>
          <input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
        </Field>
        <Field label="New password" required error={error || undefined} hint="At least 8 characters with a letter and a digit.">
          <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
