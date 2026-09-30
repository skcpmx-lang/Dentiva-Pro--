import { useCallback, useEffect, useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { call } from '../ipc'
import { can } from '../store'
import { Button, ConfirmDialog, EmptyState, Field, Loading, Modal, Pagination, SearchBar, StatusBadge, money, toast, useDebounced } from '../ui'
import type { Staff } from '@shared/types'

export function StaffPage(): React.ReactNode {
  const [rows, setRows] = useState<Staff[] | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [edit, setEdit] = useState<Partial<Staff> | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Staff | null>(null)
  const q = useDebounced(search)
  const pageSize = 20

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await call('staff.list', { search: q || undefined, page, pageSize })
      setRows(res.rows)
      setTotal(res.total)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load staff.', 'error')
      setRows([])
    }
  }, [q, page])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row">
        <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search staff by name or designation…" />
        <div className="spacer" />
        {can('staff.manage') ? <Button variant="primary" onClick={() => setEdit({ name: '', status: 'active' })}><Plus size={15} /> Add staff</Button> : null}
      </div>

      <div className="card">
        {!rows ? <Loading /> : rows.length === 0 ? (
          <EmptyState title="No staff records" hint="Add receptionists, assistants and technicians." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr><th>Name</th><th>Designation</th><th>Department</th><th>Phone</th><th>Joined</th>{can('staff.manage') ? <th className="num">Salary</th> : null}<th>Status</th><th /></tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <td><b>{s.name}</b></td>
                      <td>{s.designation ?? '—'}</td>
                      <td>{s.department ?? '—'}</td>
                      <td className="text-mono">{s.phone ?? '—'}</td>
                      <td className="text-mono">{s.joiningDate ?? '—'}</td>
                      {can('staff.manage') ? <td className="num">{s.salary !== null ? money(s.salary) : '—'}</td> : null}
                      <td><StatusBadge status={s.status} /></td>
                      <td>
                        {can('staff.manage') ? (
                          <>
                            <Button size="sm" onClick={() => setEdit(s)}><Pencil size={13} /></Button>
                            <Button size="sm" variant="ghost-danger" onClick={() => setDeleteTarget(s)}><Trash2 size={13} /></Button>
                          </>
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

      {edit ? <StaffForm staff={edit} onClose={() => setEdit(null)} onSaved={load} /> : null}
      {deleteTarget ? (
        <ConfirmDialog
          title="Delete staff record" danger confirmLabel="Delete"
          message={<>Delete <b>{deleteTarget.name}</b> from staff? This fails if a user account is linked to this person.</>}
          onConfirm={async () => {
            await call('staff.delete', { id: deleteTarget.id })
            toast('Staff record deleted.')
            await load()
          }}
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}
    </div>
  )
}

function StaffForm({ staff, onClose, onSaved }: { staff: Partial<Staff>; onClose: () => void; onSaved: () => Promise<void> }): React.ReactNode {
  const [form, setForm] = useState({ ...staff, salaryTaka: staff.salary !== null && staff.salary !== undefined ? staff.salary / 100 : '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string, v: unknown): void => setForm((f) => ({ ...f, [k]: v }))
  return (
    <Modal
      title={staff.id ? 'Edit staff' : 'Add staff'} onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary" loading={busy} disabled={!form.name}
            onClick={async () => {
              setBusy(true); setError('')
              try {
                await call('staff.save', {
                  id: form.id, name: form.name ?? '', dob: form.dob || null, gender: form.gender || null,
                  address: form.address || null, bloodGroup: form.bloodGroup || null,
                  phone: form.phone || null, designation: form.designation || null,
                  department: form.department || null,
                  salary: form.salaryTaka === '' ? null : Math.round(Number(form.salaryTaka) * 100),
                  joiningDate: form.joiningDate || null, status: form.status ?? 'active'
                })
                toast('Staff saved.')
                await onSaved()
                onClose()
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed.')
              } finally { setBusy(false) }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Full name" required><input className="input" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} autoFocus /></Field>
        <Field label="Designation"><input className="input" value={form.designation ?? ''} onChange={(e) => set('designation', e.target.value)} placeholder="e.g. Receptionist" /></Field>
        <Field label="Department"><input className="input" value={form.department ?? ''} onChange={(e) => set('department', e.target.value)} /></Field>
        <Field label="Phone"><input className="input" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        {can('staff.manage') ? (
          <Field label="Monthly salary (৳)" hint="Hidden from the audit log."><input className="input text-mono" type="number" min={0} step="0.01" value={form.salaryTaka} onChange={(e) => set('salaryTaka', e.target.value)} /></Field>
        ) : null}
        <Field label="Joining date"><input className="input" type="date" value={form.joiningDate ?? ''} onChange={(e) => set('joiningDate', e.target.value)} /></Field>
        <Field label="Date of birth"><input className="input" type="date" value={form.dob ?? ''} onChange={(e) => set('dob', e.target.value)} /></Field>
        <Field label="Status">
          <select className="select" value={form.status ?? 'active'} onChange={(e) => set('status', e.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
        <Field label="Address" span><input className="input" value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
        {error ? <div className="field-error span-2">{error}</div> : null}
      </div>
    </Modal>
  )
}
