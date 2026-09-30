import type { AppSettings, ClinicRow } from '@shared/types'
import { formatDateHuman } from '@shared/dates'

/**
 * Print pipeline: these templates render to a self-contained HTML document,
 * the trusted main process converts it to PDF via a sandboxed hidden window
 * (dentiva-safe://temp/…) and sends it to the printer.
 */

export interface PrintDoc {
  html: string
  paper: string
  widthMm?: number | null
  heightMm?: number | null
  marginMm?: number
  scale?: number
}

function baseCss(marginMm: number): string {
  return `
    @page { margin: 0 }
    * { box-sizing: border-box; margin: 0; padding: 0 }
    body {
      font-family: 'Noto Sans Bengali', 'Inter', system-ui, sans-serif;
      color: #14282a; padding: ${marginMm}mm; background: #fff;
      -webkit-print-color-adjust: exact;
    }
    .rx-head { display: flex; align-items: flex-start; border-bottom: 2.5px solid #0c2b2c; padding-bottom: 10px; }
    .clinic { flex: 1 }
    .clinic-name { font-size: 20px; font-weight: 800; color: #0c2b2c }
    .clinic-sub { font-size: 11px; color: #51666a; margin-top: 2px; line-height: 1.45 }
    .rx-badge { text-align: center; }
    .rx-badge .big { font-size: 24px; font-weight: 800; color: #b3261e; letter-spacing: 2px; border: 2px solid #b3261e; padding: 2px 14px; border-radius: 8px }
    .rx-badge .small { font-size: 10px; color: #51666a; margin-top: 3px }
    .patient-row { display: flex; font-size: 12px; margin: 10px 0 4px; gap: 18px }
    .patient-row b { font-weight: 700 }
    .sec { font-size: 11px; font-weight: 800; letter-spacing: 1px; color: #0c6b5e; text-transform: uppercase; margin: 10px 0 5px; }
    .kv-line { font-size: 12px; line-height: 1.6 }
    .meds { display: grid; gap: 8px; margin-top: 4px }
    .med { display: grid; grid-template-columns: 22px 1fr; gap: 8px; page-break-inside: avoid }
    .med .idx { width: 20px; height: 20px; border-radius: 99px; background: #e0f1ee; color: #0c6b5e; font-size: 11px; font-weight: 800; display: grid; place-items: center }
    .med .name { font-weight: 700; font-size: 13px }
    .med .meta { font-size: 11.5px; color: #51666a; margin-top: 1px }
    .times { display: flex; gap: 5px; margin-top: 3px }
    .time { background: #e0f1ee; color: #0c6b5e; font-size: 10px; font-weight: 700; padding: 1.5px 8px; border-radius: 6px }
    .advice { font-size: 12px; line-height: 1.65; white-space: pre-wrap }
    .foot { position: absolute; bottom: ${marginMm}mm; left: ${marginMm}mm; right: ${marginMm}mm; display: flex; justify-content: space-between; align-items: flex-end; }
    .sign { text-align: center; width: 200px }
    .sign .line { border-top: 1px solid #14282a; margin-top: 34px; padding-top: 4px; font-size: 11.5px; font-weight: 700 }
    .sign .sub { font-size: 10px; color: #51666a }
    .gen { font-size: 10px; color: #7b8f92 }
    table.inv { width: 100%; border-collapse: collapse; margin-top: 10px }
    table.inv th, table.inv td { border: 1px solid #d9e2e0; padding: 6px 9px; font-size: 12px; text-align: left }
    table.inv th { background: #f2f5f4; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px }
    .totals { margin-top: 10px; margin-left: auto; width: 260px }
    .totals .line { display: flex; justify-content: space-between; padding: 3.5px 0; font-size: 12.5px }
    .totals .grand { font-weight: 800; font-size: 15px; border-top: 2px solid #0c2b2c; padding-top: 6px; margin-top: 4px }
    .paid-stamp { border: 2.5px solid #1a7f37; color: #1a7f37; font-weight: 800; font-size: 16px; padding: 3px 16px; border-radius: 8px; transform: rotate(-6deg); display: inline-block; margin-top: 12px }
    .void-stamp { border: 2.5px solid #b3261e; color: #b3261e; font-weight: 800; font-size: 16px; padding: 3px 16px; border-radius: 8px; transform: rotate(-6deg); display: inline-block; margin-top: 12px }
  `
}

function head(title: string, marginMm: number): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${baseCss(marginMm)}</style></head><body>`
}

export function escapeHtml(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function clinicBlock(clinic: ClinicRow | null): string {
  const name = clinic?.name ?? 'Dental Clinic'
  const address = [clinic?.address, clinic?.phone].filter(Boolean).join(' · ')
  return `<div class="clinic">
      <div class="clinic-name">${escapeHtml(name)}</div>
      <div class="clinic-sub">${escapeHtml(address)}${clinic?.email ? ` · ${escapeHtml(clinic.email)}` : ''}</div>
    </div>`
}

function taka(paisa: number): string {
  return `৳${(paisa / 100).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

/* ---------------- Prescription ---------------- */
export interface RxPrintData {
  clinic: ClinicRow | null
  settings: AppSettings | null
  rxNo: string
  date: string
  patientName: string
  patientCode: string
  age: number | null
  gender: string
  dentistName: string
  designations: string[]
  qualifications: string[]
  cc: string[]
  oe: string[]
  advice: string | null
  nextVisit: string | null
  medicines: {
    name: string; doseForm: string | null; strength: string | null
    morning: boolean; noon: boolean; night: boolean
    meal: string | null; duration: string | null; isPrn: boolean; instruction: string | null
  }[]
}

export function renderPrescription(d: RxPrintData): PrintDoc {
  const paper = d.settings?.printing?.defaultPaper ?? 'a5'
  const marginMm = 10
  const meds = d.medicines.map((m, i) => `
    <div class="med">
      <div class="idx">${i + 1}</div>
      <div>
        <div class="name">${escapeHtml(m.name)}${m.strength ? ` — ${escapeHtml(m.strength)}` : ''}${m.doseForm ? ` (${escapeHtml(m.doseForm)})` : ''}</div>
        <div class="times">
          ${m.morning ? '<span class="time">সকাল</span>' : ''}${m.noon ? '<span class="time">দুপুর</span>' : ''}${m.night ? '<span class="time">রাত</span>' : ''}
          ${m.isPrn ? '<span class="time">প্রয়োজনে</span>' : ''}
          ${m.meal ? `<span class="time">${escapeHtml(m.meal === 'before' ? 'খাবারের আগে' : m.meal === 'after' ? 'খাবারের পরে' : 'খাবারের সাথে')}</span>` : ''}
          ${m.duration ? `<span class="time">${escapeHtml(m.duration)}</span>` : ''}
        </div>
        ${m.instruction ? `<div class="meta">${escapeHtml(m.instruction)}</div>` : ''}
      </div>
    </div>`).join('')

  const html = `${head(`Prescription ${d.rxNo}`, marginMm)}
    <div class="rx-head">
      ${clinicBlock(d.clinic)}
      <div class="rx-badge">
        <div class="big">Rx</div>
        <div class="small">${escapeHtml(d.rxNo)} · ${escapeHtml(formatDateHuman(d.date))}</div>
      </div>
    </div>
    <div class="patient-row">
      <span><b>Name:</b> ${escapeHtml(d.patientName)}</span>
      <span><b>Age:</b> ${d.age ?? '—'}</span>
      <span><b>Sex:</b> ${escapeHtml(d.gender)}</span>
      <span><b>ID:</b> ${escapeHtml(d.patientCode)}</span>
    </div>
    ${d.cc.length ? `<div class="sec">Chief Complaint</div><div class="kv-line">${escapeHtml(d.cc.join(', '))}</div>` : ''}
    ${d.oe.length ? `<div class="sec">On Examination</div><div class="kv-line">${escapeHtml(d.oe.join(', '))}</div>` : ''}
    <div class="sec">Rx</div>
    <div class="meds">${meds || '<div class="kv-line">—</div>'}</div>
    ${d.advice ? `<div class="sec">Advice</div><div class="advice">${escapeHtml(d.advice)}</div>` : ''}
    ${d.nextVisit ? `<div class="sec">Next Visit</div><div class="kv-line">${escapeHtml(formatDateHuman(d.nextVisit))}</div>` : ''}
    <div class="foot">
      <div class="gen">Generated by Dentiva Pro — offline dental clinic management</div>
      <div class="sign">
        <div class="line">${escapeHtml(d.dentistName)}</div>
        <div class="sub">${escapeHtml([...d.qualifications, ...d.designations].slice(0, 3).join(', '))}</div>
      </div>
    </div>
  </body></html>`
  return { html, paper, marginMm }
}

/* ---------------- Invoice ---------------- */
export interface InvoicePrintData {
  clinic: ClinicRow | null
  settings: AppSettings | null
  invoiceNo: string
  date: string
  patientName: string
  patientCode: string
  patientPhone: string | null
  lines: { description: string; quantity: number; unitPrice: number; lineTotal: number }[]
  subtotal: number
  discount: number
  total: number
  paid: number
  due: number
  status: 'unpaid' | 'partial' | 'paid' | 'void'
  notes: string | null
  dentistName: string | null
}

export function renderInvoice(d: InvoicePrintData): PrintDoc {
  const paper = d.settings?.printing?.defaultPaper ?? 'a4'
  const marginMm = 12
  const rows = d.lines.map((l) => `
    <tr>
      <td>${escapeHtml(l.description)}</td>
      <td style="text-align:right">${l.quantity}</td>
      <td style="text-align:right">${taka(l.unitPrice)}</td>
      <td style="text-align:right">${taka(l.lineTotal)}</td>
    </tr>`).join('')
  const html = `${head(`Invoice ${d.invoiceNo}`, marginMm)}
    <div class="rx-head">
      ${clinicBlock(d.clinic)}
      <div style="text-align:right">
        <div style="font-size:18px;font-weight:800;color:#0c2b2c">INVOICE</div>
        <div class="clinic-sub">${escapeHtml(d.invoiceNo)}<br/>${escapeHtml(formatDateHuman(d.date))}</div>
      </div>
    </div>
    <div class="patient-row" style="margin-top:12px">
      <span><b>Patient:</b> ${escapeHtml(d.patientName)} (${escapeHtml(d.patientCode)})</span>
      ${d.patientPhone ? `<span><b>Phone:</b> ${escapeHtml(d.patientPhone)}</span>` : ''}
      ${d.dentistName ? `<span><b>Dentist:</b> ${escapeHtml(d.dentistName)}</span>` : ''}
    </div>
    <table class="inv">
      <thead><tr><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit price</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div class="line"><span>Subtotal</span><span>${taka(d.subtotal)}</span></div>
      ${d.discount > 0 ? `<div class="line"><span>Discount</span><span>− ${taka(d.discount)}</span></div>` : ''}
      <div class="line grand"><span>Total</span><span>${taka(d.total)}</span></div>
      <div class="line"><span>Paid</span><span>${taka(d.paid)}</span></div>
      <div class="line" style="font-weight:700"><span>Due</span><span>${taka(d.due)}</span></div>
    </div>
    ${d.status === 'paid' ? '<div class="paid-stamp">PAID</div>' : ''}
    ${d.status === 'void' ? '<div class="void-stamp">VOID</div>' : ''}
    ${d.notes ? `<div class="sec">Notes</div><div class="kv-line">${escapeHtml(d.notes)}</div>` : ''}
    <div class="foot">
      <div class="gen">Thank you for visiting · Generated by Dentiva Pro</div>
      <div class="sign"><div class="line">Authorised signature</div></div>
    </div>
  </body></html>`
  return { html, paper, marginMm }
}

/* ---------------- Receipt ---------------- */
export interface ReceiptPrintData {
  clinic: ClinicRow | null
  settings: AppSettings | null
  receiptNo: string
  date: string
  time: string
  patientName: string
  patientCode: string
  invoiceNo: string | null
  amount: number
  method: string
  reference: string | null
  receivedBy: string
}

export function renderReceipt(d: ReceiptPrintData): PrintDoc {
  const paper = 'thermal80'
  const marginMm = 3
  const html = `${head(`Receipt ${d.receiptNo}`, marginMm)}
    <div style="text-align:center;padding:2mm 0">
      <div class="clinic-name" style="font-size:16px">${escapeHtml(d.clinic?.name ?? 'Dental Clinic')}</div>
      <div class="clinic-sub">${escapeHtml([d.clinic?.address, d.clinic?.phone].filter(Boolean).join(' · '))}</div>
      <div style="font-size:12px;font-weight:800;letter-spacing:2px;margin-top:4px">MONEY RECEIPT</div>
    </div>
    <div style="border-top:1px dashed #999;border-bottom:1px dashed #999;padding:3mm 0;margin:2mm 0;font-size:11.5px">
      <div style="display:flex;justify-content:space-between"><span>Receipt #</span><b>${escapeHtml(d.receiptNo)}</b></div>
      <div style="display:flex;justify-content:space-between"><span>Date</span><span>${escapeHtml(d.date)} ${escapeHtml(d.time)}</span></div>
      <div style="display:flex;justify-content:space-between"><span>Patient</span><span>${escapeHtml(d.patientName)} (${escapeHtml(d.patientCode)})</span></div>
      ${d.invoiceNo ? `<div style="display:flex;justify-content:space-between"><span>Invoice</span><span>${escapeHtml(d.invoiceNo)}</span></div>` : ''}
    </div>
    <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:800;padding:2mm 0">
      <span>Received (${escapeHtml(d.method)})</span><span>${taka(d.amount)}</span>
    </div>
    ${d.reference ? `<div style="font-size:11px">Ref: ${escapeHtml(d.reference)}</div>` : ''}
    <div style="margin-top:6mm;font-size:11px;display:flex;justify-content:space-between">
      <span>Received by: ${escapeHtml(d.receivedBy)}</span>
      <span>Signature ________</span>
    </div>
    <div style="text-align:center;font-size:9.5px;color:#7b8f92;margin-top:3mm">Dentiva Pro · Thank you</div>
  </body></html>`
  return { html, paper, marginMm }
}

/* ---------------- Report ---------------- */
export interface ReportPrintData {
  clinic: ClinicRow | null
  title: string
  periodLabel: string
  columns: { key: string; label: string }[]
  rows: Record<string, string | number | null>[]
  summary: { label: string; value: string }[]
}

export function renderReport(d: ReportPrintData): PrintDoc {
  const marginMm = 12
  const head_cells = d.columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')
  const rows = d.rows.map((r) => `<tr>${d.columns.map((c) => `<td>${escapeHtml(String(r[c.key] ?? '—'))}</td>`).join('')}</tr>`).join('')
  const html = `${head(d.title, marginMm)}
    <div class="rx-head">${clinicBlock(d.clinic)}</div>
    <div style="text-align:center;margin:12px 0">
      <div style="font-size:17px;font-weight:800">${escapeHtml(d.title)}</div>
      <div class="clinic-sub">${escapeHtml(d.periodLabel)}</div>
    </div>
    <table class="inv">
      <thead><tr>${head_cells}</tr></thead>
      <tbody>${rows || `<tr><td colspan="${d.columns.length}" style="text-align:center;color:#7b8f92">No data for this period</td></tr>`}</tbody>
    </table>
    ${d.summary.length ? `<div class="totals">${d.summary.map((s) => `<div class="line"><span>${escapeHtml(s.label)}</span><span>${escapeHtml(s.value)}</span></div>`).join('')}</div>` : ''}
    <div class="foot"><div class="gen">Generated by Dentiva Pro — ${new Date().toLocaleString('en-GB')}</div></div>
  </body></html>`
  return { html, paper: 'a4', marginMm }
}
