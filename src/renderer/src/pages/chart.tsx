import { useCallback, useEffect, useState } from 'react'
import { History, Save } from 'lucide-react'
import { call } from '../ipc'
import { can } from '../store'
import { Button, EmptyState, Field, Loading, Modal, toast } from '../ui'
import { ADULT_TEETH, PEDIATRIC_TEETH } from '@shared/enums'
import type { ToothCondition } from '@shared/types'

/** Adult quadrants: 1x upper-right → 2x upper-left, 4x lower-right → 3x lower-left (FDI). */
function adultRows(dentition: 'adult' | 'pediatric'): number[][] {
  const teeth = dentition === 'adult' ? ADULT_TEETH : PEDIATRIC_TEETH
  const upperRight = teeth.filter((t) => t >= 11 && t <= 18 || t >= 51 && t <= 55).sort((a, b) => b - a)
  const upperLeft = teeth.filter((t) => t >= 21 && t <= 28 || t >= 61 && t <= 65).sort((a, b) => a - b)
  const lowerRight = teeth.filter((t) => t >= 41 && t <= 48 || t >= 81 && t <= 85).sort((a, b) => b - a)
  const lowerLeft = teeth.filter((t) => t >= 31 && t <= 38 || t >= 71 && t <= 75).sort((a, b) => a - b)
  return [upperRight, upperLeft, lowerRight, lowerLeft]
}

export function ChartPage(): React.ReactNode {
  const [patientSearch, setPatientSearch] = useState('')
  const [patients, setPatients] = useState<{ id: number; patientCode: string; fullName: string }[]>([])
  const [patientId, setPatientId] = useState<number | null>(null)
  const [patientName, setPatientName] = useState('')
  const [dentition, setDentition] = useState<'adult' | 'pediatric'>('adult')
  const [conditions, setConditions] = useState<ToothCondition[]>([])
  const [state, setState] = useState<Awaited<ReturnType<typeof call<'chart.state'>>> | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [draft, setDraft] = useState<{ [tooth: number]: { conditionId: number | null; note: string } }>({})
  const [historyTooth, setHistoryTooth] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void call('chart.conditions').then(setConditions).catch(() => setConditions([]))
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

  const loadState = useCallback(async (): Promise<void> => {
    if (!patientId) {
      setState(null)
      return
    }
    try {
      setState(await call('chart.state', { patientId, dentition }))
      setDraft({})
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load chart.', 'error')
    }
  }, [patientId, dentition])

  useEffect(() => {
    void loadState()
  }, [loadState])

  const pickPatient = (id: number): void => {
    setPatientId(id)
    setPatientName(patients.find((p) => p.id === id)?.fullName ?? '')
  }

  const effective = (tooth: number): { conditionId: number | null; note: string | null } => {
    const live = state?.states.find((s) => s.tooth === tooth)
    const d = draft[tooth]
    return d ? { conditionId: d.conditionId, note: d.note ?? null } : { conditionId: live?.conditionId ?? null, note: live?.note ?? null }
  }

  const dirty = Object.keys(draft).length > 0

  const save = async (): Promise<void> => {
    if (!patientId) return
    setBusy(true)
    try {
      const entries = Object.entries(draft)
        .map(([tooth, v]) => ({ tooth: Number(tooth), conditionId: v.conditionId ?? 0, note: v.note || null }))
        .filter((e) => e.conditionId > 0)
      await call('chart.save', { patientId, dentition, entries })
      toast('Chart saved.')
      await loadState()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to save chart.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const rows = adultRows(dentition)

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row row-wrap">
        {!patientId ? (
          <div className="searchbar" style={{ maxWidth: 340 }}>
            <input className="input" value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} placeholder="Search patient to open chart…" />
          </div>
        ) : (
          <>
            <Button onClick={() => { setPatientId(null); setState(null); setPatientName('') }}>← Change patient</Button>
            <h1 style={{ margin: 0, fontSize: 18 }}>{patientName}</h1>
          </>
        )}
        <div className="spacer" />
        <div className="tabs" style={{ margin: 0 }}>
          <button className={`tab ${dentition === 'adult' ? 'active' : ''}`} onClick={() => setDentition('adult')}>Adult</button>
          <button className={`tab ${dentition === 'pediatric' ? 'active' : ''}`} onClick={() => setDentition('pediatric')}>Pediatric</button>
        </div>
        {patientId && can('chart.edit') && dirty ? (
          <Button variant="primary" loading={busy} onClick={() => void save()}><Save size={14} /> Save changes</Button>
        ) : null}
      </div>

      {patientId === null ? (
        patients.length > 0 ? (
          <div className="card" style={{ padding: 8 }}>
            {patients.map((p) => (
              <button key={p.id} className="nav-item" style={{ color: 'var(--text)' }} onClick={() => pickPatient(p.id)}>
                <b>{p.fullName}</b> <span className="text-faint">{p.patientCode}</span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState title="Search for a patient to open their dental chart" hint="Type at least two letters of the name." />
        )
      ) : !state ? (
        <Loading />
      ) : (
        <>
          <div className="card card-pad">
            <div className="col" style={{ gap: 10 }}>
              {[0, 1].map((bandIdx) => (
                <div key={bandIdx}>
                  <div className="text-faint text-small" style={{ textAlign: 'center', marginBottom: 3 }}>
                    {bandIdx === 0 ? 'Upper jaw' : 'Lower jaw'}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                    {[0, 1].map((sideIdx) => {
                      const rowIdx = bandIdx * 2 + sideIdx
                      const row = rows[rowIdx] ?? []
                      const display = sideIdx === 0 ? [...row].reverse() : row
                      return (
                        <div key={sideIdx} style={{ display: 'grid', gridTemplateColumns: `repeat(${row.length}, 1fr)`, gap: 4, direction: sideIdx === 0 ? 'rtl' : 'ltr' }}>
                          {display.map((tooth) => {
                            const cond = effective(tooth)
                            const color = cond.conditionId ? conditions.find((c) => c.id === cond.conditionId)?.color ?? '#d9e2e0' : null
                            return (
                              <div
                                key={tooth}
                                className={`tooth ${color ? 'has-condition' : ''} ${selected === tooth ? 'selected' : ''}`}
                                style={color ? { background: color } : undefined}
                                title={cond.conditionId ? `${conditions.find((c) => c.id === cond.conditionId)?.name ?? ''}${cond.note ? ` — ${cond.note}` : ''}` : `Tooth ${tooth}`}
                                onClick={() => setSelected(tooth)}
                              >
                                {tooth}
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="row row-wrap mt-3" style={{ gap: 10 }}>
              {conditions.filter((c) => c.isActive).map((c) => (
                <span key={c.id} className="badge badge-gray" style={{ background: `${c.color}22`, color: 'var(--text)' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 99, background: c.color, display: 'inline-block' }} />
                  {c.name}
                </span>
              ))}
            </div>
          </div>

          {selected !== null ? (
            <div className="card card-pad">
              <div className="row">
                <b style={{ fontSize: 15 }}>Tooth {selected}</b>
                <span className="text-soft text-small">
                  current: {effective(selected).conditionId ? conditions.find((c) => c.id === effective(selected).conditionId)?.name : 'sound'}
                </span>
                <div className="spacer" />
                {can('chart.view') ? (
                  <Button size="sm" onClick={() => setHistoryTooth(selected)}><History size={13} /> History</Button>
                ) : null}
              </div>
              {can('chart.edit') ? (
                <div className="form-grid mt-2">
                  <Field label="Condition">
                    <select
                      className="select"
                      value={draft[selected]?.conditionId ?? effective(selected).conditionId ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, [selected]: { conditionId: e.target.value ? Number(e.target.value) : null, note: d[selected]?.note ?? effective(selected).note ?? '' } }))}
                    >
                      <option value="">Sound / clear</option>
                      {conditions.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Note">
                    <input
                      className="input" defaultValue={effective(selected).note ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, [selected]: { conditionId: d[selected]?.conditionId ?? effective(selected).conditionId, note: e.target.value } }))}
                      placeholder="e.g. MO caries, mild"
                    />
                  </Field>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {historyTooth !== null ? <ToothHistoryModal patientId={patientId!} dentition={dentition} tooth={historyTooth} conditions={conditions} onClose={() => setHistoryTooth(null)} /> : null}
    </div>
  )
}

function ToothHistoryModal({ patientId, dentition, tooth, conditions, onClose }: { patientId: number; dentition: 'adult' | 'pediatric'; tooth: number; conditions: ToothCondition[]; onClose: () => void }): React.ReactNode {
  const [entries, setEntries] = useState<Awaited<ReturnType<typeof call<'chart.toothHistory'>>> | null>(null)
  useEffect(() => {
    void call('chart.toothHistory', { patientId, dentition, tooth }).then(setEntries).catch(() => setEntries([]))
  }, [patientId, dentition, tooth])
  return (
    <Modal title={`Tooth ${tooth} — history`} onClose={onClose}>
      {!entries ? (
        <Loading />
      ) : entries.length === 0 ? (
        <EmptyState title="No recorded conditions for this tooth" />
      ) : (
        <div className="col">
          {entries.map((e, i) => (
            <div key={i} className="row" style={{ borderBottom: '1px solid var(--border)', padding: '8px 0' }}>
              <span
                className="badge" style={{ background: `${e.conditionColor ?? '#e8eef0'}22` }}
              >
                {e.conditionName ?? conditions.find((c) => c.id === e.conditionId)?.name ?? '?'}
              </span>
              <div className="spacer" />
              <span className="text-faint text-small text-mono">{e.recordedAt?.slice(0, 10) ?? ''}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
