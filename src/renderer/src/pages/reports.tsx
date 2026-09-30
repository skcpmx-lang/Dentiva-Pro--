import { useCallback, useEffect, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { call } from '../ipc'
import { useApp, can } from '../store'
import { Button, EmptyState, Loading, toast } from '../ui'
import { renderReport } from '@shared/print'
import type { ReportDescriptor, ReportResult } from '@shared/ipc'

const PRESETS = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: '1y', label: 'Last 12 months' },
  { id: 'all', label: 'All time' }
]

export function ReportsPage(): React.ReactNode {
  const [reports, setReports] = useState<ReportDescriptor[]>([])
  const [activeKey, setActiveKey] = useState('')
  const [preset, setPreset] = useState('30d')
  const [result, setResult] = useState<ReportResult | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    void call('report.list').then((r) => {
      setReports(r)
      const first = r.find((x) => can(x.requires[0]))
      if (first) setActiveKey(first.key)
    }).catch(() => setReports([]))
  }, [])

  const run = useCallback(async (): Promise<void> => {
    if (!activeKey) return
    setLoading(true)
    setResult(null)
    try {
      setResult(await call('report.run', { key: activeKey, preset }))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Report failed.', 'error')
    } finally {
      setLoading(false)
    }
  }, [activeKey, preset])

  useEffect(() => {
    void run()
  }, [run])

  const print = async (): Promise<void> => {
    if (!result) return
    const doc = renderReport({
      clinic: useApp.getState().clinic,
      title: result.title,
      periodLabel: result.summary.find((s) => s.label === 'Period')?.value ?? '',
      columns: result.columns.map((c) => ({ key: c.key, label: c.label })),
      rows: result.rows,
      summary: result.summary.filter((s) => s.label !== 'Period')
    })
    const pdf = await call('print.pdf', { html: doc.html, paper: doc.paper, marginMm: doc.marginMm })
    await call('print.print', { pdfUrl: pdf.pdfUrl, silent: true })
    toast('Report sent to printer.')
  }

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card card-pad">
        <div className="row row-wrap">
          <select className="select" style={{ width: 260 }} value={activeKey} onChange={(e) => setActiveKey(e.target.value)}>
            {reports.map((r) => <option key={r.key} value={r.key}>{r.title}</option>)}
          </select>
          <select className="select" style={{ width: 160 }} value={preset} onChange={(e) => setPreset(e.target.value)}>
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <Button variant="primary" onClick={() => void run()}>Run report</Button>
          <div className="spacer" />
          {result ? (
            <>
              <Button onClick={() => void print()}><Printer size={15} /> Print</Button>
              {can('report.export') ? (
                <Button onClick={() => void call('report.export', { key: activeKey, preset }).then((r) => toast(`Exported to ${r.path}`)).catch((e) => toast(e.message, 'error'))}>
                  <Download size={15} /> Export CSV
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
        {reports.find((r) => r.key === activeKey)?.description ? (
          <div className="hint mt-1">{reports.find((r) => r.key === activeKey)?.description}</div>
        ) : null}
      </div>

      <div className="card">
        {loading ? <Loading /> : !result ? (
          <EmptyState title="Choose a report and press Run" />
        ) : (
          <>
            <div className="card-head">
              <div className="card-title">{result.title}</div>
              <div className="card-actions text-small text-faint">
                {result.summary.filter((s) => s.label !== 'Period').map((s) => (
                  <span key={s.label}><b>{s.label}:</b> {s.value}</span>
                ))}
              </div>
            </div>
            {result.rows.length === 0 ? (
              <EmptyState title="No data for this period" />
            ) : (
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>{result.columns.map((c) => <th key={c.key} className={c.money ? 'num' : ''}>{c.label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i}>
                        {result.columns.map((c) => (
                          <td key={c.key} className={c.money ? 'num' : ''}>
                            {c.money ? moneyCell(String(row[c.key] ?? '')) : String(row[c.key] ?? '—')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function moneyCell(v: string): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return v
  return `৳${(n / 100).toLocaleString('en-BD')}`
}
