import { useCallback, useEffect, useState } from 'react'
import { Save, Plus, Trash2, DatabaseBackup, HardDriveDownload, AlertTriangle, Printer } from 'lucide-react'
import { call } from '../ipc'
import { can, useApp } from '../store'
import { Button, ConfirmDialog, EmptyState, Field, Loading, Modal, StatusBadge, money, toast } from '../ui'
import { formatDateTimeHuman } from '@shared/dates'
import type { ClinicRow } from '@shared/types'

type Tab = 'clinic' | 'app' | 'backup' | 'danger' | 'about'

export function SettingsPage(): React.ReactNode {
  const [tab, setTab] = useState<Tab>('clinic')
  return (
    <div className="col" style={{ gap: 14, maxWidth: 980 }}>
      <div className="tabs">
        <button className={`tab ${tab === 'clinic' ? 'active' : ''}`} onClick={() => setTab('clinic')}>Clinic &amp; dentists</button>
        <button className={`tab ${tab === 'app' ? 'active' : ''}`} onClick={() => setTab('app')}>Application</button>
        <button className={`tab ${tab === 'backup' ? 'active' : ''}`} onClick={() => setTab('backup')}>Backup &amp; restore</button>
        {can('business.delete') ? <button className={`tab ${tab === 'danger' ? 'active' : ''}`} onClick={() => setTab('danger')}>Danger zone</button> : null}
        <button className={`tab ${tab === 'about' ? 'active' : ''}`} onClick={() => setTab('about')}>About</button>
      </div>
      {tab === 'clinic' ? <ClinicTab /> : tab === 'app' ? <AppTab /> : tab === 'backup' ? <BackupTab /> : tab === 'about' ? <AboutTab /> : <DangerTab />}
    </div>
  )
}

/* ================= Clinic ================= */
function ClinicTab(): React.ReactNode {
  const { refreshMeta } = useApp()
  const [clinic, setClinic] = useState<ClinicRow | null>(null)
  const [dentists, setDentists] = useState<Awaited<ReturnType<typeof call<'dentist.list'>>>>([])
  const [editDentist, setEditDentist] = useState<{ id?: number; fullName: string; designations: string; qualifications: string; phone: string } | null>(null)
  const [deleteDentist, setDeleteDentist] = useState<{ id: number; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [logoBusy, setLogoBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      setClinic(await call('clinic.get'))
      setDentists(await call('dentist.list', {}))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load clinic.', 'error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (!clinic) return <Loading />

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await call('clinic.update', {
        name: clinic.name, address: clinic.address, phone: clinic.phone,
        phone2: clinic.phone2 || null, email: clinic.email || null, tagline: clinic.tagline || null
      })
      toast('Clinic profile saved.')
      await refreshMeta()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card card-pad">
        <div className="section-title">Clinic profile (printed on prescriptions &amp; invoices)</div>
        <div className="form-grid">
          <Field label="Clinic name" required><input className="input" value={clinic.name} onChange={(e) => setClinic({ ...clinic, name: e.target.value })} /></Field>
          <Field label="Tagline"><input className="input" value={clinic.tagline ?? ''} onChange={(e) => setClinic({ ...clinic, tagline: e.target.value })} placeholder="e.g. Care you can trust" /></Field>
          <Field label="Address" span><input className="input" value={clinic.address ?? ''} onChange={(e) => setClinic({ ...clinic, address: e.target.value })} /></Field>
          <Field label="Phone" required><input className="input" value={clinic.phone} onChange={(e) => setClinic({ ...clinic, phone: e.target.value })} /></Field>
          <Field label="Phone 2"><input className="input" value={clinic.phone2 ?? ''} onChange={(e) => setClinic({ ...clinic, phone2: e.target.value })} /></Field>
          <Field label="Email"><input className="input" value={clinic.email ?? ''} onChange={(e) => setClinic({ ...clinic, email: e.target.value })} /></Field>
          {can('settings.manage') ? (
            <div className="span-2 row" style={{ alignItems: 'center' }}>
              <Button
                loading={logoBusy}
                onClick={async () => {
                  setLogoBusy(true)
                  try {
                    await call('clinic.uploadLogo')
                    toast('Logo updated.')
                    await load()
                  } catch (e) {
                    toast(e instanceof Error ? e.message : 'Upload failed.', 'error')
                  } finally { setLogoBusy(false) }
                }}
              >
                Upload logo…
              </Button>
              {clinic.logoPath ? (
                <>
                  <img
                    src={`dentiva-safe://logo/${encodeURIComponent(clinic.logoPath)}`}
                    alt="Clinic logo"
                    style={{ maxHeight: 44, maxWidth: 110, objectFit: 'contain', borderRadius: 6, border: '1px solid var(--border)', background: '#fff' }}
                  />
                  <Button
                    size="sm"
                    variant="ghost-danger"
                    onClick={async () => {
                      try {
                        await call('clinic.update', { logo_path: null })
                        toast('Logo removed.')
                        await load()
                      } catch (e) {
                        toast(e instanceof Error ? e.message : 'Failed.', 'error')
                      }
                    }}
                  >
                    Remove
                  </Button>
                </>
              ) : null}
              <span className="hint">PNG/JPG/WebP up to 2 MB — appears on printed documents.</span>
            </div>
          ) : null}
        </div>
        {can('settings.manage') ? (
          <div className="row mt-3" style={{ justifyContent: 'flex-end' }}>
            <Button variant="primary" loading={busy} onClick={() => void save()}><Save size={14} /> Save profile</Button>
          </div>
        ) : null}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Dentists</div>
          {can('settings.manage') ? (
            <div className="card-actions">
              <Button size="sm" variant="primary" onClick={() => setEditDentist({ fullName: '', designations: '', qualifications: '', phone: '' })}><Plus size={13} /> Add dentist</Button>
            </div>
          ) : null}
        </div>
        {dentists.length === 0 ? (
          <EmptyState title="No dentists" />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Name</th><th>Designations</th><th>Qualifications</th><th>Phone</th><th>Status</th><th /></tr></thead>
              <tbody>
                {dentists.map((d) => (
                  <tr key={d.id}>
                    <td><b>{d.fullName}</b></td>
                    <td className="text-soft text-small">{d.designations.join(', ') || '—'}</td>
                    <td className="text-soft text-small">{d.qualifications.join(', ') || '—'}</td>
                    <td className="text-mono">{d.phone ?? '—'}</td>
                    <td><StatusBadge status={d.isActive ? 'active' : 'inactive'} /></td>
                    <td>
                      {can('settings.manage') ? (
                        <>
                          <Button size="sm" onClick={() => setEditDentist({ id: d.id, fullName: d.fullName, designations: d.designations.join(', '), qualifications: d.qualifications.join(', '), phone: d.phone ?? '' })}>Edit</Button>
                          <Button size="sm" variant="ghost-danger" onClick={() => setDeleteDentist({ id: d.id, name: d.fullName })}><Trash2 size={13} /></Button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editDentist ? (
        <Modal
          title={editDentist.id ? 'Edit dentist' : 'Add dentist'} onClose={() => setEditDentist(null)}
          footer={
            <>
              <Button onClick={() => setEditDentist(null)}>Cancel</Button>
              <Button
                variant="primary" disabled={!editDentist.fullName.trim()}
                onClick={async () => {
                  await call('dentist.save', {
                    id: editDentist.id, fullName: editDentist.fullName.trim(),
                    designations: editDentist.designations.split(',').map((s) => s.trim()).filter(Boolean),
                    qualifications: editDentist.qualifications.split(',').map((s) => s.trim()).filter(Boolean),
                    phone: editDentist.phone || null
                  })
                  toast('Dentist saved.')
                  setEditDentist(null)
                  await load()
                }}
              >
                Save
              </Button>
            </>
          }
        >
          <div className="form-grid">
            <Field label="Full name" required span><input className="input" value={editDentist.fullName} onChange={(e) => setEditDentist({ ...editDentist, fullName: e.target.value })} autoFocus /></Field>
            <Field label="Designations" hint="Comma separated" span><input className="input" value={editDentist.designations} onChange={(e) => setEditDentist({ ...editDentist, designations: e.target.value })} placeholder="Consultant, Oral Surgeon" /></Field>
            <Field label="Qualifications" hint="Comma separated" span><input className="input" value={editDentist.qualifications} onChange={(e) => setEditDentist({ ...editDentist, qualifications: e.target.value })} placeholder="BDS, FCPS" /></Field>
            <Field label="Phone"><input className="input" value={editDentist.phone} onChange={(e) => setEditDentist({ ...editDentist, phone: e.target.value })} /></Field>
          </div>
        </Modal>
      ) : null}
      {deleteDentist ? (
        <ConfirmDialog
          title="Remove dentist" danger requireTyped={deleteDentist.name.toUpperCase()} confirmLabel="Remove dentist"
          message={<>Remove <b>{deleteDentist.name}</b>? Their past visits and prescriptions keep their name for records.</>}
          onConfirm={async () => {
            await call('dentist.delete', { id: deleteDentist.id, confirm: deleteDentist.name.toUpperCase() })
            toast('Dentist removed.')
            await load()
          }}
          onClose={() => setDeleteDentist(null)}
        />
      ) : null}
    </div>
  )
}

/* ================= App settings ================= */
function AppTab(): React.ReactNode {
  const { settings, refreshMeta } = useApp()
  const [draft, setDraft] = useState(settings)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setDraft(settings)
  }, [settings])

  if (!draft) return <Loading />
  const canManage = can('settings.manage')

  const saveGroup = async (group: 'general' | 'security' | 'notifications' | 'printing'): Promise<void> => {
    setBusy(true)
    try {
      await call('settings.update', { group, patch: draft[group] as unknown as Record<string, unknown> })
      toast('Settings saved.')
      await refreshMeta()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card card-pad">
        <div className="section-title">General</div>
        <div className="form-grid">
          <Field label="Patient code prefix" hint="New patients get codes like DP-00042.">
            <input className="input" disabled={!canManage} value={draft.general.patientCodePrefix} onChange={(e) => setDraft({ ...draft, general: { ...draft.general, patientCodePrefix: e.target.value } })} />
          </Field>
          <Field label="Invoice prefix">
            <input className="input" disabled={!canManage} value={draft.general.invoicePrefix} onChange={(e) => setDraft({ ...draft, general: { ...draft.general, invoicePrefix: e.target.value } })} />
          </Field>
          <Field label="Prescription prefix">
            <input className="input" disabled={!canManage} value={draft.general.rxPrefix} onChange={(e) => setDraft({ ...draft, general: { ...draft.general, rxPrefix: e.target.value } })} />
          </Field>
          <Field label="Timezone"><input className="input" value={draft.general.timezone} disabled /></Field>
        </div>
        {canManage ? <div className="row mt-2" style={{ justifyContent: 'flex-end' }}><Button variant="primary" loading={busy} onClick={() => void saveGroup('general')}>Save general</Button></div> : null}
      </div>

      <div className="card card-pad">
        <div className="section-title">Security</div>
        <div className="form-grid">
          <Field label="Auto-lock after idle (minutes)" hint="0 = never lock automatically.">
            <input className="input" type="number" min={0} max={120} disabled={!canManage} value={draft.security.autoLockMinutes} onChange={(e) => setDraft({ ...draft, security: { ...draft.security, autoLockMinutes: Number(e.target.value) } })} />
          </Field>
          <Field label="Allow overpayment on invoices" hint="Off by default — payments cannot exceed the due amount.">
            <select className="select" disabled={!canManage} value={draft.security.allowOverpayment ? '1' : '0'} onChange={(e) => setDraft({ ...draft, security: { ...draft.security, allowOverpayment: e.target.value === '1' } })}>
              <option value="0">No (recommended)</option>
              <option value="1">Yes, allow advance payments</option>
            </select>
          </Field>
        </div>
        {canManage ? <div className="row mt-2" style={{ justifyContent: 'flex-end' }}><Button variant="primary" loading={busy} onClick={() => void saveGroup('security')}>Save security</Button></div> : null}
      </div>

      <div className="card card-pad">
        <div className="section-title">Notifications</div>
        <div className="form-grid">
          <Field label="Expiry warning (days ahead)">
            <input className="input" type="number" min={1} max={365} disabled={!canManage} value={draft.notifications.expiryDays} onChange={(e) => setDraft({ ...draft, notifications: { ...draft.notifications, expiryDays: Number(e.target.value) } })} />
          </Field>
          {([['appointments', 'New appointments for the day'], ['lowStock', 'Inventory low / out of stock'], ['backup', 'Backup reminders'], ['dues', 'Unpaid invoice dues']] as const).map(([key, label]) => (
            <Field key={key} label={label}>
              <select className="select" disabled={!canManage} value={draft.notifications[key] ? '1' : '0'} onChange={(e) => setDraft({ ...draft, notifications: { ...draft.notifications, [key]: e.target.value === '1' } })}>
                <option value="1">On</option>
                <option value="0">Off</option>
              </select>
            </Field>
          ))}
        </div>
        {canManage ? <div className="row mt-2" style={{ justifyContent: 'flex-end' }}><Button variant="primary" loading={busy} onClick={() => void saveGroup('notifications')}>Save notifications</Button></div> : null}
      </div>

      <div className="card card-pad">
        <div className="section-title">Printing</div>
        <div className="form-grid">
          <Field label="Default paper for documents">
            <select className="select" disabled={!canManage} value={draft.printing.defaultPaper} onChange={(e) => setDraft({ ...draft, printing: { ...draft.printing, defaultPaper: e.target.value } })}>
              <option value="a4">A4</option>
              <option value="a5">A5 (prescription pads)</option>
              <option value="letter">Letter</option>
            </select>
          </Field>
        </div>
        <div className="hint mt-1 row"><Printer size={13} /> Receipts always print on 80 mm thermal paper when available.</div>
        {canManage ? <div className="row mt-2" style={{ justifyContent: 'flex-end' }}><Button variant="primary" loading={busy} onClick={() => void saveGroup('printing')}>Save printing</Button></div> : null}
      </div>
    </div>
  )
}

/* ================= Backup ================= */
function BackupTab(): React.ReactNode {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof call<'backup.status'>>> | null>(null)
  const [list, setList] = useState<Awaited<ReturnType<typeof call<'backup.list'>>>>([])
  const [busy, setBusy] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<number | null>(null)
  const [scheduleOpen, setScheduleOpen] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      const [s, l] = await Promise.all([call('backup.status'), call('backup.list')])
      setStatus(s)
      setList(l)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load backup status.', 'error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label">Last backup</div>
          <div className="stat-value" style={{ fontSize: 16 }}>{status?.lastBackupAt ? formatDateTimeHuman(status.lastBackupAt) : 'never'}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Automatic schedule</div>
          <div className="stat-value" style={{ fontSize: 16 }}>
            {status?.scheduleDays ? `every ${status.scheduleDays} day${status.scheduleDays === 1 ? '' : 's'}` : 'off'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Stored backups</div>
          <div className="stat-value" style={{ fontSize: 16 }}>{list.length}</div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="row row-wrap">
          <Button
            variant="primary" loading={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const rec = await call('backup.create', { type: 'manual' })
                toast(`Backup created and verified (${rec.filename}).`)
                await load()
              } catch (e) {
                toast(e instanceof Error ? e.message : 'Backup failed.', 'error')
              } finally { setBusy(false) }
            }}
          >
            <DatabaseBackup size={15} /> Back up now
          </Button>
          {can('backup.schedule') ? <Button onClick={() => setScheduleOpen(true)}>Schedule settings</Button> : null}
          {can('backup.create') && list.length > 0 ? (
            <Button
              onClick={async () => {
                setBusy(true)
                try {
                  const rec = await call('backup.verify', { id: list[0].id })
                  toast(`Verification: ${rec.status}.`)
                } catch (e) {
                  toast(e instanceof Error ? e.message : 'Failed.', 'error')
                } finally { setBusy(false) }
              }}
            >
              Verify latest
            </Button>
          ) : null}
          <span className="hint">A backup contains the database and all attachments in a single verified zip file.</span>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Backup history</div></div>
        {list.length === 0 ? (
          <EmptyState title="No backups yet" hint="Create your first backup — it takes a few seconds." />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>File</th><th>When</th><th>Type</th><th>Size</th><th>Status</th><th /></tr></thead>
              <tbody>
                {list.map((b) => (
                  <tr key={b.id}>
                    <td className="text-mono text-small">{b.filename}</td>
                    <td className="text-small nowrap">{formatDateTimeHuman(b.createdAt)}</td>
                    <td><span className="badge badge-gray">{b.backupType.replace('_', '-')}</span></td>
                    <td className="num text-small">{(b.sizeBytes / 1024 / 1024).toFixed(1)} MB</td>
                    <td><StatusBadge status={b.status} />{!b.fileExists ? <span className="badge badge-amber" style={{ marginLeft: 6 }}>missing file</span> : null}</td>
                    <td className="nowrap">
                      <Button size="sm" onClick={async () => {
                        setBusy(true)
                        try {
                          const rec = await call('backup.verify', { id: b.id })
                          toast(`Verification: ${rec.status}.`)
                          await load()
                        } catch (e) {
                          toast(e instanceof Error ? e.message : 'Failed.', 'error')
                        } finally { setBusy(false) }
                      }}>
                        Verify
                      </Button>
                      {can('backup.restore') && b.fileExists ? (
                        <Button size="sm" variant="ghost-danger" onClick={() => setRestoreTarget(b.id)}>Restore…</Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {scheduleOpen ? <ScheduleModal status={status} onClose={() => setScheduleOpen(false)} onSaved={load} /> : null}
      {restoreTarget !== null ? (
        <ConfirmDialog
          title="Restore from backup" danger requireTyped="RESTORE" confirmLabel="Restore now"
          message={
            <div className="col">
              <div><b>Everything recorded since this backup will be replaced.</b></div>
              <div className="text-soft text-small mt-1">
                A safety backup of the current data is taken first, so nothing is lost even if you change your mind afterwards.
                After restoring, everyone must sign in again.
              </div>
            </div>
          }
          onConfirm={async () => {
            const result = await call('backup.restore', { id: restoreTarget, confirm: 'RESTORE' })
            if (result.ok) {
              toast('Restore complete — the app will reload.', 'info')
              setTimeout(() => window.location.reload(), 1200)
            }
          }}
          onClose={() => setRestoreTarget(null)}
        />
      ) : null}
    </div>
  )
}

function ScheduleModal({ status, onClose, onSaved }: { status: Awaited<ReturnType<typeof call<'backup.status'>>> | null; onClose: () => void; onSaved: () => Promise<void> }): React.ReactNode {
  const [folder, setFolder] = useState(status?.folder ?? '')
  const [days, setDays] = useState(status?.scheduleDays ?? 0)
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      title="Automatic backup schedule" onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary" loading={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const picked = await call('backup.pickFolder')
                const target = picked.folder ?? folder
                await call('backup.schedule', { folder: target, scheduleDays: days })
                toast('Backup schedule saved.')
                await onSaved()
                onClose()
              } catch (e) {
                toast(e instanceof Error ? e.message : 'Failed.', 'error')
              } finally { setBusy(false) }
            }}
          >
            Save schedule
          </Button>
        </>
      }
    >
      <div className="col">
        <Field label="Backup folder" hint="Choose a folder that is included in your own cloud sync or external drive.">
          <div className="row">
            <input className="input" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder={status?.folder ?? 'Default app folder'} />
          </div>
        </Field>
        <Field label="Run automatically">
          <select className="select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={0}>Off — manual only</option>
            <option value={7}>Every 7 days</option>
            <option value={15}>Every 15 days</option>
            <option value={30}>Every 30 days</option>
          </select>
        </Field>
        <div className="hint row"><HardDriveDownload size={13} /> The folder picker opens when you save. Backups are verified right after creation.</div>
      </div>
    </Modal>
  )
}

/* ================= Danger zone ================= */
function DangerTab(): React.ReactNode {
  const [confirm, setConfirm] = useState<'business' | 'factory' | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card card-pad" style={{ borderColor: '#f3c2bd' }}>
        <div className="row">
          <AlertTriangle size={18} style={{ color: 'var(--danger)' }} />
          <b>These actions are permanent</b>
        </div>
        <p className="text-soft text-small mt-1">
          Both operations take a full safety backup first and record an audit entry with your username. That safety backup is kept in the backup history.
        </p>
      </div>

      <div className="card card-pad">
        <div className="section-title">Delete all business data</div>
        <p className="text-soft text-small">
          Removes every patient, visit, prescription, invoice, payment, appointment and attachment. Users, roles, settings and the treatment catalog are kept.
          Document numbering restarts from 1.
        </p>
        <div className="row mt-2">
          <Button variant="danger" disabled={busy} onClick={() => setConfirm('business')}>Delete all business data…</Button>
        </div>
      </div>

      <div className="card card-pad">
        <div className="section-title">Factory reset</div>
        <p className="text-soft text-small">
          Returns the app to its very first state: business data, users, settings, printer profiles and activation are all erased.
          After the reset the app asks for a new activation code.
        </p>
        <div className="row mt-2">
          <Button variant="danger" disabled={busy} onClick={() => setConfirm('factory')}>Factory reset…</Button>
        </div>
      </div>

      {confirm ? (
        <ConfirmDialog
          title={confirm === 'business' ? 'Delete ALL business data' : 'Factory reset'}
          danger
          requireTyped={confirm === 'business' ? 'DELETE ALL DATA' : 'FACTORY RESET'}
          confirmLabel={confirm === 'business' ? 'Delete everything' : 'Reset the app'}
          message={
            <div className="col">
              <div><b>{confirm === 'business' ? 'Every patient record will be erased.' : 'The entire app returns to first-run state.'}</b></div>
              <div className="text-soft text-small mt-1">A safety backup is created automatically before anything is deleted. This cannot be undone.</div>
            </div>
          }
          onConfirm={async () => {
            setBusy(true)
            try {
              await call('system.deleteBusinessData', {
                scope: confirm,
                confirm: confirm === 'business' ? 'DELETE ALL DATA' : 'FACTORY RESET'
              })
              toast('Operation complete — the app will reload.', 'info')
              setTimeout(() => window.location.reload(), 1400)
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Failed.', 'error')
            } finally {
              setBusy(false)
            }
          }}
          onClose={() => setConfirm(null)}
        />
      ) : null}
    </div>
  )
}

export { money }

/* ================= About ================= */
function AboutTab(): React.ReactNode {
  const [about, setAbout] = useState<Awaited<ReturnType<typeof call<'system.about'>>> | null>(null)
  useEffect(() => {
    void call('system.about').then(setAbout).catch(() => setAbout(null))
  }, [])
  return (
    <div className="card card-pad">
      <div className="section-title">About Dentiva Pro</div>
      {about ? (
        <dl className="kv">
          <dt>Application</dt><dd><b>Dentiva Pro</b> v{about.version}</dd>
          <dt>Created by</dt><dd>{about.creatorName} · {about.creatorEmail}</dd>
          <dt>Database</dt><dd className="text-mono text-small">{about.dbPath}</dd>
          <dt>Operation</dt><dd>Fully offline — patient data never leaves this computer.</dd>
        </dl>
      ) : (
        <Loading />
      )}
      <p className="text-soft text-small mt-2">
        Premium offline dental clinic management software for Bangladesh · Bengali-safe records, prescriptions and invoices ·
        keyboard shortcuts: Ctrl+K search · Ctrl+N new patient · Ctrl+1–9 sidebar · Alt+←/→ history.
      </p>
    </div>
  )
}
