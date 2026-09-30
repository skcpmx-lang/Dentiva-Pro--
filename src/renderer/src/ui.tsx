import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X, Search, ChevronLeft, ChevronRight, Inbox, CheckCircle2, AlertTriangle, Info } from 'lucide-react'

/* ---------------- Button ---------------- */
export function Button({
  variant = 'ghost', size, block, loading, children, className, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'ghost-danger' | 'link'; size?: 'sm' | 'lg'; block?: boolean; loading?: boolean }) {
  return (
    <button
      className={`btn btn-${variant} ${size ? `btn-${size}` : ''} ${block ? 'btn-block' : ''} ${className ?? ''}`}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : null}
      {children}
    </button>
  )
}

/* ---------------- Field wrappers ---------------- */
export function Field({ label, required, error, hint, children, span }: { label: string; required?: boolean; error?: string; hint?: string; children: ReactNode; span?: boolean }) {
  return (
    <div className={`field ${span ? 'span-2' : ''}`}>
      <label className="field-label">
        {label} {required ? <span className="req">*</span> : null}
      </label>
      {children}
      {error ? <div className="field-error">{error}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  )
}

/* ---------------- Modal ---------------- */
export function Modal({ title, onClose, children, footer, wide, closeOnOverlay = true }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; closeOnOverlay?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-overlay" onMouseDown={closeOnOverlay ? onClose : undefined}>
      <div className={`modal ${wide ? 'wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">{title}</div>
          <div className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  )
}

/* ---------------- Confirm ---------------- */
export function ConfirmDialog({
  title, message, confirmLabel = 'Confirm', danger, requireTyped, onConfirm, onClose
}: { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; requireTyped?: string; onConfirm: () => void | Promise<void>; onClose: () => void }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            disabled={!!requireTyped && typed !== requireTyped}
            loading={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm()
                onClose()
              } finally {
                setBusy(false)
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="col">
        <div>{message}</div>
        {requireTyped ? (
          <div className="field mt-2">
            <label className="field-label">
              Type <b>{requireTyped}</b> to continue
            </label>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus spellCheck={false} />
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

/* ---------------- Table helpers ---------------- */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <Inbox className="icon" size={34} />
      <div style={{ fontWeight: 700, color: 'var(--text-soft)' }}>{title}</div>
      {hint ? <div className="text-small mt-1">{hint}</div> : null}
    </div>
  )
}

export function Loading(): ReactNode {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: '44px 0' }}>
      <div className="spinner" />
    </div>
  )
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total === 0) return null
  return (
    <div className="pagination">
      <span>
        {total.toLocaleString()} record{total === 1 ? '' : 's'}
      </span>
      <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft size={14} />
      </Button>
      <span>
        Page {page} / {pages}
      </span>
      <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        <ChevronRight size={14} />
      </Button>
    </div>
  )
}

export function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="searchbar">
      <Search className="icon" size={16} />
      <input className="input" value={value} placeholder={placeholder ?? 'Search…'} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

/* ---------------- Toasts ---------------- */
type Toast = { id: number; message: string; kind: 'success' | 'error' | 'info' }
let pushToastFn: ((message: string, kind?: Toast['kind']) => void) | null = null
export function toast(message: string, kind: Toast['kind'] = 'success'): void {
  pushToastFn?.(message, kind)
}

export function ToastStack(): ReactNode {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  useEffect(() => {
    pushToastFn = (message, kind = 'success') => {
      const id = nextId.current++
      setToasts((t) => [...t, { id, message, kind }])
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6500 : 3800)
    }
    return () => {
      pushToastFn = null
    }
  }, [])
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'success' ? <CheckCircle2 size={16} /> : t.kind === 'error' ? <AlertTriangle size={16} /> : <Info size={16} />}
          {t.message}
        </div>
      ))}
    </div>
  )
}

/* ---------------- Badge ---------------- */
const badgeColor: Record<string, string> = {
  scheduled: 'badge-blue', confirmed: 'badge-blue', completed: 'badge-green', cancelled: 'badge-red', no_show: 'badge-red', rescheduled: 'badge-amber',
  waiting: 'badge-amber', called: 'badge-blue', in_treatment: 'badge-teal', billing: 'badge-amber', finished: 'badge-green',
  unpaid: 'badge-red', partial: 'badge-amber', paid: 'badge-green', void: 'badge-gray', valid: 'badge-green',
  pending: 'badge-amber', active: 'badge-green', inactive: 'badge-gray', archived: 'badge-gray', verified: 'badge-green', failed: 'badge-red',
  low: 'badge-amber', out: 'badge-red', ok: 'badge-green', depleted: 'badge-gray', open: 'badge-blue', urgent: 'badge-red', normal: 'badge-gray'
}
export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${badgeColor[status] ?? 'badge-gray'}`}>{status.replace(/_/g, ' ')}</span>
}

/* ---------------- Money ---------------- */
export function money(paisa: number | null | undefined): string {
  if (paisa === null || paisa === undefined) return '—'
  return `৳${(paisa / 100).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

/* ---------------- Debounced value ---------------- */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}
