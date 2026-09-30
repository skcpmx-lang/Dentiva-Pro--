import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { call } from '../ipc'
import { can } from '../store'
import { Button, ConfirmDialog, EmptyState, Field, Loading, Modal, Pagination, money, toast } from '../ui'
import { todayISO, formatDateHuman } from '@shared/dates'
import type { AccountingCategory, FinancialTxn } from '@shared/types'

export function AccountingPage(): React.ReactNode {
  const [rows, setRows] = useState<FinancialTxn[] | null>(null)
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof call<'accounting.summary'>>> | null>(null)
  const [categories, setCategories] = useState<AccountingCategory[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [kind, setKind] = useState('')
  const [showTxn, setShowTxn] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<FinancialTxn | null>(null)
  const [showCat, setShowCat] = useState(false)
  const pageSize = 20

  const load = useCallback(async (): Promise<void> => {
    try {
      const [res, sum, cats] = await Promise.all([
        call('accounting.list', { preset: '30d', kind: kind || undefined, page, pageSize }),
        call('accounting.summary', { preset: '30d' }),
        call('accounting.categories')
      ])
      setRows(res.rows)
      setTotal(res.total)
      setSummary(sum)
      setCategories(cats)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load accounting.', 'error')
      setRows([])
    }
  }, [kind, page])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="stat-grid">
        <div className="stat"><div className="stat-label">Income (30 days)</div><div className="stat-value text-success">{money(summary?.income ?? 0)}</div></div>
        <div className="stat"><div className="stat-label">Expenses (30 days)</div><div className="stat-value text-danger">{money(summary?.expense ?? 0)}</div></div>
        <div className="stat"><div className="stat-label">Net</div><div className="stat-value" style={{ color: (summary?.net ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>{money(summary?.net ?? 0)}</div></div>
      </div>

      <div className="row">
        <h1 style={{ margin: 0, fontSize: 18 }}>Transactions</h1>
        <div className="spacer" />
        <select className="select" style={{ width: 130 }} value={kind} onChange={(e) => { setKind(e.target.value); setPage(1) }}>
          <option value="">All</option>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
        </select>
        {can('accounting.manage') ? <Button onClick={() => setShowCat(true)}>Categories</Button> : null}
        {can('accounting.manage') ? <Button variant="primary" onClick={() => setShowTxn(true)}><Plus size={15} /> Record transaction</Button> : null}
      </div>

      <div className="card">
        {!rows ? <Loading /> : rows.length === 0 ? (
          <EmptyState title="No manual transactions in the last 30 days" hint="Payment-driven income is added automatically when payments are recorded." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr><th>Date</th><th>Description</th><th>Category</th><th>Method</th><th>Reference</th><th className="num">Amount</th><th /></tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id}>
                      <td className="text-mono nowrap">{formatDateHuman(t.txnDate)}</td>
                      <td>
                        <b>{t.description ?? '—'}</b>
                        {t.paymentId ? <span className="badge badge-teal" style={{ marginLeft: 8 }}>auto · payment</span> : null}
                      </td>
                      <td>{t.categoryName}</td>
                      <td>{t.method}</td>
                      <td className="text-mono">{t.reference ?? '—'}</td>
                      <td className="num" style={{ color: t.kind === 'income' ? 'var(--success)' : 'var(--danger)' }}>
                        {t.kind === 'income' ? '+' : '−'} {money(t.amount)}
                      </td>
                      <td>
                        {can('accounting.manage') && !t.paymentId ? (
                          <Button size="sm" variant="ghost-danger" onClick={() => setDeleteTarget(t)}><Trash2 size={13} /></Button>
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

      {showTxn ? <TxnForm categories={categories} onClose={() => setShowTxn(false)} onSaved={load} /> : null}
      {showCat ? <CategoriesModal categories={categories} onClose={() => setShowCat(false)} onSaved={load} /> : null}
      {deleteTarget ? (
        <ConfirmDialog
          title="Delete transaction" danger confirmLabel="Delete"
          message={<>Delete this {deleteTarget.kind} of <b>{money(deleteTarget.amount)}</b>?</>}
          onConfirm={async () => {
            await call('accounting.delete', { id: deleteTarget.id })
            toast('Transaction deleted.')
            await load()
          }}
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}
    </div>
  )
}

function TxnForm({ categories, onClose, onSaved }: { categories: AccountingCategory[]; onClose: () => void; onSaved: () => Promise<void> }): React.ReactNode {
  const [kind, setKind] = useState<'income' | 'expense'>('expense')
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [amount, setAmount] = useState(0)
  const [date, setDate] = useState(todayISO())
  const [method, setMethod] = useState('cash')
  const [description, setDescription] = useState('')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const relevant = categories.filter((c) => c.kind === kind)
  return (
    <Modal
      title="Record transaction" onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary" loading={busy} disabled={!categoryId || amount <= 0}
            onClick={async () => {
              setBusy(true); setError('')
              try {
                await call('accounting.save', {
                  kind, categoryId: categoryId ?? 0, txnDate: date,
                  amount: Math.round(amount * 100), method: method as 'cash',
                  description: description || null, reference: reference || null
                })
                toast('Transaction recorded.')
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
        <Field label="Type" required>
          <select className="select" value={kind} onChange={(e) => { setKind(e.target.value as 'income'); setCategoryId(null) }}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </Field>
        <Field label="Category" required>
          <select className="select" value={categoryId ?? ''} onChange={(e) => setCategoryId(Number(e.target.value))}>
            <option value="">Select…</option>
            {relevant.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Amount (৳)" required><input className="input text-mono" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} autoFocus /></Field>
        <Field label="Date" required><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Method" required>
          <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
            {['cash', 'bank', 'card', 'bkash', 'nagad', 'rocket', 'upay', 'other'].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Reference"><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field label="Description" span><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Gloves purchase, rent share" /></Field>
        {error ? <div className="field-error span-2">{error}</div> : null}
      </div>
    </Modal>
  )
}

function CategoriesModal({ categories, onClose, onSaved }: { categories: AccountingCategory[]; onClose: () => void; onSaved: () => Promise<void> }): React.ReactNode {
  const [name, setName] = useState('')
  const [catKind, setCatKind] = useState<'income' | 'expense'>('expense')
  return (
    <Modal
      title="Accounting categories" onClose={onClose}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="col" style={{ gap: 12 }}>
        <table className="tbl">
          <thead><tr><th>Name</th><th>Kind</th><th>Source</th></tr></thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td><span className={`badge ${c.kind === 'income' ? 'badge-green' : 'badge-amber'}`}>{c.kind}</span></td>
                <td className="text-faint text-small">{c.isSystem ? 'System (locked)' : 'Custom'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="section-title">Add category</div>
        <div className="row">
          <input className="input" style={{ flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lab Fee" />
          <select className="select" style={{ width: 120 }} value={catKind} onChange={(e) => setCatKind(e.target.value as 'income')}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
          <Button
            variant="primary" disabled={!name.trim()}
            onClick={async () => {
              await call('accounting.saveCategory', { name: name.trim(), kind: catKind })
              toast('Category added.')
              setName('')
              await onSaved()
            }}
          >
            Add
          </Button>
        </div>
      </div>
    </Modal>
  )
}
