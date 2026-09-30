import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Megaphone, ArrowRightLeft, Trash2 } from 'lucide-react'
import { call } from '../ipc'
import { can } from '../store'
import { Button, ConfirmDialog, EmptyState, Field, Loading, Modal, StatusBadge, toast } from '../ui'
import { todayISO, formatTimeHuman } from '@shared/dates'

const NEXT: Record<string, string[]> = {
  waiting: ['called', 'cancelled'],
  called: ['in_treatment', 'waiting', 'cancelled'],
  in_treatment: ['billing', 'called'],
  billing: ['finished', 'in_treatment'],
  finished: [],
  cancelled: []
}

const ACTION_LABEL: Record<string, string> = {
  called: 'Call patient', in_treatment: 'Start treatment', billing: 'Move to billing',
  finished: 'Finish', waiting: 'Back to waiting', cancelled: 'Remove'
}

export function QueuePage(): React.ReactNode {
  const [date, setDate] = useState(todayISO())
  const [rows, setRows] = useState<Awaited<ReturnType<typeof call<'queue.list'>>> | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<number | null>(null)
  const autoRef = useRef(true)

  const load = useCallback(async (): Promise<void> => {
    try {
      setRows(await call('queue.list', { date }))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load the queue.', 'error')
      setRows([])
    }
  }, [date])

  useEffect(() => {
    void load()
    const t = setInterval(() => {
      if (autoRef.current && document.visibilityState === 'visible') void load()
    }, 15000)
    return () => clearInterval(t)
  }, [load])

  const move = async (id: number, status: string): Promise<void> => {
    try {
      await call('queue.setStatus', { id, status })
      if (status === 'called') toast('Patient called.')
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed.', 'error')
    }
  }

  const active = rows?.filter((q) => !['finished', 'cancelled'].includes(q.status)) ?? []
  const finished = rows?.filter((q) => q.status === 'finished') ?? []

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row">
        <h1 style={{ margin: 0, fontSize: 19 }}>Daily queue · {date === todayISO() ? 'today' : date}</h1>
        <div className="spacer" />
        <input className="input" type="date" style={{ width: 155 }} value={date} onChange={(e) => setDate(e.target.value)} />
        {can('queue.manage') ? (
          <Button variant="primary" onClick={() => setShowAdd(true)}><Plus size={15} /> Add to queue</Button>
        ) : null}
      </div>

      {!rows ? (
        <Loading />
      ) : (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head">
              <div className="card-title">Now in clinic ({active.length})</div>
              <div className="card-actions text-small text-faint">Waiting time = since arrival</div>
            </div>
            {active.length === 0 ? (
              <EmptyState title="Nobody in the queue" hint="Add arriving patients to hand out token numbers." />
            ) : (
              <div>
                {active.map((q) => (
                  <div key={q.id} className="row" style={{ padding: '11px 18px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                    <div style={{ width: 46, textAlign: 'center' }}>
                      <div className="text-faint text-small">token</div>
                      <div style={{ fontSize: 19, fontWeight: 800, color: q.priority === 'urgent' ? 'var(--danger)' : undefined }}>#{q.tokenNo}</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 150 }}>
                      <a href={`#/patients/${q.patientId}`} style={{ fontWeight: 700, color: 'inherit', textDecoration: 'none' }}>{q.patientName}</a>
                      <div className="text-faint text-small">{q.dentistName}{q.appointmentId ? ' · from appointment' : ''}</div>
                    </div>
                    {q.priority === 'urgent' ? <span className="badge badge-red">URGENT</span> : null}
                    <div className="col" style={{ gap: 2, minWidth: 90 }}>
                      <StatusBadge status={q.status} />
                      <span className="text-small text-faint">
                        {['finished', 'cancelled'].includes(q.status) ? '' : `waiting ${q.waitingMinutes} min`}
                      </span>
                    </div>
                    {can('queue.manage') ? (
                      <div className="row" style={{ gap: 5 }}>
                        {(NEXT[q.status] ?? []).map((next) => (
                          <Button
                            key={next} size="sm"
                            variant={next === 'cancelled' ? 'ghost-danger' : next === 'finished' ? 'primary' : 'ghost'}
                            onClick={() => void move(q.id, next)}
                          >
                            {next === 'called' ? <Megaphone size={13} /> : null}
                            {ACTION_LABEL[next]}
                          </Button>
                        ))}
                        <Button size="sm" variant="ghost-danger" onClick={() => setRemoveTarget(q.id)}><Trash2 size={13} /></Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head"><div className="card-title">Completed today ({finished.length})</div></div>
            {finished.length === 0 ? (
              <EmptyState title="No finished visits yet" />
            ) : (
              <div>
                {finished.map((q) => (
                  <div key={q.id} className="row" style={{ padding: '9px 18px', borderBottom: '1px solid var(--border)' }}>
                    <b className="text-mono" style={{ width: 40 }}>#{q.tokenNo}</b>
                    <div style={{ flex: 1 }}>{q.patientName}</div>
                    <span className="text-faint text-small">
                      {q.finishedAt ? formatTimeHuman(q.finishedAt) : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showAdd ? <QueueAddForm onClose={() => setShowAdd(false)} onSaved={load} /> : null}
      {removeTarget !== null ? (
        <ConfirmDialog
          title="Remove from queue" danger confirmLabel="Remove"
          message="Remove this entry from today's queue? This does not cancel any appointment."
          onConfirm={async () => {
            await call('queue.remove', { id: removeTarget })
            toast('Removed from queue.')
            await load()
          }}
          onClose={() => setRemoveTarget(null)}
        />
      ) : null}
    </div>
  )
}

function QueueAddForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }): React.ReactNode {
  const [patientSearch, setPatientSearch] = useState('')
  const [patients, setPatients] = useState<{ id: number; patientCode: string; fullName: string }[]>([])
  const [patientId, setPatientId] = useState<number | null>(null)
  const [dentists, setDentists] = useState<Awaited<ReturnType<typeof call<'dentist.list'>>>>([])
  const [dentistId, setDentistId] = useState<number | null>(null)
  const [priority, setPriority] = useState<'normal' | 'urgent'>('normal')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void call('dentist.list', { activeOnly: true })
      .then((d) => { setDentists(d); setDentistId((cur) => cur ?? d[0]?.id ?? null) })
      .catch(() => setDentists([]))
  }, [])

  useEffect(() => {
    if (patientSearch.trim().length < 2) return
    const t = setTimeout(() => {
      void call('patient.list', { preset: 'all', search: patientSearch.trim(), page: 1, pageSize: 8 })
        .then((r) => setPatients(r.rows))
        .catch(() => undefined)
    }, 250)
    return () => clearTimeout(t)
  }, [patientSearch])

  return (
    <Modal
      title="Add patient to queue" onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary" loading={busy} disabled={!patientId}
            onClick={async () => {
              setBusy(true); setError('')
              try {
                const entry = await call('queue.add', { patientId: patientId ?? 0, dentistId: dentistId ?? 0, priority })
                toast(`Token #${entry.tokenNo} issued.`)
                await onSaved()
                onClose()
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed.')
              } finally { setBusy(false) }
            }}
          >
            Add to queue
          </Button>
        </>
      }
    >
      <div className="col">
        {patientId ? (
          <div className="row">
            <b>{patients.find((p) => p.id === patientId)?.fullName ?? `Patient #${patientId}`}</b>
            <Button size="sm" onClick={() => { setPatientId(null); setPatientSearch('') }}>Change</Button>
          </div>
        ) : (
          <Field label="Patient" required>
            <>
              <input className="input" value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} placeholder="Search patient…" autoFocus />
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
          </Field>
        )}
        <Field label="Dentist" required>
          <select className="select" value={dentistId ?? ''} onChange={(e) => setDentistId(Number(e.target.value))}>
            {dentists.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select className="select" value={priority} onChange={(e) => setPriority(e.target.value as 'urgent')}>
            <option value="normal">Normal</option>
            <option value="urgent">Urgent (moves to front)</option>
          </select>
        </Field>
        {error ? <div className="field-error">{error}</div> : null}
        <div className="hint row"><ArrowRightLeft size={13} /> If the patient has an appointment today it will be linked automatically.</div>
      </div>
    </Modal>
  )
}
