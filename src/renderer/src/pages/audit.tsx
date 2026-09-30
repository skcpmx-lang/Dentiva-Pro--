import { useCallback, useEffect, useState } from 'react'
import { call } from '../ipc'
import { Button, EmptyState, Loading, Pagination, SearchBar, toast, useDebounced } from '../ui'
import { formatDateTimeHuman } from '@shared/dates'
import type { RangeQuery } from '@shared/ipc'

const PRESETS = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'all', label: 'All' }
]

export function AuditPage(): React.ReactNode {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof call<'audit.list'>>>['rows'] | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [preset, setPreset] = useState<RangeQuery['preset']>('30d')
  const [action, setAction] = useState('')
  const [entity, setEntity] = useState('')
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState<number | null>(null)
  const q = useDebounced(search)
  const pageSize = 30

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await call('audit.list', {
        preset, page, pageSize,
        action: action || undefined, entity: entity || undefined,
        search: q || undefined
      })
      setRows(res.rows)
      setTotal(res.total)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load audit log.', 'error')
      setRows([])
    }
  }, [preset, page, action, entity, q])

  useEffect(() => {
    void load()
  }, [load])

  const detailRow = detail !== null ? rows?.find((r) => r.id === detail) : null

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row row-wrap">
        <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search audit entries…" />
        <select className="select" style={{ width: 130 }} value={preset} onChange={(e) => { setPreset(e.target.value as RangeQuery['preset']); setPage(1) }}>
          {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <input className="input" style={{ width: 120 }} placeholder="Action (create)" value={action} onChange={(e) => { setAction(e.target.value); setPage(1) }} />
        <input className="input" style={{ width: 130 }} placeholder="Entity (invoice)" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1) }} />
      </div>

      <div className="card">
        {!rows ? <Loading /> : rows.length === 0 ? (
          <EmptyState title="No audit entries for this filter" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Detail</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="clickable" onClick={() => setDetail(r.id)}>
                      <td className="text-mono text-small nowrap">{formatDateTimeHuman(r.createdAt)}</td>
                      <td>{r.username}</td>
                      <td><span className="badge badge-gray">{r.action}</span></td>
                      <td className="text-mono text-small">{r.entity}{r.entityId ? ` #${r.entityId}` : ''}</td>
                      <td className="text-soft text-small" style={{ maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.context ?? JSON.stringify(r.newValue ?? '').slice(0, 80)}
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

      {detailRow ? (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 620 }}>
            <div className="modal-head">
              <div className="modal-title">Audit entry #{detailRow.id}</div>
              <div className="spacer" />
              <Button size="sm" onClick={() => setDetail(null)}>Close</Button>
            </div>
            <div className="modal-body">
              <dl className="kv">
                <dt>When</dt><dd className="text-mono">{formatDateTimeHuman(detailRow.createdAt)}</dd>
                <dt>User</dt><dd>{detailRow.username}</dd>
                <dt>Action</dt><dd>{detailRow.action}</dd>
                <dt>Entity</dt><dd className="text-mono">{detailRow.entity}{detailRow.entityId ? ` #${detailRow.entityId}` : ''}</dd>
                {detailRow.context ? <dt>Context</dt> : null}
                {detailRow.context ? <dd>{detailRow.context}</dd> : null}
              </dl>
              {detailRow.oldValue ? (
                <>
                  <div className="section-title mt-2">Old value</div>
                  <pre className="text-mono text-small" style={{ background: 'var(--bg-soft)', padding: 10, borderRadius: 8, overflowX: 'auto' }}>{JSON.stringify(detailRow.oldValue, null, 2)}</pre>
                </>
              ) : null}
              {detailRow.newValue ? (
                <>
                  <div className="section-title mt-2">New value</div>
                  <pre className="text-mono text-small" style={{ background: 'var(--bg-soft)', padding: 10, borderRadius: 8, overflowX: 'auto' }}>{JSON.stringify(detailRow.newValue, null, 2)}</pre>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
