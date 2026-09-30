import { useCallback, useEffect, useState } from 'react'
import { Plus, Printer, Ban, Trash2 } from 'lucide-react'
import { call } from '../ipc'
import { can } from '../store'
import { Button, ConfirmDialog, EmptyState, Field, Loading, Modal, Pagination, SearchBar, StatusBadge, toast, useDebounced } from '../ui'
import { todayISO, formatDateHuman } from '@shared/dates'
import { renderPrescription } from '@shared/print'
import type { Prescription } from '@shared/types'

interface MedDraft {
  name: string; doseForm: string; strength: string
  morning: boolean; noon: boolean; night: boolean
  meal: 'before' | 'after' | 'with' | null
  durationValue: number | null; durationUnit: 'day' | 'week' | 'month' | null
  isPrn: boolean; instruction: string
}

const EMPTY_MED: MedDraft = {
  name: '', doseForm: 'tablet', strength: '',
  morning: false, noon: false, night: false,
  meal: 'after', durationValue: 5, durationUnit: 'day',
  isPrn: false, instruction: ''
}

export function PrescriptionsPage(): React.ReactNode {
  const [rows, setRows] = useState<Prescription[] | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [voidTarget, setVoidTarget] = useState<Prescription | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const q = useDebounced(search)
  const pageSize = 20

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await call('prescription.list', { preset: '30d', search: q || undefined, page, pageSize })
      setRows(res.rows)
      setTotal(res.total)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load prescriptions.', 'error')
      setRows([])
    }
  }, [q, page])

  useEffect(() => {
    void load()
  }, [load])

  const reprint = async (rx: Prescription): Promise<void> => {
    try {
      const full = await call('prescription.get', { id: rx.id })
      await printRx(full)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to print.', 'error')
    }
  }

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row">
        <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search by patient or Rx number…" />
        <div className="spacer" />
        {can('prescription.create') ? <Button variant="primary" onClick={() => setShowForm(true)}><Plus size={15} /> New prescription</Button> : null}
      </div>

      <div className="card">
        {!rows ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState title="No prescriptions in the last 30 days" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr><th>Rx #</th><th>Date</th><th>Patient</th><th>Dentist</th><th>Medicines</th><th>Status</th><th /></tr>
                </thead>
                <tbody>
                  {rows.map((rx) => (
                    <tr key={rx.id}>
                      <td className="text-mono"><b>{rx.rxNo}</b></td>
                      <td className="text-mono nowrap">{formatDateHuman(rx.rxDate)}</td>
                      <td>
                        <a href={`#/patients/${rx.patientId}`} style={{ color: 'inherit', fontWeight: 600, textDecoration: 'none' }}>{rx.patientName}</a>
                        <div className="text-faint text-small">{rx.patientCode}</div>
                      </td>
                      <td>{rx.dentistName}</td>
                      <td className="text-soft text-small" style={{ maxWidth: 280 }}>{rx.medicines.length} item{rx.medicines.length === 1 ? '' : 's'}</td>
                      <td><StatusBadge status={rx.status} /></td>
                      <td className="nowrap">
                        <Button size="sm" onClick={() => void reprint(rx)}><Printer size={13} /> Print</Button>
                        {can('prescription.void') && rx.status === 'active' ? (
                          <Button size="sm" variant="ghost-danger" onClick={() => { setVoidTarget(rx); setVoidReason('') }}><Ban size={13} /></Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '0 16px' }}><Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} /></div>
          </>
        )}
      </div>

      {showForm ? <RxForm onClose={() => setShowForm(false)} onSaved={load} /> : null}
      {voidTarget ? (
        <Modal
          title={`Void ${voidTarget.rxNo}`} onClose={() => setVoidTarget(null)}
          footer={
            <>
              <Button onClick={() => setVoidTarget(null)}>Keep</Button>
              <Button
                variant="danger" disabled={!voidReason.trim()}
                onClick={async () => {
                  await call('prescription.void', { id: voidTarget.id, reason: voidReason.trim() })
                  toast('Prescription voided.')
                  setVoidTarget(null)
                  await load()
                }}
              >
                Void prescription
              </Button>
            </>
          }
        >
          <Field label="Reason (required, kept in the audit log)" required>
            <textarea className="textarea" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} autoFocus placeholder="e.g. Wrong dosage — reissued as new Rx" />
          </Field>
        </Modal>
      ) : null}
    </div>
  )
}

export async function printRx(full: Awaited<ReturnType<typeof call<'prescription.get'>>>): Promise<void> {
  const { clinic, settings } = windowMeta()
  const doc = renderPrescription({
    clinic, settings,
    rxNo: full.rxNo, date: full.rxDate,
    patientName: full.patientName, patientCode: full.patientCode, age: full.patientAge, gender: full.patientGender,
    dentistName: full.dentistName, designations: full.dentistDesignations, qualifications: full.dentistQualifications,
    cc: full.cc, oe: full.oe, advice: [full.advice, full.extraAdvice].filter(Boolean).join('\n') || null,
    nextVisit: full.followUpDate,
    medicines: full.medicines.map((m) => ({
      name: m.name, doseForm: m.doseForm, strength: m.strength,
      morning: m.morning, noon: m.noon, night: m.night,
      meal: m.meal, duration: m.isPrn
        ? m.instruction ?? 'SOS'
        : m.durationValue ? `${m.durationValue} ${m.durationUnit}(s)` : null,
      isPrn: m.isPrn, instruction: m.instruction
    }))
  })
  const pdf = await call('print.pdf', { html: doc.html, paper: doc.paper, marginMm: doc.marginMm })
  await call('print.print', { pdfUrl: pdf.pdfUrl, silent: true })
  toast(`Sent ${full.rxNo} to printer.`)
}

function windowMeta(): { clinic: import('@shared/types').ClinicRow | null; settings: import('@shared/types').AppSettings | null } {
  const app = (window as unknown as { __dentivaMeta?: { clinic: import('@shared/types').ClinicRow | null; settings: import('@shared/types').AppSettings | null } }).__dentivaMeta
  return app ?? { clinic: null, settings: null }
}

export function RxForm({ presetPatientId, presetVisitId, onClose, onSaved }: { presetPatientId?: number; presetVisitId?: number; onClose: () => void; onSaved: () => Promise<void> }): React.ReactNode {
  const [patientSearch, setPatientSearch] = useState('')
  const [patients, setPatients] = useState<{ id: number; patientCode: string; fullName: string }[]>([])
  const [patientId, setPatientId] = useState<number | null>(presetPatientId ?? null)
  const [dentists, setDentists] = useState<Awaited<ReturnType<typeof call<'dentist.list'>>>>([])
  const [dentistId, setDentistId] = useState<number | null>(null)
  const [medicines, setMedicines] = useState<MedDraft[]>([{ ...EMPTY_MED }])
  const [medCatalog, setMedCatalog] = useState<Awaited<ReturnType<typeof call<'medicine.list'>>>>([])
  const [options, setOptions] = useState<{ cc: string[]; oe: string[]; advice: string[] }>({ cc: [], oe: [], advice: [] })
  const [form, setForm] = useState({ rxDate: todayISO(), cc: [] as string[], oe: [] as string[], advice: '', extraAdvice: '', followUpDate: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void call('dentist.list', { activeOnly: true }).then((d) => { setDentists(d); setDentistId((cur) => cur ?? d[0]?.id ?? null) }).catch(() => undefined)
    void call('medicine.list', {}).then(setMedCatalog).catch(() => setMedCatalog([]))
    void Promise.all([call('clinicalOptions.list', { kind: 'cc' }), call('clinicalOptions.list', { kind: 'oe' }), call('clinicalOptions.list', { kind: 'advice' })])
      .then(([cc, oe, advice]) => setOptions({ cc: cc.map((o) => o.value), oe: oe.map((o) => o.value), advice: advice.map((o) => o.value) }))
      .catch(() => undefined)
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

  const setMed = (i: number, patch: Partial<MedDraft>): void => {
    setMedicines((ms) => ms.map((m, j) => j === i ? { ...m, ...patch } : m))
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const valid = medicines.filter((m) => m.name.trim())
      const rx = await call('prescription.create', {
        patientId: patientId ?? 0, visitId: presetVisitId ?? null, dentistId: dentistId ?? 0,
        rxDate: form.rxDate,
        cc: form.cc, oe: form.oe,
        advice: form.advice || null, extraAdvice: form.extraAdvice || null,
        followUpDate: form.followUpDate || null,
        medicines: valid.map((m, idx) => ({
          name: m.name.trim(), doseForm: m.doseForm, strength: m.strength || null,
          morning: m.morning, noon: m.noon, night: m.night,
          meal: m.meal === 'with' ? 'after' : m.meal, isPrn: m.isPrn,
          durationValue: m.isPrn ? null : m.durationValue,
          durationUnit: m.isPrn ? null : m.durationUnit,
          instruction: m.instruction || null, sortOrder: idx
        }))
      })
      toast(`Prescription ${rx.rxNo} saved.`)
      await onSaved()
      onClose()
      // offer silent print
      void printRx(rx).catch(() => toast('Saved, but printing failed — check the printer.', 'error'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="New prescription" onClose={onClose} wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!patientId || !dentistId || medicines.filter((m) => m.name.trim()).length === 0} onClick={() => void submit()}>
            Save &amp; print
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 13 }}>
        <div className="form-grid">
          <Field label="Patient" required>
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
                      <button key={p.id} type="button" className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }} onClick={() => setPatientId(p.id)}>
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
          <Field label="Date">
            <input className="input" type="date" value={form.rxDate} onChange={(e) => setForm({ ...form, rxDate: e.target.value })} />
          </Field>
          <Field label="Follow-up date">
            <input className="input" type="date" value={form.followUpDate} onChange={(e) => setForm({ ...form, followUpDate: e.target.value })} />
          </Field>
        </div>

        <div>
          <div className="section-title">Chief complaint</div>
          <div className="row row-wrap">
            {options.cc.map((label) => (
              <button
                key={label} className={`badge ${form.cc.includes(label) ? 'badge-teal' : 'badge-gray'}`} style={{ border: 'none', cursor: 'pointer' }}
                onClick={() => setForm((f) => ({ ...f, cc: f.cc.includes(label) ? f.cc.filter((x) => x !== label) : [...f.cc, label] }))}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="section-title">On examination</div>
          <div className="row row-wrap">
            {options.oe.map((label) => (
              <button
                key={label} className={`badge ${form.oe.includes(label) ? 'badge-teal' : 'badge-gray'}`} style={{ border: 'none', cursor: 'pointer' }}
                onClick={() => setForm((f) => ({ ...f, oe: f.oe.includes(label) ? f.oe.filter((x) => x !== label) : [...f.oe, label] }))}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="section-title">Rx — medicines</div>
          <div className="col" style={{ gap: 10 }}>
            {medicines.map((m, i) => (
              <div key={i} className="card card-pad" style={{ boxShadow: 'none' }}>
                <div className="row mb-1">
                  <b className="text-faint">#{i + 1}</b>
                  <input
                    className="input" style={{ flex: 1 }} list="med-catalog" placeholder="Medicine name"
                    value={m.name} onChange={(e) => setMed(i, { name: e.target.value })}
                  />
                  <datalist id="med-catalog">
                    {medCatalog.map((c) => <option key={c.id} value={c.name} />)}
                  </datalist>
                  <Button size="sm" variant="ghost-danger" disabled={medicines.length === 1} onClick={() => setMedicines((ms) => ms.filter((_, j) => j !== i))}>
                    <Trash2 size={13} />
                  </Button>
                </div>
                <div className="row row-wrap" style={{ gap: 8 }}>
                  <select className="select" style={{ width: 120 }} value={m.doseForm} onChange={(e) => setMed(i, { doseForm: e.target.value })}>
                    {['tablet', 'capsule', 'syrup', 'injection', 'cream', 'gel', 'drops', 'inhaler', 'ointment', 'mouthwash', 'suspension', 'other'].map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                  <input className="input" style={{ width: 110 }} placeholder="Strength" value={m.strength} onChange={(e) => setMed(i, { strength: e.target.value })} />
                  <label className="row text-small" style={{ gap: 4 }}>
                    <input type="checkbox" checked={m.morning} onChange={(e) => setMed(i, { morning: e.target.checked })} /> সকাল
                  </label>
                  <label className="row text-small" style={{ gap: 4 }}>
                    <input type="checkbox" checked={m.noon} onChange={(e) => setMed(i, { noon: e.target.checked })} /> দুপুর
                  </label>
                  <label className="row text-small" style={{ gap: 4 }}>
                    <input type="checkbox" checked={m.night} onChange={(e) => setMed(i, { night: e.target.checked })} /> রাত
                  </label>
                  <label className="row text-small" style={{ gap: 4 }}>
                    <input type="checkbox" checked={m.isPrn} onChange={(e) => setMed(i, { isPrn: e.target.checked })} /> SOS
                  </label>
                  <select className="select" style={{ width: 150 }} value={m.meal ?? ''} onChange={(e) => setMed(i, { meal: (e.target.value || null) as MedDraft['meal'] })}>
                    <option value="">খাবারের সম্পর্ক</option>
                    <option value="before">খাবারের আগে</option>
                    <option value="after">খাবারের পরে</option>
                    <option value="with">খাবারের সাথে</option>
                  </select>
                  {!m.isPrn ? (
                    <>
                      <input className="input" style={{ width: 70 }} type="number" min={1} value={m.durationValue ?? ''} placeholder="Days" onChange={(e) => setMed(i, { durationValue: e.target.value ? Number(e.target.value) : null })} />
                      <select className="select" style={{ width: 105 }} value={m.durationUnit ?? 'day'} onChange={(e) => setMed(i, { durationUnit: e.target.value as MedDraft['durationUnit'] })}>
                        <option value="day">day(s)</option>
                        <option value="week">week(s)</option>
                        <option value="month">month(s)</option>
                      </select>
                    </>
                  ) : null}
                </div>
                <input className="input mt-1" placeholder="Special instruction (optional) — e.g. প্রতি ৬ ঘণ্টা পরপর" value={m.instruction} onChange={(e) => setMed(i, { instruction: e.target.value })} />
              </div>
            ))}
            <Button size="sm" onClick={() => setMedicines((ms) => [...ms, { ...EMPTY_MED }])}><Plus size={13} /> Add medicine</Button>
          </div>
        </div>

        <div className="form-grid">
          <Field label="Advice" span>
            <textarea className="textarea" value={form.advice} onChange={(e) => setForm({ ...form, advice: e.target.value })} placeholder="General advice printed on the prescription" />
          </Field>
          <div className="span-2">
            <div className="row row-wrap">
              {options.advice.map((label) => (
                <button
                  key={label} className="badge badge-gray" style={{ border: 'none', cursor: 'pointer' }}
                  onClick={() => setForm((f) => ({ ...f, advice: f.advice ? f.advice + '\n' + label : label }))}
                >
                  + {label}
                </button>
              ))}
            </div>
          </div>
          <Field label="Extra advice / next visit note" span>
            <textarea className="textarea" value={form.extraAdvice} onChange={(e) => setForm({ ...form, extraAdvice: e.target.value })} />
          </Field>
        </div>
        {error ? <div className="field-error">{error}</div> : null}
        <div className="hint">Prescriptions print with Bengali dosage labels (সকাল / দুপুর / রাত) and the clinic letterhead.</div>
      </div>
    </Modal>
  )
}

export { ConfirmDialog }
