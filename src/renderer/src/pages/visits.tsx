import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { call } from '../ipc'
import { can } from '../store'
import { Button, ConfirmDialog, EmptyState, Field, Loading, Modal, Pagination, SearchBar, StatusBadge, money, toast, useDebounced } from '../ui'
import { todayISO, formatDateHuman } from '@shared/dates'
import type { Visit, Treatment } from '@shared/types'

export function VisitsPage(): React.ReactNode {
  const [rows, setRows] = useState<Visit[] | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Visit | null>(null)
  const q = useDebounced(search)
  const pageSize = 20

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await call('visit.list', { preset: '30d', search: q || undefined, page, pageSize })
      setRows(res.rows)
      setTotal(res.total)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load visits.', 'error')
      setRows([])
    }
  }, [q, page])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row">
        <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search visits by patient or diagnosis…" />
        <div className="spacer" />
        {can('visit.create') ? <Button variant="primary" onClick={() => setShowForm(true)}><Plus size={15} /> Record visit</Button> : null}
      </div>

      <div className="card">
        {!rows ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState title="No visits in the last 30 days" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr><th>Date</th><th>Patient</th><th>Dentist</th><th>Chief complaint</th><th>Diagnosis</th><th>Treatments</th><th className="num">Value</th><th>Status</th><th /></tr>
                </thead>
                <tbody>
                  {rows.map((v) => (
                    <tr key={v.id} className="clickable" onClick={() => { window.location.hash = `/patients/${v.patientId}` }}>
                      <td className="text-mono nowrap">{formatDateHuman(v.visitDate)}</td>
                      <td><b>{v.patientName}</b></td>
                      <td>{v.dentistName}</td>
                      <td className="text-soft" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.chiefComplaint ?? '—'}</td>
                      <td className="text-soft" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.diagnosis ?? '—'}</td>
                      <td className="text-soft text-small" style={{ maxWidth: 200 }}>{v.treatments.map((t) => t.name).join(', ') || '—'}</td>
                      <td className="num">{can('financial.view') ? money(v.treatments.reduce((s, t) => s + t.lineTotal, 0)) : '—'}</td>
                      <td><StatusBadge status={v.status} /></td>
                      {can('visit.delete') ? (
                        <td onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" variant="ghost-danger" onClick={() => setDeleteTarget(v)}><Trash2 size={13} /></Button>
                        </td>
                      ) : <td />}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '0 16px' }}><Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} /></div>
          </>
        )}
      </div>

      {showForm ? <VisitForm onClose={() => setShowForm(false)} onSaved={load} /> : null}
      {deleteTarget ? (
        <ConfirmDialog
          title="Delete visit" danger confirmLabel="Delete visit"
          message={<>Delete the visit for <b>{deleteTarget.patientName}</b> on {formatDateHuman(deleteTarget.visitDate)}? Linked prescriptions and invoices will be kept but unlinked.</>}
          onConfirm={async () => {
            await call('visit.delete', { id: deleteTarget.id, confirm: 'DELETE' })
            toast('Visit deleted.')
            await load()
          }}
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}
    </div>
  )
}

export function VisitForm({ presetPatientId, onClose, onSaved }: { presetPatientId?: number; onClose: () => void; onSaved: () => Promise<void> }): React.ReactNode {
  const [patientSearch, setPatientSearch] = useState('')
  const [patients, setPatients] = useState<{ id: number; patientCode: string; fullName: string }[]>([])
  const [patientId, setPatientId] = useState<number | null>(presetPatientId ?? null)
  const [dentists, setDentists] = useState<Awaited<ReturnType<typeof call<'dentist.list'>>>>([])
  const [dentistId, setDentistId] = useState<number | null>(null)
  const [treatments, setTreatments] = useState<{ rows: Treatment[]; total: number }>({ rows: [], total: 0 })
  const [form, setForm] = useState({ visitDate: todayISO(), visitTime: '10:00', chiefComplaint: '', examination: '', diagnosis: '', treatmentSummary: '', notes: '', followUpDate: '' })
  const [lines, setLines] = useState<{ treatmentId: number | null; name: string; unitPrice: number; quantity: number }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void call('dentist.list', { activeOnly: true }).then((d) => { setDentists(d); setDentistId((cur) => cur ?? d[0]?.id ?? null) }).catch(() => undefined)
    void call('treatment.list', { page: 1, pageSize: 200, activeOnly: true }).then(setTreatments).catch(() => setTreatments({ rows: [], total: 0 }))
    if (presetPatientId) {
      void call('patient.get', { id: presetPatientId }).then((p) => setPatients([{ id: p.id, patientCode: p.patientCode, fullName: p.fullName }])).catch(() => undefined)
    }
  }, [presetPatientId])

  useEffect(() => {
    if (patientId || patientSearch.trim().length < 2) return
    const t = setTimeout(() => {
      void call('patient.list', { preset: 'all', search: patientSearch.trim(), page: 1, pageSize: 8 })
        .then((r) => setPatients(r.rows))
        .catch(() => undefined)
    }, 250)
    return () => clearTimeout(t)
  }, [patientSearch, patientId])

  const totalValue = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0)

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await call('visit.create', {
        patientId: patientId ?? 0, dentistId: dentistId ?? 0,
        visitDate: form.visitDate, visitTime: form.visitTime,
        chiefComplaint: form.chiefComplaint || null, examination: form.examination || null,
        diagnosis: form.diagnosis || null, treatmentSummary: form.treatmentSummary || null,
        notes: form.notes || null, followUpDate: form.followUpDate || null,
        treatments: lines.map((l) => ({ treatmentId: l.treatmentId, name: l.name, unitPrice: l.unitPrice, quantity: l.quantity }))
      })
      toast('Visit recorded.')
      await onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save visit.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Record visit" onClose={onClose} wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!patientId || !dentistId} onClick={() => void submit()}>
            Save visit {can('financial.view') && totalValue > 0 ? `(${money(totalValue)})` : ''}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Patient" required span>
          {patientId ? (
            <div className="row">
              <b>{patients.find((p) => p.id === patientId)?.fullName ?? `#${patientId}`}</b>
              {!presetPatientId ? <Button size="sm" onClick={() => { setPatientId(null); setPatientSearch('') }}>Change</Button> : null}
            </div>
          ) : (
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
          )}
        </Field>
        <Field label="Dentist" required>
          <select className="select" value={dentistId ?? ''} onChange={(e) => setDentistId(Number(e.target.value))}>
            {dentists.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
          </select>
        </Field>
        <div className="row">
          <Field label="Date" required>
            <input className="input" type="date" value={form.visitDate} onChange={(e) => setForm({ ...form, visitDate: e.target.value })} />
          </Field>
          <Field label="Time">
            <input className="input" type="time" value={form.visitTime} onChange={(e) => setForm({ ...form, visitTime: e.target.value })} />
          </Field>
        </div>
        <Field label="Chief complaint">
          <input className="input" value={form.chiefComplaint} onChange={(e) => setForm({ ...form, chiefComplaint: e.target.value })} />
        </Field>
        <Field label="Diagnosis">
          <input className="input" value={form.diagnosis} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} />
        </Field>
        <Field label="On examination" span>
          <textarea className="textarea" value={form.examination} onChange={(e) => setForm({ ...form, examination: e.target.value })} />
        </Field>
        <Field label="Treatment summary" span>
          <textarea className="textarea" value={form.treatmentSummary} onChange={(e) => setForm({ ...form, treatmentSummary: e.target.value })} />
        </Field>
        <Field label="Follow-up date">
          <input className="input" type="date" value={form.followUpDate} onChange={(e) => setForm({ ...form, followUpDate: e.target.value })} />
        </Field>
        <Field label="Notes">
          <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>

        <div className="span-2">
          <div className="section-title">Treatments performed</div>
          <div className="col" style={{ gap: 8 }}>
            {lines.map((l, i) => (
              <div key={i} className="row">
                <select
                  className="select" style={{ flex: 1 }}
                  value={l.treatmentId ?? ''}
                  onChange={(e) => {
                    const t = treatments.rows.find((x) => x.id === Number(e.target.value))
                    setLines((ls) => ls.map((x, j) => j === i ? { ...x, treatmentId: t?.id ?? null, name: t?.name ?? x.name, unitPrice: t?.defaultPrice ?? x.unitPrice } : x))
                  }}
                >
                  <option value="">Custom…</option>
                  {treatments.rows.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <input
                  className="input" style={{ flex: 1 }} placeholder="Treatment name"
                  value={l.name} onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                />
                {can('financial.view') ? (
                  <input
                    className="input text-mono" style={{ width: 120 }} type="number" title="Unit price in ৳"
                    value={l.unitPrice / 100} step="0.01"
                    onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, unitPrice: Math.round(Number(e.target.value) * 100) } : x))}
                  />
                ) : null}
                <input
                  className="input" style={{ width: 76 }} type="number" min={1} title="Quantity" value={l.quantity}
                  onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, quantity: Math.max(1, Number(e.target.value)) } : x))}
                />
                <Button variant="ghost-danger" size="sm" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 size={13} /></Button>
              </div>
            ))}
            <Button size="sm" onClick={() => setLines((ls) => [...ls, { treatmentId: null, name: '', unitPrice: 0, quantity: 1 }])}>
              <Plus size={13} /> Add treatment
            </Button>
            {can('financial.view') && totalValue > 0 ? (
              <div className="text-small text-soft">Treatment value: <b>{money(totalValue)}</b> — can be pulled into an invoice later.</div>
            ) : null}
          </div>
        </div>
        {error ? <div className="field-error span-2">{error}</div> : null}
      </div>
    </Modal>
  )
}
