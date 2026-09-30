import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Plus, Archive, ArchiveRestore, Trash2, Download, Pencil } from 'lucide-react'
import { call } from '../ipc'
import { can } from '../store'
import { Button, ConfirmDialog, EmptyState, Field, Loading, Modal, Pagination, SearchBar, StatusBadge, money, toast, useDebounced } from '../ui'
import type { Patient, PatientListRow } from '@shared/types'
import type { PatientInput } from '@shared/ipc'

/* ================= List ================= */
export function PatientsPage(): React.ReactNode {
  const nav = useNavigate()
  const [rows, setRows] = useState<PatientListRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'active' | 'archived'>('active')
  const [showForm, setShowForm] = useState(false)
  const q = useDebounced(search)
  const pageSize = 20

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await call('patient.list', { preset: 'all', search: q || undefined, status, page, pageSize })
      setRows(res.rows)
      setTotal(res.total)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load patients.', 'error')
      setRows([])
    }
  }, [q, status, page])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row">
        <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search by name, phone, code or complaint…" />
        <div className="spacer" />
        <select className="select" style={{ width: 150 }} value={status} onChange={(e) => { setStatus(e.target.value as 'active'); setPage(1) }}>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
        {can('patient.export') && total > 0 ? (
          <Button onClick={() => void call('patient.export', { preset: 'all', status, search: q || undefined, page: 1, pageSize: 200 }).then((r) => toast(`Exported ${r.count} patients to ${r.path}`)).catch((e) => toast(e.message, 'error'))}>
            <Download size={15} /> Export CSV
          </Button>
        ) : null}
        {can('patient.create') ? (
          <Button variant="primary" onClick={() => setShowForm(true)}><Plus size={15} /> New patient</Button>
        ) : null}
      </div>

      <div className="card">
        {!rows ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState title={status === 'archived' ? 'No archived patients' : 'No patients yet'} hint={q ? `Nothing matches “${q}”.` : 'Create your first patient to get started.'} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Code</th><th>Name</th><th>Age/Gender</th><th>Phone</th><th>Chief complaint</th>
                    <th className="num">Visits</th><th>Last visit</th><th>Registered</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => nav(`/patients/${p.id}`)}>
                      <td className="text-mono">{p.patientCode}</td>
                      <td>
                        <b>{p.fullName}</b>
                        {p.archived ? <span className="badge badge-gray" style={{ marginLeft: 8 }}>archived</span> : null}
                        {p.status === 'inactive' ? <span className="badge badge-gray" style={{ marginLeft: 8 }}>inactive</span> : null}
                      </td>
                      <td>{[p.age ?? '—', p.gender].join(' / ')}</td>
                      <td className="text-mono">{p.phone ?? '—'}</td>
                      <td className="text-soft" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.chiefComplaint ?? '—'}</td>
                      <td className="num">{p.visitCount}</td>
                      <td className="text-mono">{p.lastVisitDate ?? '—'}</td>
                      <td className="text-mono text-faint">{p.registeredAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '0 16px' }}><Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} /></div>
          </>
        )}
      </div>

      {showForm ? <PatientForm onClose={() => setShowForm(false)} onSaved={(id) => { setShowForm(false); void load(); nav(`/patients/${id}`) }} /> : null}
    </div>
  )
}

/* ================= Create / edit form ================= */
const EMPTY: PatientInput = { fullName: '', gender: 'male', phone: '', chiefComplaint: '', address: '', notes: '' }

export function PatientForm({ patient, onClose, onSaved }: { patient?: Patient; onClose: () => void; onSaved: (id: number) => void }): React.ReactNode {
  const editing = !!patient
  const [form, setForm] = useState<PatientInput>(patient ?? EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof PatientInput, v: unknown): void => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      if (editing) {
        await call('patient.update', { id: patient.id, data: form })
        toast('Patient updated.')
        onSaved(patient.id)
      } else {
        const created = await call('patient.create', form)
        toast(`Patient ${created.patientCode} created.`)
        onSaved(created.id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={editing ? 'Edit patient' : 'New patient'} onClose={onClose} wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!form.fullName} onClick={() => void submit()}>
            {editing ? 'Save changes' : 'Create patient'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Full name" required span>
          <input className="input" value={form.fullName ?? ''} onChange={(e) => set('fullName', e.target.value)} autoFocus placeholder="Patient full name (Bangla or English)" />
        </Field>
        <Field label="Gender" required>
          <select className="select" value={form.gender ?? 'male'} onChange={(e) => set('gender', e.target.value)}>
            <option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
          </select>
        </Field>
        <Field label="Age (years)">
          <input className="input" type="number" min={0} max={120} value={form.age ?? ''} onChange={(e) => set('age', e.target.value === '' ? undefined : Number(e.target.value))} />
        </Field>
        <Field label="Date of birth" hint="Optional — used with age for ID prints.">
          <input className="input" type="date" value={form.dob ?? ''} onChange={(e) => set('dob', e.target.value)} />
        </Field>
        <Field label="Phone">
          <input className="input" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="01XXXXXXXXX" />
        </Field>
        <Field label="Blood group">
          <select className="select" value={form.bloodGroup ?? ''} onChange={(e) => set('bloodGroup', e.target.value || null)}>
            <option value="">—</option>
            {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </Field>
        <Field label="Chief complaint">
          <input className="input" value={form.chiefComplaint ?? ''} onChange={(e) => set('chiefComplaint', e.target.value)} placeholder="e.g. Pain in lower right molar" />
        </Field>
        <Field label="Address" span>
          <input className="input" value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label="Medical notes / allergies" span>
          <textarea className="textarea" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder="Drug allergies, chronic conditions, pregnancy…" />
        </Field>
        {!editing ? (
          <div className="span-2 hint">A unique patient code will be generated automatically.</div>
        ) : null}
        {error ? <div className="field-error span-2">{error}</div> : null}
      </div>
    </Modal>
  )
}

/* ================= Detail ================= */
export function PatientDetailPage(): React.ReactNode {
  const { id } = useParams()
  const patientId = Number(id)
  const nav = useNavigate()
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof call<'patient.get'>>> | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      setDetail(await call('patient.get', { id: patientId }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load patient.')
    }
  }, [patientId])

  useEffect(() => {
    void load()
  }, [load])

  if (error) return <div className="empty">{error} — <Link to="/patients">back to patients</Link></div>
  if (!detail) return <Loading />

  const archive = async (): Promise<void> => {
    await call('patient.archive', { id: patientId, archived: !detail.archivedAt })
    toast(detail.archivedAt ? 'Patient restored.' : 'Patient archived.')
    await load()
  }
  const remove = async (): Promise<void> => {
    await call('patient.deletePermanent', { id: patientId, confirm: detail.patientCode })
    toast('Patient permanently deleted.')
    nav('/patients')
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row row-wrap">
        <Button onClick={() => nav('/patients')}>← Patients</Button>
        <h1 style={{ margin: 0, fontSize: 20 }}>{detail.fullName}</h1>
        <span className="badge badge-teal text-mono">{detail.patientCode}</span>
        {detail.archivedAt ? <span className="badge badge-gray">archived</span> : null}
        <div className="spacer" />
        {can('patient.edit') ? <Button onClick={() => setEditing(true)}><Pencil size={14} /> Edit</Button> : null}
        {can('patient.archive') ? (
          <Button variant={detail.archivedAt ? 'ghost' : 'ghost-danger'} onClick={() => setConfirmArchive(true)}>
            {detail.archivedAt ? <ArchiveRestore size={14} /> : <Archive size={14} />} {detail.archivedAt ? 'Restore' : 'Archive'}
          </Button>
        ) : null}
        {can('patient.delete') ? (
          <Button variant="ghost-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> Delete</Button>
        ) : null}
      </div>

      <div className="grid grid-side">
        <div className="col" style={{ gap: 16 }}>
          <div className="grid grid-4">
            <div className="stat"><div className="stat-label">Visits</div><div className="stat-value">{detail.visitCount}</div>{detail.lastVisitDate ? <div className="stat-foot">last {detail.lastVisitDate}</div> : null}</div>
            <div className="stat"><div className="stat-label">Prescriptions</div><div className="stat-value">{detail.prescriptionCount}</div></div>
            <div className="stat"><div className="stat-label">Attachments</div><div className="stat-value">{detail.attachmentCount}</div></div>
            <div className="stat">
              <div className="stat-label">Outstanding</div>
              <div className="stat-value" style={{ color: (detail.outstanding ?? 0) > 0 ? 'var(--danger)' : undefined }}>
                {detail.outstanding === null ? '—' : money(detail.outstanding)}
              </div>
            </div>
          </div>
          <PatientTimelineCard patientId={patientId} />
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card card-pad">
            <div className="section-title">Profile</div>
            <dl className="kv">
              <dt>Age / Gender</dt><dd>{[detail.age ?? '—', detail.gender].join(' / ')}</dd>
              <dt>Phone</dt><dd className="text-mono">{detail.phone ?? '—'}</dd>
              <dt>Blood group</dt><dd>{detail.bloodGroup ?? '—'}</dd>
              <dt>Address</dt><dd>{detail.address || '—'}</dd>
              <dt>Registered</dt><dd className="text-mono">{detail.registeredAt}</dd>
              <dt>Chief complaint</dt><dd>{detail.chiefComplaint || '—'}</dd>
              <dt>Medical notes</dt><dd>{detail.notes || '—'}</dd>
            </dl>
          </div>
          {can('financial.view') && detail.totalBilled !== null ? (
            <div className="card card-pad">
              <div className="section-title">Financial summary</div>
              <dl className="kv">
                <dt>Total billed</dt><dd>{money(detail.totalBilled)}</dd>
                <dt>Total paid</dt><dd>{money(detail.totalPaid)}</dd>
                <dt>Outstanding</dt><dd className={(detail.outstanding ?? 0) > 0 ? 'text-danger' : 'text-success'}>{money(detail.outstanding)}</dd>
                {detail.lastPayment ? <dt>Last payment</dt> : null}
                {detail.lastPayment ? <dd>{money(detail.lastPayment.amount)} · {detail.lastPayment.method} · {detail.lastPayment.date}</dd> : null}
              </dl>
            </div>
          ) : null}
          {detail.upcomingAppointments.length > 0 ? (
            <div className="card card-pad">
              <div className="section-title">Upcoming appointments</div>
              {detail.upcomingAppointments.map((a) => (
                <div key={a.id} className="row mb-1">
                  <span className="text-mono">{a.apptDate} {a.apptTime}</span>
                  <StatusBadge status={a.status} />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {editing ? <PatientForm patient={detail} onClose={() => setEditing(false)} onSaved={async () => { setEditing(false); await load() }} /> : null}
      {confirmArchive ? (
        <ConfirmDialog
          title={detail.archivedAt ? 'Restore patient' : 'Archive patient'}
          message={detail.archivedAt ? 'The patient will return to the active list.' : 'The patient will be hidden from the active list but all records are kept.'}
          confirmLabel={detail.archivedAt ? 'Restore' : 'Archive'}
          danger={!detail.archivedAt}
          onConfirm={archive}
          onClose={() => setConfirmArchive(false)}
        />
      ) : null}
      {confirmDelete ? (
        <ConfirmDialog
          title="Permanently delete patient"
          message={<>This erases <b>every</b> visit, prescription, invoice, payment, appointment and attachment for {detail.fullName}. This cannot be undone.</>}
          confirmLabel="Delete forever"
          danger
          requireTyped={detail.patientCode}
          onConfirm={remove}
          onClose={() => setConfirmDelete(false)}
        />
      ) : null}
    </div>
  )
}

function PatientTimelineCard({ patientId }: { patientId: number }): React.ReactNode {
  const [events, setEvents] = useState<Awaited<ReturnType<typeof call<'timeline.patient'>>> | null>(null)
  useEffect(() => {
    void call('timeline.patient', { patientId, page: 1, pageSize: 15 }).then(setEvents).catch(() => setEvents(null))
  }, [patientId])
  if (!events || events.rows.length === 0) return null
  return (
    <div className="card">
      <div className="card-head"><div className="card-title">Recent activity</div></div>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>When</th><th>Event</th><th>Detail</th></tr></thead>
          <tbody>
            {events.rows.map((e) => (
              <tr key={e.id} className={e.route ? 'clickable' : ''} onClick={() => e.route && (window.location.hash = e.route)}>
                <td className="text-mono nowrap">{e.date}</td>
                <td><span className="badge badge-gray">{e.type}</span></td>
                <td className="text-soft">{e.title}{e.detail ? ` — ${e.detail}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
