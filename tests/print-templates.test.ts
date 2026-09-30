import { describe, it, expect } from 'vitest'
import { renderPrescription, renderInvoice, renderReceipt, renderReport } from '@shared/print'
import type { RxPrintData, InvoicePrintData } from '@shared/print'
import { DEFAULT_SETTINGS, paperSizeMm } from '@shared/settings'
import { countPdfPages, pdfFirstPageSizePoints, mmToPoints } from '../src/main/core/pdf'

const clinic = {
  name: 'Smile Dental Care',
  address: '12 Green Road, Dhaka',
  phone: '01712345678',
  phone2: null,
  email: null,
  logoPath: null,
  tagline: null,
  footerMessage: null,
  doctorTiming: null
}

const meds = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    name: `Amoxicillin ${i + 1}`,
    doseForm: 'capsule',
    strength: '500mg',
    morning: true,
    noon: false,
    night: true,
    meal: 'after',
    duration: '7 days',
    isPrn: false,
    instruction: null
  }))

const rxData = (over: Partial<RxPrintData> = {}): RxPrintData => ({
  clinic,
  settings: null,
  rxNo: 'RX-0001',
  date: '2026-01-05',
  patientName: 'Rahim Uddin',
  patientCode: 'P-0001',
  age: 34,
  gender: 'male',
  dentistName: 'Dr. Rahim Khan',
  designations: ['Consultant'],
  qualifications: ['BDS', 'FCPS'],
  cc: ['Toothache'],
  oe: ['Caries 36'],
  advice: 'Brush twice daily.',
  nextVisit: null,
  medicines: meds(2),
  ...over
})

const invoiceData = (over: Partial<InvoicePrintData> = {}): InvoicePrintData => ({
  clinic,
  settings: null,
  invoiceNo: 'INV-0001',
  date: '2026-01-05',
  patientName: 'Rahim Uddin',
  patientCode: 'P-0001',
  patientPhone: '01712345678',
  lines: [
    { description: 'Scaling & polishing', quantity: 1, unitPrice: 150000, lineTotal: 150000 },
    { description: 'Filling (composite)', quantity: 2, unitPrice: 200000, lineTotal: 400000 }
  ],
  subtotal: 550000,
  discount: 50000,
  total: 500000,
  paid: 200000,
  due: 300000,
  status: 'partial',
  notes: null,
  dentistName: 'Dr. Rahim Khan',
  ...over
})

describe('prescription print template', () => {
  it('escapes HTML in patient data (XSS safety)', () => {
    const doc = renderPrescription(rxData({ patientName: '<script>alert(1)</script>', cc: ['<img src=x onerror=1>'] }))
    expect(doc.html).not.toContain('<script>alert')
    expect(doc.html).toContain('&lt;script&gt;')
    expect(doc.html).toContain('&lt;img src=x onerror=1&gt;')
  })

  it('uses Bengali dose-time labels', () => {
    const doc = renderPrescription(rxData())
    expect(doc.html).toContain('সকাল')
    expect(doc.html).toContain('রাত')
    expect(doc.html).toContain('খাবারের পরে')
  })

  it('paper preference: prescription.defaultPaper > printing.defaultPaper > a5', () => {
    expect(renderPrescription(rxData({ settings: null })).paper).toBe('a5')
    const s = structuredClone(DEFAULT_SETTINGS)
    s.printing.defaultPaper = 'a4'
    expect(renderPrescription(rxData({ settings: s })).paper).toBe('a4')
    s.prescription.defaultPaper = 'thermal80'
    expect(renderPrescription(rxData({ settings: s })).paper).toBe('thermal80')
  })

  it('signature area: dentist name + degrees under the rule, ≥22mm clear space above', () => {
    const doc = renderPrescription(rxData())
    // clear vertical space above the signature rule (22mm ≈ 83.15px at 96dpi)
    expect(doc.html).toMatch(/\.sign \.space \{ height: (8[3-9]|9\d|\d{3})px \}/)
    // name + qualifications under the line
    const signIdx = doc.html.indexOf('class="line"')
    const nameIdx = doc.html.indexOf('Dr. Rahim Khan')
    const qualsIdx = doc.html.indexOf('BDS, FCPS')
    expect(signIdx).toBeGreaterThan(-1)
    expect(nameIdx).toBeGreaterThan(signIdx)
    expect(qualsIdx).toBeGreaterThan(nameIdx)
  })

  it('uses the configurable footer message and doctor timing', () => {
    const s = structuredClone(DEFAULT_SETTINGS)
    s.prescription.footerMessage = 'ধন্যবাদ। সুস্থ থাকুন।'
    s.prescription.doctorTiming = 'Sat–Thu, 5pm–9pm'
    const doc = renderPrescription(rxData({ settings: s }))
    expect(doc.html).toContain('ধন্যবাদ। সুস্থ থাকুন।')
    expect(doc.html).toContain('Sat–Thu, 5pm–9pm')
  })

  it('renders the clinic logo via the safe protocol, or omits it cleanly', () => {
    const withLogo = renderPrescription(rxData({ clinic: { ...clinic, logoPath: 'logo-abc.png' } }))
    expect(withLogo.html).toContain('dentiva-safe://logo/logo-abc.png')
    expect(withLogo.html).toContain('object-fit:contain')
    const without = renderPrescription(rxData({ clinic: null }))
    expect(without.html).not.toContain('dentiva-safe://logo/')
    expect(without.html).toContain('Dental Clinic')
  })

  it('long medicine lists and advice are wrapped (no clipped columns)', () => {
    const doc = renderPrescription(
      rxData({ medicines: meds(40), advice: 'অনেক দীর্ঘ পরামর্শ '.repeat(120) })
    )
    expect(doc.html).toMatch(/overflow-wrap:\s*anywhere/)
    expect((doc.html.match(/class="med"/g) ?? []).length).toBe(40)
  })
})

describe('invoice print template', () => {
  it('has NO signature block by default (spec §3.2)', () => {
    const doc = renderInvoice(invoiceData())
    expect(doc.html).not.toContain('signature')
    expect(doc.html).not.toContain('class="sign"')
  })

  it('uses the configurable footer note', () => {
    // with settings: the configured note is used
    const doc = renderInvoice(invoiceData({ settings: DEFAULT_SETTINGS }))
    expect(doc.html).toContain(DEFAULT_SETTINGS.invoice.footerNote)
    const s = structuredClone(DEFAULT_SETTINGS)
    s.invoice.footerNote = 'Custom footer note ৳'
    expect(renderInvoice(invoiceData({ settings: s })).html).toContain('Custom footer note ৳')
    // without settings: generic thank-you fallback
    expect(renderInvoice(invoiceData({ settings: null })).html).toContain('Thank you for visiting.')
  })

  it('renders totals, discount, taka amounts and status stamps', () => {
    const doc = renderInvoice(invoiceData())
    expect(doc.html).toContain('৳1,500')
    expect(doc.html).toContain('৳5,000')
    expect(doc.html).toContain('৳3,000')
    expect(doc.html).not.toContain('PAID</div>')
    expect(renderInvoice(invoiceData({ status: 'paid' })).html).toContain('>PAID<')
    expect(renderInvoice(invoiceData({ status: 'void' })).html).toContain('>VOID<')
    // discount row hidden when zero
    expect(renderInvoice(invoiceData({ discount: 0 })).html).not.toContain('>Discount<')
  })

  it('escapes patient and line data, supports many items', () => {
    const lines = Array.from({ length: 60 }, (_, i) => ({ description: `Item ${i + 1} <b>`, quantity: 1, unitPrice: 1000, lineTotal: 1000 }))
    const doc = renderInvoice(invoiceData({ patientName: '<script>x</script>', lines }))
    expect(doc.html).not.toContain('<script>x')
    expect((doc.html.match(/<tr>/g) ?? []).length).toBeGreaterThanOrEqual(60)
  })

  it('paper defaults to a4 / follows printing.defaultPaper', () => {
    expect(renderInvoice(invoiceData({ settings: null })).paper).toBe('a4')
    const s = structuredClone(DEFAULT_SETTINGS)
    s.printing.defaultPaper = 'a5'
    expect(renderInvoice(invoiceData({ settings: s })).paper).toBe('a5')
  })
})

describe('receipt print template', () => {
  it('is thermal80 with 3mm margins and a centred header', () => {
    const doc = renderReceipt({
      clinic, settings: null, receiptNo: 'RCP-1', date: '2026-01-05', time: '10:30',
      patientName: 'রহিম উদ্দিন', patientCode: 'P-0001', invoiceNo: 'INV-0001',
      amount: 150000, method: 'cash', reference: null, receivedBy: 'Reception'
    })
    expect(doc.paper).toBe('thermal80')
    expect(doc.marginMm).toBe(3)
    expect(doc.html).toContain('MONEY RECEIPT')
    expect(doc.html).toContain('রহিম উদ্দিন')
    expect(doc.html).toContain('৳1,500')
  })
})

describe('report print template', () => {
  it('is a4 with an empty-state row when no data', () => {
    const doc = renderReport({
      clinic, title: 'Daily summary', periodLabel: 'Today',
      columns: [{ key: 'label', label: 'Metric' }],
      rows: [], summary: []
    })
    expect(doc.paper).toBe('a4')
    expect(doc.html).toContain('No data for this period')
  })
})

describe('paper sizes (mm)', () => {
  it('maps known papers and validates custom sizes', () => {
    expect(paperSizeMm({ paper: 'a4' })).toEqual({ width: 210, height: 297 })
    expect(paperSizeMm({ paper: 'a5' })).toEqual({ width: 148, height: 210 })
    expect(paperSizeMm({ paper: 'letter' })).toEqual({ width: 215.9, height: 279.4 })
    expect(paperSizeMm({ paper: 'thermal80' })).toEqual({ width: 80, height: 297 })
    expect(paperSizeMm({ paper: 'thermal58' })).toEqual({ width: 58, height: 297 })
    expect(paperSizeMm({ paper: 'custom', widthMm: 100, heightMm: 150 })).toEqual({ width: 100, height: 150 })
    // invalid custom (out of 30–350mm range, non-numeric) falls back to A4
    expect(paperSizeMm({ paper: 'custom', widthMm: 5, heightMm: 400 })).toEqual({ width: 210, height: 297 })
    expect(paperSizeMm({ paper: 'custom', widthMm: NaN, heightMm: 150 })).toEqual({ width: 210, height: 297 })
    expect(paperSizeMm({ paper: 'unknown' })).toEqual({ width: 210, height: 297 })
  })
})

describe('pdf inspection helpers', () => {
  const synthPdf = (mediaBox: string, pages = 1): Buffer => {
    let objs = '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids['
    for (let i = 0; i < pages; i++) objs += `${3 + i} 0 R `
    objs += `]/Count ${pages}>>endobj\n`
    for (let i = 0; i < pages; i++) objs += `${3 + i} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[${mediaBox}]>>endobj\n`
    return Buffer.from(`%PDF-1.4\n${objs}trailer<</Root 1 0 R>>\n%%EOF`, 'latin1')
  }

  it('countPdfPages counts /Type/Page objects', () => {
    expect(countPdfPages(synthPdf('0 0 595 842'))).toBe(1)
    expect(countPdfPages(synthPdf('0 0 595 842', 3))).toBe(3)
    expect(countPdfPages(Buffer.from('not a pdf'))).toBe(1)
  })

  it('pdfFirstPageSizePoints extracts the MediaBox dimensions in points', () => {
    const size = pdfFirstPageSizePoints(synthPdf('0 0 595.28 841.89'))
    expect(size).toEqual({ width: 595.28, height: 841.89 })
    expect(pdfFirstPageSizePoints(synthPdf('36 36 612 828'))).toEqual({ width: 576, height: 792 })
    expect(pdfFirstPageSizePoints(Buffer.from('%PDF-no-mediabox'))).toBeNull()
  })

  it('mm→points conversion matches the PDF point definition', () => {
    expect(mmToPoints(210)).toBeCloseTo(595.276, 2)
    expect(mmToPoints(297)).toBeCloseTo(841.89, 1)
    expect(mmToPoints(80)).toBeCloseTo(226.77, 2)
    expect(mmToPoints(58)).toBeCloseTo(164.41, 2)
  })
})
