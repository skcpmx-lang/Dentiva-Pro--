import { useCallback, useEffect, useState } from 'react'
import { Plus, Printer, Ban, Trash2, Save, Download } from 'lucide-react'
import { call } from '../ipc'
import { can, useApp } from '../store'
import { Button, ConfirmDialog, EmptyState, Field, Loading, Modal, Pagination, SearchBar, StatusBadge, money, toast, useDebounced } from '../ui'
import { todayISO, formatDateHuman } from '@shared/dates'
import { renderInvoice, renderReceipt } from '../print'
import type { Invoice, Payment, Treatment } from '@shared/types'

type Tab = 'invoices' | 'payments'

export function BillingPage(): React.ReactNode {
  const [tab, setTab] = useState<Tab>('invoices')
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="tabs">
        <button className={`tab ${tab === 'invoices' ? 'active' : ''}`} onClick={() => setTab('invoices')}>Invoices</button>
        <button className={`tab ${tab === 'payments' ? 'active' : ''}`} onClick={() => setTab('payments')}>Payments</button>
      </div>
      {tab === 'invoices' ? <InvoicesTab /> : <PaymentsTab />}
    </div>
  )
}

/* ================= Invoices ================= */
function InvoicesTab(): React.ReactNode {
  const [rows, setRows] = useState<Invoice[] | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [detail, setDetail] = useState<Invoice | null>(null)
  const [voidTarget, setVoidTarget] = useState<Invoice | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Invoice | null>(null)
  const q = useDebounced(search)
  const pageSize = 20

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await call('invoice.list', { preset: '30d', search: q || undefined, status: status || undefined, page, pageSize })
      setRows(res.rows)
      setTotal(res.total)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load invoices.', 'error')
      setRows([])
    }
  }, [q, status, page])

  useEffect(() => {
    void load()
  }, [load])

  const print = async (inv: Invoice): Promise<void> => {
    try {
      const full = await call('invoice.get', { id: inv.id })
      const doc = renderInvoice({
        clinic: useApp.getState().clinic, settings: useApp.getState().settings,
        invoiceNo: full.invoiceNo, date: full.invoiceDate,
        patientName: full.patientName, patientCode: full.patientCode, patientPhone: full.patientPhone ?? null,
        lines: full.lines, subtotal: full.subtotal, discount: full.discount,
        total: full.total, paid: full.paidAmount, due: full.dueAmount, status: full.status,
        notes: full.notes, dentistName: full.dentistName ?? null
      })
      const pdf = await call('print.pdf', { html: doc.html, paper: doc.paper, marginMm: doc.marginMm })
      await call('print.print', { pdfUrl: pdf.pdfUrl, silent: true })
      toast(`Sent ${full.invoiceNo} to printer.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Print failed.', 'error')
    }
  }

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row">
        <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search invoices by number or patient…" />
        <div className="spacer" />
        <select className="select" style={{ width: 140 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
          <option value="">All statuses</option>
          <option value="unpaid">Unpaid</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
          <option value="void">Void</option>
        </select>
        {can('invoice.create') ? <Button variant="primary" onClick={() => setShowForm(true)}><Plus size={15} /> New invoice</Button> : null}
      </div>

      <div className="card">
        {!rows ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState title="No invoices in the last 30 days" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr><th>Invoice #</th><th>Date</th><th>Patient</th><th className="num">Total</th><th className="num">Paid</th><th className="num">Due</th><th>Status</th><th /></tr>
                </thead>
                <tbody>
                  {rows.map((inv) => (
                    <tr key={inv.id} className="clickable" onClick={() => setDetail(inv)}>
                      <td className="text-mono"><b>{inv.invoiceNo}</b></td>
                      <td className="text-mono nowrap">{formatDateHuman(inv.invoiceDate)}</td>
                      <td><a href={`#/patients/${inv.patientId}`} onClick={(e) => e.stopPropagation()} style={{ color: 'inherit', fontWeight: 600, textDecoration: 'none' }}>{inv.patientName}</a></td>
                      <td className="num">{money(inv.total)}</td>
                      <td className="num">{money(inv.paidAmount)}</td>
                      <td className="num" style={{ color: inv.dueAmount > 0 ? 'var(--danger)' : undefined }}>{money(inv.dueAmount)}</td>
                      <td><StatusBadge status={inv.status} /></td>
                      <td className="nowrap" onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" onClick={() => void print(inv)}><Printer size={13} /></Button>
                        {can('invoice.void') && inv.status !== 'void' ? (
                          <Button size="sm" variant="ghost-danger" onClick={() => { setVoidTarget(inv); setVoidReason('') }}><Ban size={13} /></Button>
                        ) : null}
                        {can('invoice.delete') && inv.status !== 'void' && inv.paidAmount === 0 ? (
                          <Button size="sm" variant="ghost-danger" onClick={() => setDeleteTarget(inv)}><Trash2 size={13} /></Button>
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

      {showForm ? <InvoiceForm onClose={() => setShowForm(false)} onSaved={load} onOpen={setDetail} /> : null}
      {detail ? <InvoiceDetail invoiceId={detail.id} onClose={() => setDetail(null)} onChanged={load} /> : null}
      {voidTarget ? (
        <Modal
          title={`Void ${voidTarget.invoiceNo}`} onClose={() => setVoidTarget(null)}
          footer={
            <>
              <Button onClick={() => setVoidTarget(null)}>Keep</Button>
              <Button
                variant="danger" disabled={!voidReason.trim()}
                onClick={async () => {
                  await call('invoice.void', { id: voidTarget.id, reason: voidReason.trim() })
                  toast('Invoice voided; linked payments were voided too.')
                  setVoidTarget(null)
                  await load()
                }}
              >
                Void invoice
              </Button>
            </>
          }
        >
          <div className="col">
            <div>
              Voiding an invoice also voids its valid payments and reverses their accounting entries. The due amount is set to zero.
            </div>
            <Field label="Reason (required)" required>
              <textarea className="textarea" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} autoFocus />
            </Field>
          </div>
        </Modal>
      ) : null}
      {deleteTarget ? (
        <ConfirmDialog
          title="Delete draft invoice" danger confirmLabel="Delete"
          message={<>Delete <b>{deleteTarget.invoiceNo}</b>? Only unpaid invoices with zero payments can be deleted.</>}
          onConfirm={async () => {
            await call('invoice.delete', { id: deleteTarget.id })
            toast('Invoice deleted.')
            await load()
          }}
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}
    </div>
  )
}

function InvoiceDetail({ invoiceId, onClose, onChanged }: { invoiceId: number; onClose: () => void; onChanged: () => Promise<void> }): React.ReactNode {
  const [inv, setInv] = useState<Awaited<ReturnType<typeof call<'invoice.get'>>> | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [showPay, setShowPay] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setInv(await call('invoice.get', { id: invoiceId }))
    setPayments(await call('payment.list', { preset: 'all', invoiceId, page: 1, pageSize: 50 }).then((r) => r.rows).catch(() => []))
  }, [invoiceId])

  useEffect(() => {
    void load()
  }, [load])

  if (!inv) return <Modal title="Invoice" onClose={onClose}><Loading /></Modal>

  return (
    <Modal
      title={`${inv.invoiceNo} · ${inv.patientName}`} onClose={onClose} wide
      footer={
        <>
          {can('payment.create') && inv.status !== 'void' && inv.dueAmount > 0 ? (
            <Button variant="primary" onClick={() => setShowPay(true)}><Plus size={14} /> Record payment</Button>
          ) : null}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        <div className="row row-wrap">
          <StatusBadge status={inv.status} />
          <span className="text-faint">{formatDateHuman(inv.invoiceDate)}</span>
          {inv.voidedReason ? <span className="text-danger">Voided: {inv.voidedReason}</span> : null}
          <div className="spacer" />
          <div className="row" style={{ gap: 18 }}>
            <div className="align-right"><div className="text-faint text-small">Total</div><b>{money(inv.total)}</b></div>
            <div className="align-right"><div className="text-faint text-small">Paid</div><b className="text-success">{money(inv.paidAmount)}</b></div>
            <div className="align-right"><div className="text-faint text-small">Due</div><b className={inv.dueAmount > 0 ? 'text-danger' : 'text-success'}>{money(inv.dueAmount)}</b></div>
          </div>
        </div>

        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Description</th><th className="num">Qty</th><th className="num">Unit</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {inv.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.description}</td>
                  <td className="num">{l.quantity}</td>
                  <td className="num">{money(l.unitPrice)}</td>
                  <td className="num"><b>{money(l.lineTotal)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {inv.discount > 0 ? <div className="row" style={{ justifyContent: 'flex-end', gap: 18 }}><span>Discount</span><b>− {money(inv.discount)}</b></div> : null}

        <div>
          <div className="section-title">Payments</div>
          {payments.length === 0 ? (
            <div className="text-faint">No payments recorded.</div>
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Date</th><th className="num">Amount</th><th>Method</th><th>Reference</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className="text-mono">{formatDateHuman(p.paymentDate)}</td>
                      <td className="num"><b>{money(p.amount)}</b></td>
                      <td>{p.method}</td>
                      <td className="text-mono">{p.reference ?? '—'}</td>
                      <td><StatusBadge status={p.status} /></td>
                      <td>
                        {can('payment.void') && p.status === 'valid' ? (
                          <Button
                            size="sm" variant="ghost-danger"
                            onClick={async () => {
                              const reason = window.prompt('Reason for voiding this payment?') ?? ''
                              if (!reason.trim()) return
                              await call('payment.void', { id: p.id, reason: reason.trim() })
                              toast('Payment voided.')
                              await load()
                              await onChanged()
                            }}
                          >
                            <Ban size={13} />
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showPay && inv ? (
        <PaymentForm
          invoice={inv}
          onClose={() => setShowPay(false)}
          onSaved={async () => {
            setShowPay(false)
            await load()
            await onChanged()
          }}
        />
      ) : null}
    </Modal>
  )
}

export function PaymentForm({ invoice, onClose, onSaved }: { invoice: Awaited<ReturnType<typeof call<'invoice.get'>>>; onClose: () => void; onSaved: () => Promise<void> }): React.ReactNode {
  const [amount, setAmount] = useState(invoice.dueAmount / 100)
  const [method, setMethod] = useState('cash')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const payment = await call('payment.create', {
        patientId: invoice.patientId, invoiceId: invoice.id,
        paymentDate: todayISO(), amount: Math.round(amount * 100),
        method, reference: reference.trim() || null
      })
      toast(`Payment of ${money(payment.amount)} recorded.`)
      // silent receipt print
      void (async () => {
        try {
          const [data, patient] = await Promise.all([
            call('payment.receiptData', { id: payment.id }),
            call('patient.get', { id: invoice.patientId })
          ])
          const doc = renderReceipt({
            clinic: useApp.getState().clinic, settings: useApp.getState().settings,
            receiptNo: `RCPT-${String(payment.id).padStart(5, '0')}`,
            date: payment.paymentDate, time: payment.paymentTime ?? '',
            patientName: patient.fullName, patientCode: patient.patientCode,
            invoiceNo: data.invoiceNo, amount: payment.amount, method: payment.method,
            reference: payment.reference ?? null, receivedBy: data.operator
          })
          const pdf = await call('print.pdf', { html: doc.html, paper: doc.paper, marginMm: doc.marginMm })
          await call('print.print', { pdfUrl: pdf.pdfUrl, silent: true })
          toast('Receipt sent to printer.', 'info')
        } catch {
          toast('Payment saved — receipt printing failed.', 'error')
        }
      })()
      await onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to record payment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Payment for ${invoice.invoiceNo}`} onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={amount <= 0} onClick={() => void submit()}>Record payment</Button>
        </>
      }
    >
      <div className="col">
        <div className="row" style={{ justifyContent: 'space-between', background: 'var(--surface-2)', padding: '10px 14px', borderRadius: 8 }}>
          <span>Due amount</span><b>{money(invoice.dueAmount)}</b>
        </div>
        <Field label="Amount (৳)" required>
          <input className="input text-mono" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} autoFocus />
        </Field>
        <Field label="Method" required>
          <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
            {['cash', 'bkash', 'nagad', 'rocket', 'upay', 'bank', 'card', 'other'].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Reference / transaction ID">
          <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. TrxID for mobile money" />
        </Field>
        {error ? <div className="field-error">{error}</div> : null}
      </div>
    </Modal>
  )
}

/* ================= New invoice ================= */
function InvoiceForm({ onClose, onSaved, onOpen }: { onClose: () => void; onSaved: () => Promise<void>; onOpen: (inv: Invoice) => void }): React.ReactNode {
  const [patientSearch, setPatientSearch] = useState('')
  const [patients, setPatients] = useState<{ id: number; patientCode: string; fullName: string }[]>([])
  const [patientId, setPatientId] = useState<number | null>(null)
  const [dentists, setDentists] = useState<Awaited<ReturnType<typeof call<'dentist.list'>>>>([])
  const [dentistId, setDentistId] = useState<number | null>(null)
  const [date, setDate] = useState(todayISO())
  const [discount, setDiscount] = useState(0)
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<{ description: string; quantity: number; unitPrice: number }[]>([{ description: '', quantity: 1, unitPrice: 0 }])
  const [treatments, setTreatments] = useState<{ rows: Treatment[]; total: number }>({ rows: [], total: 0 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void call('dentist.list', { activeOnly: true }).then((d) => { setDentists(d); setDentistId((c) => c ?? d[0]?.id ?? null) }).catch(() => undefined)
    void call('treatment.list', { page: 1, pageSize: 200, activeOnly: true }).then(setTreatments).catch(() => setTreatments({ rows: [], total: 0 }))
  }, [])

  useEffect(() => {
    if (patientId || patientSearch.trim().length < 2) return
    const t = setTimeout(() => {
      void call('patient.list', { preset: 'all', search: patientSearch.trim(), page: 1, pageSize: 8 }).then((r) => setPatients(r.rows)).catch(() => undefined)
    }, 250)
    return () => clearTimeout(t)
  }, [patientSearch, patientId])

  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0)
  const total = Math.max(0, subtotal - Math.min(discount * 100, subtotal))

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const inv = await call('invoice.create', {
        patientId: patientId ?? 0, dentistId: dentistId ?? 0, invoiceDate: date, discount: Math.round(discount * 100), notes: notes || null,
        lines: lines.filter((l) => l.description.trim()).map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice }))
      })
      toast(`Invoice ${inv.invoiceNo} created.`)
      await onSaved()
      onClose()
      onOpen(inv)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create invoice.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="New invoice" onClose={onClose} wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!patientId || lines.filter((l) => l.description.trim()).length === 0} onClick={() => void submit()}>
            <Save size={14} /> Create invoice ({money(total)})
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
                <Button size="sm" onClick={() => { setPatientId(null); setPatientSearch('') }}>Change</Button>
              </div>
            ) : (
              <input className="input" value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} placeholder="Search patient…" autoFocus />
            )}
          </Field>
          <Field label="Dentist">
            <select className="select" value={dentistId ?? ''} onChange={(e) => setDentistId(Number(e.target.value))}>
              <option value="">—</option>
              {dentists.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
            </select>
          </Field>
          <Field label="Date">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Discount (৳)">
            <input className="input text-mono" type="number" min={0} step="0.01" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
          </Field>
        </div>

        <div>
          <div className="section-title">Line items</div>
          <div className="col" style={{ gap: 8 }}>
            {lines.map((l, i) => (
              <div key={i} className="row">
                <input
                  className="input" list="trt-catalog" style={{ flex: 2 }} placeholder="Description"
                  value={l.description}
                  onChange={(e) => {
                    const t = treatments.rows.find((x) => x.name === e.target.value)
                    setLines((ls) => ls.map((x, j) => j === i ? { ...x, description: e.target.value, unitPrice: t ? t.defaultPrice : x.unitPrice } : x))
                  }}
                />
                <datalist id="trt-catalog">
                  {treatments.rows.map((t) => <option key={t.id} value={t.name} />)}
                </datalist>
                <input className="input" style={{ width: 130 }} type="number" min={1} value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, quantity: Math.max(1, Number(e.target.value)) } : x))} />
                <input className="input text-mono" style={{ width: 130 }} type="number" min={0} step="0.01" value={l.unitPrice / 100} onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, unitPrice: Math.round(Number(e.target.value) * 100) } : x))} />
                <div style={{ width: 100, textAlign: 'right' }}><b>{money(l.unitPrice * l.quantity)}</b></div>
                <Button size="sm" variant="ghost-danger" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 size={13} /></Button>
              </div>
            ))}
            <Button size="sm" onClick={() => setLines((ls) => [...ls, { description: '', quantity: 1, unitPrice: 0 }])}><Plus size={13} /> Add line</Button>
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', gap: 20 }}>
          <span>Subtotal <b>{money(subtotal)}</b></span>
          <span>Total <b style={{ fontSize: 16 }}>{money(total)}</b></span>
        </div>
        <Field label="Notes">
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error ? <div className="field-error">{error}</div> : null}
      </div>
    </Modal>
  )
}

/* ================= Payments tab ================= */
function PaymentsTab(): React.ReactNode {
  const [rows, setRows] = useState<Payment[] | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const q = useDebounced(search)
  const pageSize = 20

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await call('payment.list', { preset: '30d', search: q || undefined, page, pageSize })
      setRows(res.rows)
      setTotal(res.total)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load payments.', 'error')
      setRows([])
    }
  }, [q, page])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row">
        <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search payments by patient or reference…" />
        <div className="spacer" />
        {can('payment.view') ? (
          <Button onClick={() => void call('report.export', { key: 'payments_by_method', preset: '30d' }).then((r) => toast(`Exported to ${r.path}`)).catch((e) => toast(e.message, 'error'))}>
            <Download size={15} /> Export
          </Button>
        ) : null}
      </div>
      <div className="card">
        {!rows ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState title="No payments in the last 30 days" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Date</th><th>Patient</th><th>Invoice</th><th className="num">Amount</th><th>Method</th><th>Reference</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td className="text-mono nowrap">{formatDateHuman(p.paymentDate)}</td>
                      <td><b>{p.patientName}</b></td>
                      <td className="text-mono">{p.invoiceNo ?? '—'}</td>
                      <td className="num"><b>{money(p.amount)}</b></td>
                      <td>{p.method}</td>
                      <td className="text-mono">{p.reference ?? '—'}</td>
                      <td><StatusBadge status={p.status} /></td>
                      <td>
                        {can('payment.void') && p.status === 'valid' ? (
                          <Button
                            size="sm" variant="ghost-danger"
                            onClick={async () => {
                              const reason = window.prompt('Reason for voiding this payment?') ?? ''
                              if (!reason.trim()) return
                              await call('payment.void', { id: p.id, reason: reason.trim() })
                              toast('Payment voided.')
                              await load()
                            }}
                          >
                            <Ban size={13} />
                          </Button>
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
    </div>
  )
}

