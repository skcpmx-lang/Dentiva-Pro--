import { useCallback, useEffect, useState } from 'react'
import { Plus, PackagePlus, Trash2, AlertTriangle, PackageX, Clock } from 'lucide-react'
import { call } from '../ipc'
import { can } from '../store'
import { Button, ConfirmDialog, EmptyState, Field, Loading, Modal, SearchBar, StatusBadge, money, toast, useDebounced } from '../ui'
import { todayISO, formatDateHuman } from '@shared/dates'
import type { InventoryBatch, InventoryItem, Supplier } from '@shared/types'

type Tab = 'items' | 'suppliers' | 'alerts'

export function InventoryPage(): React.ReactNode {
  const [tab, setTab] = useState<Tab>('items')
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="tabs">
        <button className={`tab ${tab === 'items' ? 'active' : ''}`} onClick={() => setTab('items')}>Items &amp; stock</button>
        <button className={`tab ${tab === 'suppliers' ? 'active' : ''}`} onClick={() => setTab('suppliers')}>Suppliers</button>
        <button className={`tab ${tab === 'alerts' ? 'active' : ''}`} onClick={() => setTab('alerts')}>Alerts</button>
      </div>
      {tab === 'items' ? <ItemsTab /> : tab === 'suppliers' ? <SuppliersTab /> : <AlertsTab />}
    </div>
  )
}

/* ================= Items ================= */
function ItemsTab(): React.ReactNode {
  const [rows, setRows] = useState<InventoryItem[] | null>(null)
  const [search, setSearch] = useState('')
  const [showItem, setShowItem] = useState(false)
  const [detail, setDetail] = useState<number | null>(null)
  const [batchTarget, setBatchTarget] = useState<InventoryItem | null | undefined>(undefined) // undefined = closed, null = picker mode
  const [moveTarget, setMoveTarget] = useState<InventoryItem | null>(null)
  const q = useDebounced(search)

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await call('inventory.items', { search: q || undefined, page: 1, pageSize: 100 })
      setRows(res.rows)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load inventory.', 'error')
      setRows([])
    }
  }, [q])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row">
        <SearchBar value={search} onChange={setSearch} placeholder="Search items by name or SKU…" />
        <div className="spacer" />
        {can('inventory.manage') ? <Button onClick={() => setBatchTarget(null)} variant="ghost"><PackagePlus size={15} /> Add batch</Button> : null}
        {can('inventory.manage') ? <Button variant="primary" onClick={() => setShowItem(true)}><Plus size={15} /> New item</Button> : null}
      </div>

      <div className="card">
        {!rows ? <Loading /> : rows.length === 0 ? (
          <EmptyState title="No inventory items" hint="Add the materials and medicines your clinic stocks." />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Item</th><th>SKU</th><th>Unit</th><th className="num">Stock</th><th>Status</th><th>Alert level</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((it) => (
                  <tr key={it.id} className="clickable" onClick={() => setDetail(it.id)}>
                    <td><b>{it.name}</b>{it.category ? <span className="text-faint text-small"> · {it.category}</span> : null}</td>
                    <td className="text-mono">{it.sku}</td>
                    <td>{it.unit}</td>
                    <td className="num"><b>{it.currentStock}</b></td>
                    <td><StatusBadge status={it.stockStatus} /></td>
                    <td className="text-soft">≤ {it.reorderThreshold}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {can('inventory.manage') ? (
                        <>
                          <Button size="sm" onClick={() => setBatchTarget(it)}>Batch</Button>
                          <Button size="sm" onClick={() => setMoveTarget(it)}>Move</Button>
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

      {showItem ? <ItemForm onClose={() => setShowItem(false)} onSaved={load} /> : null}
      {batchTarget !== undefined ? <BatchForm item={batchTarget} onClose={() => setBatchTarget(undefined)} onSaved={load} /> : null}
      {moveTarget ? <MoveForm item={moveTarget} onClose={() => setMoveTarget(null)} onSaved={load} /> : null}
      {detail !== null ? <ItemDetail id={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  )
}

function ItemForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }): React.ReactNode {
  const [form, setForm] = useState({ name: '', sku: '', category: '', unit: 'box', reorderThreshold: 5, notes: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <Modal
      title="New inventory item" onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary" loading={busy} disabled={!form.name || !form.sku}
            onClick={async () => {
              setBusy(true); setError('')
              try {
                await call('inventory.saveItem', { ...form, category: form.category || null, notes: form.notes || null })
                toast('Item created.')
                await onSaved()
                onClose()
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed.')
              } finally { setBusy(false) }
            }}
          >
            Create
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
        <Field label="SKU" required hint="Stock keeping unit — must be unique."><input className="input" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></Field>
        <Field label="Category"><input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Consumables" /></Field>
        <Field label="Unit">
          <select className="select" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
            {['box', 'piece', 'pack', 'bottle', 'set', 'kit'].map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Field>
        <Field label="Low-stock alert level"><input className="input" type="number" min={0} value={form.reorderThreshold} onChange={(e) => setForm({ ...form, reorderThreshold: Number(e.target.value) })} /></Field>
        {error ? <div className="field-error span-2">{error}</div> : null}
      </div>
    </Modal>
  )
}

function BatchForm({ item, onClose, onSaved }: { item: InventoryItem | null; onClose: () => void; onSaved: () => Promise<void> }): React.ReactNode {
  // item === null → picker mode ("Quick add batch"): the user chooses the item.
  const [items, setItems] = useState<InventoryItem[] | null>(item ? null : null)
  const [itemId, setItemId] = useState<number | null>(item?.id ?? null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [form, setForm] = useState({ supplierId: '', purchaseDate: todayISO(), batchNo: '', expiryDate: '', purchaseCost: 0, qtyPurchased: 1 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    void call('supplier.list').then(setSuppliers).catch(() => setSuppliers([]))
    if (!item) {
      void call('inventory.items', { page: 1, pageSize: 200 })
        .then((r) => setItems(r.rows))
        .catch(() => setItems([]))
    }
  }, [item])
  return (
    <Modal
      title="Add stock batch" onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary" loading={busy} disabled={form.qtyPurchased <= 0 || itemId === null}
            onClick={async () => {
              setBusy(true); setError('')
              try {
                await call('inventory.addBatch', {
                  itemId: itemId ?? 0, supplierId: form.supplierId ? Number(form.supplierId) : null,
                  purchaseDate: form.purchaseDate, batchNo: form.batchNo || null,
                  expiryDate: form.expiryDate || null,
                  purchaseCost: Math.round(form.purchaseCost * 100), qtyPurchased: form.qtyPurchased
                })
                toast('Batch received into stock.')
                await onSaved()
                onClose()
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed.')
              } finally { setBusy(false) }
            }}
          >
            Add batch
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Item" required span>
          {item ? (
            <div className="row" style={{ padding: '8px 0' }}>
              <b>{item.name}</b>
              {item.sku ? <span className="text-faint text-mono">{item.sku}</span> : null}
              <span className="text-faint text-small">current stock: {item.currentStock} {item.unit}</span>
            </div>
          ) : items === null ? (
            <Loading />
          ) : (
            <select className="select" value={itemId ?? ''} onChange={(e) => setItemId(e.target.value ? Number(e.target.value) : null)}>
              <option value="" disabled>{items.length === 0 ? 'No inventory items exist yet' : 'Choose an item…'}</option>
              {items.map((it) => <option key={it.id} value={it.id}>{it.name}{it.sku ? ` (${it.sku})` : ''} — stock {it.currentStock}</option>)}
            </select>
          )}
        </Field>
        <Field label="Supplier">
          <select className="select" value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
            <option value="">—</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Purchase date" required><input className="input" type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} /></Field>
        <Field label="Batch no."><input className="input" value={form.batchNo} onChange={(e) => setForm({ ...form, batchNo: e.target.value })} /></Field>
        <Field label="Expiry date"><input className="input" type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} /></Field>
        <Field label="Purchase cost (৳) per unit"><input className="input text-mono" type="number" min={0} step="0.01" value={form.purchaseCost} onChange={(e) => setForm({ ...form, purchaseCost: Number(e.target.value) })} /></Field>
        <Field label="Quantity received" required><input className="input" type="number" min={1} value={form.qtyPurchased} onChange={(e) => setForm({ ...form, qtyPurchased: Number(e.target.value) })} /></Field>
        {error ? <div className="field-error span-2">{error}</div> : null}
      </div>
    </Modal>
  )
}

function MoveForm({ item, onClose, onSaved }: { item: InventoryItem; onClose: () => void; onSaved: () => Promise<void> }): React.ReactNode {
  const [type, setType] = useState<'usage' | 'damaged' | 'expired' | 'adjust'>('usage')
  const [quantity, setQuantity] = useState(1)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const adjust = type === 'adjust'
  return (
    <Modal
      title={`Stock movement — ${item.name}`} onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary" loading={busy}
            onClick={async () => {
              setBusy(true); setError('')
              try {
                await call('inventory.move', { itemId: item.id, type, quantity, reason: reason || null })
                toast('Stock movement recorded.')
                await onSaved()
                onClose()
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed.')
              } finally { setBusy(false) }
            }}
          >
            Record movement
          </Button>
        </>
      }
    >
      <div className="col">
        <div className="row" style={{ background: 'var(--surface-2)', padding: '9px 14px', borderRadius: 8, justifyContent: 'space-between' }}>
          <span>Current stock</span><b>{item.currentStock} {item.unit}</b>
        </div>
        <Field label="Movement type" required>
          <select className="select" value={type} onChange={(e) => setType(e.target.value as 'usage')}>
            <option value="usage">Usage (consume from stock)</option>
            <option value="damaged">Damaged</option>
            <option value="expired">Expired</option>
            <option value="adjust">Adjust (set absolute count)</option>
          </select>
        </Field>
        <Field label={adjust ? 'New counted quantity' : 'Quantity'} required hint={adjust ? 'Physical count result — batch quantity is set to this number.' : 'Units to remove. Stock can never go negative.'}>
          <input className="input" type="number" min={0} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} autoFocus />
        </Field>
        <Field label="Reason / note"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Chairside consumption, physical count" /></Field>
        {error ? <div className="field-error">{error}</div> : null}
      </div>
    </Modal>
  )
}

function ItemDetail({ id, onClose }: { id: number; onClose: () => void }): React.ReactNode {
  const [data, setData] = useState<Awaited<ReturnType<typeof call<'inventory.item'>>> | null>(null)
  useEffect(() => {
    void call('inventory.item', { id }).then(setData).catch(() => setData(null))
  }, [id])
  return (
    <Modal title={data ? data.item.name : 'Item'} onClose={onClose} wide>
      {!data ? <Loading /> : (
        <div className="col" style={{ gap: 16 }}>
          <div className="row">
            <span className="text-mono">{data.item.sku}</span>
            <StatusBadge status={data.item.stockStatus} />
            <div className="spacer" />
            <b>{data.item.currentStock} {data.item.unit}</b>
          </div>
          <div>
            <div className="section-title">Batches (FIFO consumption)</div>
            <table className="tbl">
              <thead><tr><th>Batch</th><th>Purchased</th><th>Expiry</th><th className="num">Qty</th><th>Status</th></tr></thead>
              <tbody>
                {data.batches.map((b: InventoryBatch) => (
                  <tr key={b.id}>
                    <td className="text-mono">{b.batchNo ?? `#${b.id}`}</td>
                    <td className="text-mono">{formatDateHuman(b.purchaseDate)}</td>
                    <td className="text-mono">{b.expiryDate ? formatDateHuman(b.expiryDate) : '—'}</td>
                    <td className="num">{b.qtyCurrent}</td>
                    <td><StatusBadge status={b.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="section-title">Recent movements</div>
            <table className="tbl">
              <thead><tr><th>When</th><th>Type</th><th className="num">Qty</th><th>Reason</th></tr></thead>
              <tbody>
                {data.movements.slice(0, 15).map((m) => (
                  <tr key={m.id}>
                    <td className="text-mono text-small">{m.createdAt?.replace('T', ' ').slice(0, 16) ?? ''}</td>
                    <td><span className="badge badge-gray">{m.type}</span></td>
                    <td className="num">{m.quantity}</td>
                    <td className="text-soft text-small">{m.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  )
}

/* ================= Suppliers ================= */
function SuppliersTab(): React.ReactNode {
  const [rows, setRows] = useState<Supplier[] | null>(null)
  const [edit, setEdit] = useState<Partial<Supplier> | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setRows(await call('supplier.list').catch(() => []))
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="col" style={{ gap: 14 }}>
      {can('supplier.manage') ? (
        <div className="row"><div className="spacer" /><Button variant="primary" onClick={() => setEdit({ name: '' })}><Plus size={15} /> New supplier</Button></div>
      ) : null}
      <div className="card">
        {!rows ? <Loading /> : rows.length === 0 ? <EmptyState title="No suppliers yet" /> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Name</th><th>Contact person</th><th>Phone</th><th>Address</th><th /></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td><b>{s.name}</b></td>
                    <td>{s.contactPerson ?? '—'}</td>
                    <td className="text-mono">{s.phone ?? '—'}</td>
                    <td className="text-soft">{s.address ?? '—'}</td>
                    <td>
                      {can('supplier.manage') ? (
                        <>
                          <Button size="sm" onClick={() => setEdit(s)}>Edit</Button>
                          <Button size="sm" variant="ghost-danger" onClick={() => setDeleteTarget(s)}><Trash2 size={13} /></Button>
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
        <Modal
          title={edit.id ? 'Edit supplier' : 'New supplier'} onClose={() => setEdit(null)}
          footer={
            <>
              <Button onClick={() => setEdit(null)}>Cancel</Button>
              <Button
                variant="primary" disabled={!edit.name}
                onClick={async () => {
                  await call('supplier.save', {
                    id: edit.id, name: edit.name ?? '', notes: edit.notes ?? null,
                    contactPerson: edit.contactPerson || null, phone: edit.phone || null, address: edit.address || null,
                    isActive: edit.isActive ?? true
                  })
                  toast('Supplier saved.')
                  setEdit(null)
                  await load()
                }}
              >
                Save
              </Button>
            </>
          }
        >
          <div className="form-grid">
            <Field label="Name" required><input className="input" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
            <Field label="Contact person"><input className="input" value={edit.contactPerson ?? ''} onChange={(e) => setEdit({ ...edit, contactPerson: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" value={edit.phone ?? ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Address"><input className="input" value={edit.address ?? ''} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
          </div>
        </Modal>
      ) : null}
      {deleteTarget ? (
        <ConfirmDialog
          title="Delete supplier" danger confirmLabel="Delete"
          message={<>Delete <b>{deleteTarget.name}</b>? Batches linked to this supplier will keep their history but lose the link.</>}
          onConfirm={async () => {
            await call('supplier.delete', { id: deleteTarget.id })
            toast('Supplier deleted.')
            await load()
          }}
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}
    </div>
  )
}

/* ================= Alerts ================= */
function AlertsTab(): React.ReactNode {
  const [data, setData] = useState<Awaited<ReturnType<typeof call<'inventory.alerts'>>> | null>(null)
  useEffect(() => {
    void call('inventory.alerts').then(setData).catch(() => setData(null))
  }, [])
  if (!data) return <Loading />
  const empty = data.lowStock.length + data.outOfStock.length + data.expiringSoon.length + data.expired.length === 0
  return (
    <div className="col" style={{ gap: 14 }}>
      {empty ? (
        <div className="card"><EmptyState title="All good — no stock alerts" hint="Alerts appear when items run low or batches near expiry." /></div>
      ) : (
        <>
          {data.outOfStock.length > 0 ? <AlertCard icon={<PackageX size={16} />} title="Out of stock" color="danger" items={data.outOfStock.map((i) => `${i.name} (${i.sku})`)} /> : null}
          {data.lowStock.length > 0 ? <AlertCard icon={<AlertTriangle size={16} />} title="Low stock" color="amber" items={data.lowStock.map((i) => `${i.name} — ${i.currentStock} ${i.unit} left (alert at ${i.reorderThreshold})`)} /> : null}
          {data.expired.length > 0 ? <AlertCard icon={<PackageX size={16} />} title="Expired batches" color="danger" items={data.expired.map((b) => `${b.itemName} · batch ${b.batchNo ?? b.id} expired ${b.expiryDate}`)} /> : null}
          {data.expiringSoon.length > 0 ? <AlertCard icon={<Clock size={16} />} title="Expiring soon" color="amber" items={data.expiringSoon.map((b) => `${b.itemName} · batch ${b.batchNo ?? b.id} expires ${b.expiryDate} (${b.daysToExpiry} days)`)} /> : null}
        </>
      )}
    </div>
  )
}

function AlertCard({ icon, title, color, items }: { icon: React.ReactNode; title: string; color: 'danger' | 'amber'; items: string[] }): React.ReactNode {
  return (
    <div className="card">
      <div className="card-head">
        <span className={`badge ${color === 'danger' ? 'badge-red' : 'badge-amber'}`}>{icon} {title} · {items.length}</span>
      </div>
      <div style={{ padding: '6px 0' }}>
        {items.map((text, i) => (
          <div key={i} className="row" style={{ padding: '7px 18px', borderBottom: '1px solid var(--border)' }}>{text}</div>
        ))}
      </div>
    </div>
  )
}

export { money }
