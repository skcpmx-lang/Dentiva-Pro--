import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, KeyRound, Trash2, ShieldCheck } from 'lucide-react'
import { call } from '../ipc'
import { useApp, can } from '../store'
import { Button, ConfirmDialog, EmptyState, Field, Loading, Modal, StatusBadge, toast } from '../ui'
import { formatDateTimeHuman } from '@shared/dates'
import { PERMISSIONS, type Permission } from '@shared/permissions'
import type { Role } from '@shared/types'
import type { UserRecord } from '@shared/ipc'

type Tab = 'users' | 'roles'

export function AccessPage(): React.ReactNode {
  const [tab, setTab] = useState<Tab>('users')
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="tabs">
        <button className={`tab ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>Users</button>
        <button className={`tab ${tab === 'roles' ? 'active' : ''}`} onClick={() => setTab('roles')}>Roles &amp; permissions</button>
      </div>
      {tab === 'users' ? <UsersTab /> : <RolesTab />}
    </div>
  )
}

/* ================= Users ================= */
function UsersTab(): React.ReactNode {
  const [rows, setRows] = useState<UserRecord[] | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [edit, setEdit] = useState<(Partial<UserRecord> & { password?: string }) | null>(null)
  const [statusTarget, setStatusTarget] = useState<UserRecord | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const [users, r] = await Promise.all([call('user.list'), call('role.list')])
      setRows(users)
      setRoles(r)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load users.', 'error')
      setRows([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="col" style={{ gap: 14 }}>
      {can('user.manage') ? (
        <div className="row"><div className="spacer" /><Button variant="primary" onClick={() => setEdit({ username: '', displayName: '', roleId: roles[0]?.id })}><Plus size={15} /> New user</Button></div>
      ) : null}
      <div className="card">
        {!rows ? <Loading /> : rows.length === 0 ? <EmptyState title="No users" /> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Username</th><th>Name</th><th>Role</th><th>Linked staff</th><th>Last login</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td className="text-mono"><b>{u.username}</b>{u.mustChangePassword ? <span className="badge badge-amber" style={{ marginLeft: 8 }}>must change password</span> : null}</td>
                    <td>{u.displayName}</td>
                    <td><span className="badge badge-teal">{u.roleName}</span></td>
                    <td className="text-soft">{u.staffName ?? '—'}</td>
                    <td className="text-small text-faint">{u.lastLoginAt ? formatDateTimeHuman(u.lastLoginAt) : 'never'}</td>
                    <td><StatusBadge status={u.isActive ? 'active' : 'inactive'} /></td>
                    <td>
                      {can('user.manage') ? (
                        <>
                          <Button size="sm" onClick={() => setEdit({ ...u, password: '' })}><KeyRound size={13} /></Button>
                          <Button
                            size="sm" variant={u.isActive ? 'ghost-danger' : 'ghost'}
                            onClick={() => setStatusTarget(u)}
                            disabled={!u.isActive && u.id === useApp.getState().session?.user.id}
                          >
                            {u.isActive ? 'Deactivate' : 'Activate'}
                          </Button>
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

      {edit ? <UserForm user={edit} roles={roles} onClose={() => setEdit(null)} onSaved={load} /> : null}
      {statusTarget ? (
        <ConfirmDialog
          title={statusTarget.isActive ? 'Deactivate user' : 'Activate user'}
          message={statusTarget.isActive
            ? <>Deactivating <b>{statusTarget.username}</b> immediately signs them out everywhere.</>
            : <>Reactivate <b>{statusTarget.username}</b>?</>}
          danger={statusTarget.isActive}
          confirmLabel={statusTarget.isActive ? 'Deactivate' : 'Activate'}
          onConfirm={async () => {
            await call('user.setStatus', { id: statusTarget.id, isActive: !statusTarget.isActive })
            toast(statusTarget.isActive ? 'User deactivated.' : 'User reactivated.')
            await load()
          }}
          onClose={() => setStatusTarget(null)}
        />
      ) : null}
    </div>
  )
}

function UserForm({ user, roles, onClose, onSaved }: { user: Partial<UserRecord> & { password?: string }; roles: Role[]; onClose: () => void; onSaved: () => Promise<void> }): React.ReactNode {
  const [staff, setStaff] = useState<{ id: number; name: string }[]>([])
  const [form, setForm] = useState({ ...user, password: user.password ?? '', staffId: user.staffId ?? null })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void call('staff.list', { page: 1, pageSize: 100 }).then((r) => setStaff(r.rows.map((s) => ({ id: s.id, name: s.name })))).catch(() => setStaff([]))
  }, [])

  return (
    <Modal
      title={user.id ? `Edit user — ${user.username}` : 'New user'} onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary" loading={busy} disabled={!form.username || !form.roleId || (!user.id && !form.password)}
            onClick={async () => {
              setBusy(true); setError('')
              try {
                await call('user.save', {
                  id: form.id, username: form.username ?? '', displayName: form.displayName || form.username || '',
                  roleId: form.roleId ?? roles[0]?.id ?? 0, staffId: form.staffId, isActive: form.isActive ?? true,
                  password: form.password || undefined
                })
                toast('User saved.')
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
        <Field label="Username" required><input className="input" value={form.username ?? ''} disabled={!!user.id} onChange={(e) => setForm({ ...form, username: e.target.value })} autoFocus spellCheck={false} /></Field>
        <Field label="Display name" required><input className="input" value={form.displayName ?? ''} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
        <Field label="Role" required>
          <select className="select" value={form.roleId ?? ''} onChange={(e) => setForm({ ...form, roleId: Number(e.target.value) })}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="Link to staff record">
          <select className="select" value={form.staffId ?? ''} onChange={(e) => setForm({ ...form, staffId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">—</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field
          label={user.id ? 'Reset password (leave blank to keep)' : 'Password'} required={!user.id}
          hint="At least 8 characters with a letter and a digit. Setting a new one requires a change at next sign-in."
        >
          <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        {error ? <div className="field-error span-2">{error}</div> : null}
      </div>
    </Modal>
  )
}

/* ================= Roles ================= */
function RolesTab(): React.ReactNode {
  const [roles, setRoles] = useState<Role[] | null>(null)
  const [edit, setEdit] = useState<Partial<Role> | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setRoles(await call('role.list').catch(() => []))
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const groups = useMemo(() => {
    const map = new Map<string, Permission[]>()
    for (const p of PERMISSIONS) {
      const g = p.split('.')[0]
      map.set(g, [...(map.get(g) ?? []), p])
    }
    return [...map.entries()]
  }, [])

  return (
    <div className="col" style={{ gap: 14 }}>
      {can('role.manage') ? (
        <div className="row"><div className="spacer" /><Button variant="primary" onClick={() => setEdit({ name: '', permissions: ['patient.view'] })}><Plus size={15} /> New role</Button></div>
      ) : null}
      <div className="card">
        {!roles ? <Loading /> : roles.length === 0 ? <EmptyState title="No roles" /> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Role</th><th>Description</th><th className="num">Permissions</th><th>Source</th><th /></tr></thead>
              <tbody>
                {roles.map((r) => (
                  <tr key={r.id}>
                    <td><b>{r.name}</b>{r.name === 'Owner' ? <span className="badge badge-teal" style={{ marginLeft: 8 }}>built-in</span> : null}</td>
                    <td className="text-soft">{r.description ?? '—'}</td>
                    <td className="num">{r.permissions.length} / {PERMISSIONS.length}</td>
                    <td className="text-faint text-small">{r.isSystem ? 'System' : 'Custom'}</td>
                    <td>
                      {can('role.manage') && r.name !== 'Owner' ? (
                        <>
                          <Button size="sm" onClick={() => setEdit(r)}><ShieldCheck size={13} /> Edit</Button>
                          <Button size="sm" variant="ghost-danger" onClick={() => setDeleteTarget(r)}><Trash2 size={13} /></Button>
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

      {edit ? (
        <RoleForm role={edit} groups={groups} onClose={() => setEdit(null)} onSaved={load} />
      ) : null}
      {deleteTarget ? (
        <ConfirmDialog
          title="Delete role" danger confirmLabel="Delete role"
          message={<>Delete <b>{deleteTarget.name}</b>? Fails while any user still has this role.</>}
          onConfirm={async () => {
            await call('role.delete', { id: deleteTarget.id })
            toast('Role deleted.')
            await load()
          }}
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}
    </div>
  )
}

function RoleForm({ role, groups, onClose, onSaved }: { role: Partial<Role>; groups: [string, Permission[]][]; onClose: () => void; onSaved: () => Promise<void> }): React.ReactNode {
  const [name, setName] = useState(role.name ?? '')
  const [description, setDescription] = useState(role.description ?? '')
  const [perms, setPerms] = useState<Set<string>>(new Set(role.permissions ?? []))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const toggle = (p: string): void => {
    setPerms((s) => {
      const next = new Set(s)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })
  }
  const toggleGroup = (list: Permission[], on: boolean): void => {
    setPerms((s) => {
      const next = new Set(s)
      for (const p of list) {
        if (on) next.add(p)
        else next.delete(p)
      }
      return next
    })
  }

  return (
    <Modal
      title={role.id ? `Edit role — ${role.name}` : 'New role'} onClose={onClose} wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary" loading={busy} disabled={!name || perms.size === 0}
            onClick={async () => {
              setBusy(true); setError('')
              try {
                await call('role.save', { id: role.id, name: name.trim(), description: description || null, permissions: [...perms] })
                toast('Role saved.')
                await onSaved()
                onClose()
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed.')
              } finally { setBusy(false) }
            }}
          >
            Save role ({perms.size} permissions)
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        <div className="form-grid">
          <Field label="Role name" required><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus disabled={role.name === 'Owner'} /></Field>
          <Field label="Description"><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>
        <div className="col" style={{ gap: 10 }}>
          {groups.map(([group, list]) => {
            const on = list.filter((p) => perms.has(p)).length
            return (
              <div key={group} className="card card-pad" style={{ boxShadow: 'none' }}>
                <div className="row mb-1">
                  <b style={{ textTransform: 'capitalize' }}>{group}</b>
                  <span className="text-faint text-small">{on}/{list.length}</span>
                  <div className="spacer" />
                  <Button size="sm" onClick={() => toggleGroup(list, on < list.length)}>{on < list.length ? 'Select all' : 'Clear'}</Button>
                </div>
                <div className="row row-wrap">
                  {list.map((p) => (
                    <label key={p} className="row text-small" style={{ gap: 5, width: 175 }}>
                      <input type="checkbox" checked={perms.has(p)} onChange={() => toggle(p)} />
                      <code style={{ fontSize: 11 }}>{p}</code>
                    </label>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        {error ? <div className="field-error">{error}</div> : null}
      </div>
    </Modal>
  )
}
