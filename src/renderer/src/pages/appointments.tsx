import { useCallback, useEffect, useState } from 'react'
import { Plus, CalendarDays, ChevronLeft, ChevronRight, Ban } from 'lucide-react'
import { call } from '../ipc'
import { can, useApp } from '../store'
import { Button, ConfirmDialog, EmptyState, Field, Loading, Modal, StatusBadge, toast } from '../ui'
import { todayISO, formatDateHuman } from '@shared/dates'
import type { AppointmentRow } from '@shared/types'

const STATUSES = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show', 'rescheduled']

export function AppointmentsPage(): React.ReactNode {
  const { clinic } = useApp()
  const [date, setDate] = useState(todayISO())
  const [rows, setRows] = useState<AppointmentRow[] | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<AppointmentRow | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const dentists = useDentists()

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await call('appointment.list', { date, status: statusFilter || undefined, page: 1, pageSize: 200 })
      setRows(res.rows)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load appointments.', 'error')
      setRows([])
    }
  }, [date, statusFilter])

  useEffect(() => {
    void load()
  }, [load])

  const shiftDate = (days: number): void => {
    const d = new Date(date + 'T00:00:00')
    d.setDate(d.getDate() + days)
    setDate(d.toISOString().slice(0, 10))
  }

  const setStatus = async (appt: AppointmentRow, status: string): Promise<void> => {
    try {
      await call('appointment.setStatus', { id: appt.id, status })
      toast(`Appointment marked ${status.replace('_', ' ')}.`)
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed.', 'error')
    }
  }

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row">
        <Button onClick={() => shiftDate(-1)}><ChevronLeft size={15} /></Button>
        <input className="input" type="date" style={{ width: 160 }} value={date} onChange={(e) => setDate(e.target.value)} />
        <Button onClick={() => shiftDate(1)}><ChevronRight size={15} /></Button>
        <Button onClick={() => setDate(todayISO())}>Today</Button>
        <span style={{ fontWeight: 700 }}>{formatDateHuman(date)}</span>
        <div className="spacer" />
        <select className="select" style={{ width: 150 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        {can('appointment.create') ? (
          <Button variant="primary" onClick={() => setShowForm(true)}><Plus size={15} /> New appointment</Button>
        ) : null}
      </div>

      <div className="card">
        {!rows ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState title="No appointments for this day" hint="Create one or pick another date." />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Time</th><th>Patient</th><th>Dentist</th><th>Reason</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className="text-mono nowrap"><b>{a.apptTime}</b></td>
                    <td>
                      <a href={`#/patients/${a.patientId}`} style={{ color: 'inherit', textDecoration: 'none', fontWeight: 600 }}>{a.patientName}</a>
                      <div className="text-faint text-small">{a.patientCode}{a.patientPhone ? ` · ${a.patientPhone}` : ''}</div>
                    </td>
                    <td>{a.dentistName}</td>
                    <td className="text-soft" style={{ maxWidth: 260 }}>{a.reason ?? '—'}</td>
                    <td><StatusBadge status={a.status} /></td>
                    <td className="nowrap">
                      {can('appointment.edit') && a.status === 'scheduled' ? (
                        <Button size="sm" onClick={() => void setStatus(a, 'confirmed')}>Confirm</Button>
                      ) : null}
                      {can('appointment.edit') && !['completed', 'cancelled', 'no_show'].includes(a.status) ? (
                        <>
                          <Button size="sm" onClick={() => void setStatus(a, 'completed')}>Done</Button>
                          <Button size="sm" variant="ghost-danger" onClick={() => { setCancelTarget(a); setCancelReason('') }}><Ban size={13} /></Button>
                        </>
                      ) : null}
                      {can('appointment.edit') && a.status === 'scheduled' ? (
                        <Button size="sm" variant="ghost-danger" onClick={() => void setStatus(a, 'no_show')}>No-show</Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm ? (
        <AppointmentForm
          date={date}
          dentists={dentists}
          onClose={() => setShowForm(false)}
          onSaved={async () => { setShowForm(false); await load() }}
        />
      ) : null}
      {cancelTarget ? (
        <Modal
          title="Cancel appointment" onClose={() => setCancelTarget(null)}
          footer={
            <>
              <Button onClick={() => setCancelTarget(null)}>Keep appointment</Button>
              <Button
                variant="danger" disabled={!cancelReason.trim()}
                onClick={async () => {
                  await call('appointment.setStatus', { id: cancelTarget.id, status: 'cancelled', reason: cancelReason.trim() })
                  toast('Appointment cancelled.')
                  setCancelTarget(null)
                  await load()
                }}
              >
                Cancel appointment
              </Button>
            </>
          }
        >
          <Field label="Reason (required)" required>
            <textarea className="textarea" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. Patient requested to postpone" autoFocus />
          </Field>
        </Modal>
      ) : null}
      {void clinic}
    </div>
  )
}

function useDentists(): Awaited<ReturnType<typeof call<'dentist.list'>>> {
  const [dentists, setDentists] = useState<Awaited<ReturnType<typeof call<'dentist.list'>>>>([])
  useEffect(() => {
    void call('dentist.list', { activeOnly: true }).then(setDentists).catch(() => setDentists([]))
  }, [])
  return dentists
}

function AppointmentForm({ date, dentists, onClose, onSaved }: { date: string; dentists: Awaited<ReturnType<typeof call<'dentist.list'>>>; onClose: () => void; onSaved: () => Promise<void> }): React.ReactNode {
  const [patients, setPatients] = useState<{ id: number; patientCode: string; fullName: string }[]>([])
  const [patientSearch, setPatientSearch] = useState('')
  const [patientId, setPatientId] = useState<number | null>(null)
  const [dentistId, setDentistId] = useState<number | null>(dentists[0]?.id ?? null)
  const [apptDate, setApptDate] = useState(date)
  const [apptTime, setApptTime] = useState('10:00')
  const [duration, setDuration] = useState(30)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (patientSearch.trim().length < 2) return
    const t = setTimeout(() => {
      void call('patient.list', { preset: 'all', search: patientSearch.trim(), page: 1, pageSize: 8 })
        .then((r) => setPatients(r.rows))
        .catch(() => undefined)
    }, 250)
    return () => clearTimeout(t)
  }, [patientSearch])

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await call('appointment.create', {
        patientId: patientId ?? 0, dentistId: dentistId ?? 0, apptDate, apptTime, durationMinutes: duration, reason: reason.trim() || null
      })
      toast('Appointment created.')
      await onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="New appointment" onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!patientId || !dentistId} onClick={() => void submit()}>Create</Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Patient" required span>
          {patientId ? (
            <div className="row">
              <b>{patients.find((p) => p.id === patientId)?.fullName ?? `Patient #${patientId}`}</b>
              <Button size="sm" onClick={() => { setPatientId(null); setPatientSearch('') }}>Change</Button>
            </div>
          ) : (
            <>
              <input className="input" value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} placeholder="Search patient by name or phone…" autoFocus />
              {patients.length > 0 ? (
                <div className="mt-1 col" style={{ gap: 2 }}>
                  {patients.map((p) => (
                    <button key={p.id} className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }} onClick={() => setPatientId(p.id)}>
                      <b>{p.fullName}</b> <span className="text-faint">{p.patientCode}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </Field>
        <Field label="Dentist" required>
          <select className="select" value={dentistId ?? ''} onChange={(e) => setDentistId(Number(e.target.value))}>
            {dentists.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
          </select>
        </Field>
        <Field label="Duration (minutes)">
          <select className="select" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {[15, 20, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Date" required>
          <input className="input" type="date" value={apptDate} onChange={(e) => setApptDate(e.target.value)} />
        </Field>
        <Field label="Time" required>
          <input className="input" type="time" value={apptTime} onChange={(e) => setApptTime(e.target.value)} />
        </Field>
        <Field label="Reason" span>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. RCT sitting 2" />
        </Field>
        {error ? <div className="field-error span-2">{error}</div> : null}
      </div>
    </Modal>
  )
}

/* Keep the confirm dialog import used pattern for future delete flows */
export { ConfirmDialog, CalendarDays }
