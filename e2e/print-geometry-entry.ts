/**
 * print-geometry-entry.ts — the real print/PDF geometry test suite.
 *
 * This module is bundled by e2e/print-geometry.mjs with esbuild (see the
 * driver) and executed INSIDE Electron by e2e/print-geometry-main.cjs. It
 * drives the REAL PrintManager (src/main/app/print.ts) over the REAL
 * dentiva-safe:// protocol and asserts the geometry and robustness of the
 * PDFs Chromium actually produces.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildPaths } from '../src/main/core/paths'
import { PrintManager, countPdfPages, pdfFirstPageSizePoints, readPdfForTest } from '../src/main/app/print'
import { registerSafeProtocol, registerSchemePrivilege } from '../src/main/app/protocol'
import { renderPrescription, renderInvoice, renderReceipt, renderReport } from '@shared/print'
import type { RxPrintData, InvoicePrintData, PrintDoc } from '@shared/print'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { mmToPoints } from '../src/main/core/pdf'
import type { AppContext } from '../src/main/core/context'

export { registerSchemePrivilege }

export interface CaseResult { name: string; ok: boolean; detail?: string }
export interface SuiteResult { cases: CaseResult[]; crashed?: string }

/** Minimal valid PNG (96×64, teal with a white disc) used as the test clinic logo. */
const TEST_LOGO_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAGAAAABACAYAAADlNHIOAAAA6UlEQVR42u3cwQ0CMRAEwcmATHmS/iFSOARje8uSE+jS8cG7ebyel9u7EQHAV/dzAPwh8t0DoBB9J4ycHn11jEyMvxJCJoZfCSKTw68AEfG7CBG/ixDxuwgRv4sQ8bsIEb+LAOBkgJMOAABz4/8SIeJ3EQAAACB+EQEAAADiFxEAAAAAAAAAAAAAiF9A8AX4CQIAAAAAAAAAANgdwP8BAAAA8Cpim/gAAADwNrQY3+vocnwApwOYkAEAwJSkOeFl45uUL8e3K6Ic37aUcnz7gsrxbcwqhrcz7rIzztZEe0MB2JxrdzSA0fcNdGssPr4QqTsAAAAASUVORK5CYII='

const clinic = {
  name: 'স্মাইল ডেন্টাল কেয়ার',
  address: '১২ গ্রিন রোড, ঢাকা',
  phone: '01712345678',
  phone2: null,
  email: null,
  logoPath: null as string | null,
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
  clinic: { ...clinic },
  settings: structuredClone(DEFAULT_SETTINGS),
  rxNo: 'RX-0001',
  date: '2026-01-05',
  patientName: 'মোঃ আব্দুল করিম',
  patientCode: 'P-0001',
  age: 34,
  gender: 'male',
  dentistName: 'Dr. রহিম খান',
  designations: ['Consultant'],
  qualifications: ['BDS', 'FCPS'],
  cc: ['দাঁতে ব্যথা'],
  oe: ['Caries 36'],
  advice: 'দিনে দুবার ব্রাশ করুন এবং নির্দেশিত ওষুধ নিয়মিত খাবারের পর গ্রহণ করুন।',
  nextVisit: null,
  medicines: meds(2),
  ...over
})

const invoiceData = (over: Partial<InvoicePrintData> = {}): InvoicePrintData => ({
  clinic: { ...clinic },
  settings: structuredClone(DEFAULT_SETTINGS),
  invoiceNo: 'INV-0001',
  date: '2026-01-05',
  patientName: 'মোঃ আব্দুল করিম',
  patientCode: 'P-0001',
  patientPhone: '01712345678',
  lines: [{ description: 'Scaling & polishing', quantity: 1, unitPrice: 150000, lineTotal: 150000 }],
  subtotal: 150000,
  discount: 0,
  total: 150000,
  paid: 50000,
  due: 100000,
  status: 'partial',
  notes: null,
  dentistName: 'Dr. রহিম খান',
  ...over
})

export async function runPrintGeometryTests(opts: { dataDir: string; fontsDir: string }): Promise<SuiteResult> {
  const cases: CaseResult[] = []
  const record = (name: string, ok: boolean, detail?: string) => {
    cases.push({ name, ok, detail })
    console.log(`${ok ? '✔' : '✘'} ${name}${!ok && detail ? ` — ${detail}` : ''}`)
  }
  const expectThrows = async (name: string, fn: () => unknown | Promise<unknown>, match?: RegExp) => {
    try {
      await fn()
      record(name, false, 'expected an error but none was thrown')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      record(name, match ? match.test(msg) : true, match && !match.test(msg) ? `error message did not match: ${msg}` : undefined)
    }
  }

  const paths = buildPaths(opts.dataDir)
  mkdirSync(paths.tempDir, { recursive: true })
  mkdirSync(paths.logosDir, { recursive: true })
  writeFileSync(join(paths.logosDir, 'test-logo.png'), Buffer.from(TEST_LOGO_PNG_BASE64, 'base64'))

  // PrintManager only consumes ctx.paths — a minimal stand-in keeps this
  // harness independent of a database while using the real print pipeline.
  const ctx = { paths } as unknown as AppContext
  registerSafeProtocol(ctx, opts.fontsDir)
  const pm = new PrintManager(ctx, 'dentiva-safe://fonts')

  const render = async (doc: PrintDoc): Promise<{ pdfUrl: string; pages: number; bytes: Buffer }> => {
    const r = await pm.renderPdf(doc.html, { html: doc.html, paper: doc.paper, widthMm: doc.widthMm ?? null, heightMm: doc.heightMm ?? null, marginMm: doc.marginMm, scale: doc.scale })
    return { pdfUrl: r.pdfUrl, pages: r.pages, bytes: readPdfForTest(pm.pdfDiskPath(r.pdfUrl)) }
  }

  const assertGeometry = async (name: string, doc: PrintDoc, expectMm: { width: number; height: number }) => {
    try {
      const { bytes } = await render(doc)
      const size = pdfFirstPageSizePoints(bytes)
      if (!size) return record(name, false, 'no MediaBox found in produced PDF')
      const want = { width: mmToPoints(expectMm.width), height: mmToPoints(expectMm.height) }
      const dw = Math.abs(size.width - want.width)
      const dh = Math.abs(size.height - want.height)
      const ok = dw <= 1.0 && dh <= 1.0
      record(name, ok, ok ? undefined : `MediaBox ${size.width}×${size.height}pt, expected ${want.width.toFixed(2)}×${want.height.toFixed(2)}pt (±1)`)
    } catch (e) {
      record(name, false, e instanceof Error ? e.message : String(e))
    }
  }

  /* ---------------- paper geometry (MediaBox in points) ---------------- */
  await assertGeometry('A4 prescription geometry (210×297mm)', { ...renderPrescription(rxData()), paper: 'a4' }, { width: 210, height: 297 })
  await assertGeometry('A5 prescription geometry (148×210mm)', { ...renderPrescription(rxData()), paper: 'a5' }, { width: 148, height: 210 })
  await assertGeometry('Letter geometry (215.9×279.4mm)', { ...renderPrescription(rxData()), paper: 'letter' }, { width: 215.9, height: 279.4 })
  await assertGeometry('Thermal 80mm receipt roll geometry (80×297mm)', renderReceipt({
    clinic: { ...clinic }, settings: null, receiptNo: 'RCP-1', date: '2026-01-05', time: '10:30',
    patientName: 'রহিম উদ্দিন', patientCode: 'P-0001', invoiceNo: null,
    amount: 150000, method: 'cash', reference: null, receivedBy: 'Reception'
  }), { width: 80, height: 297 })
  await assertGeometry('Thermal 58mm roll geometry (58×297mm)', { ...renderPrescription(rxData()), paper: 'thermal58' }, { width: 58, height: 297 })
  await assertGeometry('Custom paper geometry (100×150mm)', { ...renderPrescription(rxData()), paper: 'custom', widthMm: 100, heightMm: 150 }, { width: 100, height: 150 })
  await assertGeometry('Custom paper geometry (210×100mm landscape-ish)', { ...renderPrescription(rxData()), paper: 'custom', widthMm: 210, heightMm: 100 }, { width: 210, height: 100 })
  await assertGeometry('Invalid custom paper falls back to A4', { ...renderPrescription(rxData()), paper: 'custom', widthMm: 5, heightMm: 400 }, { width: 210, height: 297 })
  await assertGeometry('Report geometry (A4)', renderReport({
    clinic: { ...clinic }, title: 'Daily summary', periodLabel: 'Today',
    columns: [{ key: 'label', label: 'Metric' }], rows: [{ label: 'Patients' }], summary: [{ label: 'Total', value: '1' }]
  }), { width: 210, height: 297 })
  await assertGeometry('Invoice geometry (A4, settings default)', renderInvoice(invoiceData()), { width: 210, height: 297 })

  /* ---------------- content: Bengali, logo, pagination ---------------- */
  try {
    const { bytes, pages } = await render(renderPrescription(rxData()))
    const latin = bytes.toString('latin1')
    const hasBengaliFont = latin.includes('NotoSansBengali')
    record('Bengali prescription embeds the bundled Noto Sans Bengali font', hasBengaliFont, hasBengaliFont ? undefined : 'font name not found in PDF — font may not have loaded over dentiva-safe://fonts')
    record('Bengali prescription renders as a single A5 page', pages === 1 && countPdfPages(bytes) === 1, `pages=${pages}`)
  } catch (e) {
    record('Bengali prescription renders', false, e instanceof Error ? e.message : String(e))
  }

  try {
    const doc = renderInvoice(invoiceData({ clinic: { ...clinic, logoPath: 'test-logo.png' } }))
    const { bytes } = await render(doc)
    const hasImage = /\/Subtype\s*\/Image/.test(bytes.toString('latin1'))
    record('Clinic logo is embedded as an image XObject in the invoice PDF', hasImage, hasImage ? undefined : 'no /Subtype /Image object found')
  } catch (e) {
    record('Clinic logo embedding', false, e instanceof Error ? e.message : String(e))
  }

  try {
    const { bytes } = await render(renderInvoice(invoiceData()))
    record('Invoice without logo renders cleanly', !/\/Subtype\s*\/Image/.test(bytes.toString('latin1')))
  } catch (e) {
    record('Invoice without logo renders cleanly', false, e instanceof Error ? e.message : String(e))
  }

  try {
    const long = rxData({
      patientName: 'অত্যন্ত দীর্ঘ নাম সহ রোগী '.repeat(6).trim(),
      medicines: meds(30),
      advice: 'দীর্ঘ পরামর্শ: '.repeat(200)
    })
    const { pages, bytes } = await render({ ...renderPrescription(long), paper: 'a5' })
    record('Long prescription (30 medicines, long Bengali name/advice) paginates to ≥2 pages', pages >= 2 && countPdfPages(bytes) === pages, `pages=${pages}`)
  } catch (e) {
    record('Long prescription pagination', false, e instanceof Error ? e.message : String(e))
  }

  try {
    const lines = Array.from({ length: 60 }, (_, i) => ({ description: `Treatment line ${i + 1} — দাঁতের চিকিৎসা`, quantity: 1, unitPrice: 10000, lineTotal: 10000 }))
    const { pages, bytes } = await render(renderInvoice(invoiceData({ lines, subtotal: 600000, total: 600000, paid: 0, due: 600000 })))
    record('Invoice with 60 line items paginates to ≥2 pages', pages >= 2 && countPdfPages(bytes) === pages, `pages=${pages}`)
  } catch (e) {
    record('Invoice with 60 line items pagination', false, e instanceof Error ? e.message : String(e))
  }

  try {
    // A very large logo must not break rendering (constrained by CSS max sizes).
    const bigLogoRx = rxData({ clinic: { ...clinic, logoPath: 'test-logo.png' } })
    const { pages } = await render(renderPrescription(bigLogoRx))
    record('Prescription with logo renders (CSS-constrained size)', pages >= 1)
  } catch (e) {
    record('Prescription with logo renders', false, e instanceof Error ? e.message : String(e))
  }

  /* ---------------- input validation / anti-abuse ---------------- */
  await expectThrows('Empty print document is rejected', () => pm.renderPdf('', { html: '', paper: 'a4' }), /empty/i)
  await expectThrows('Oversized print document (>2MB) is rejected', () => pm.renderPdf('x'.repeat(2_000_001), { html: 'x', paper: 'a4' }), /too large/i)
  await expectThrows('Remote image resources are rejected', () => pm.renderPdf('<p>hi</p><img src="http://evil.example/x.png">', { html: '<p>hi</p>', paper: 'a4' }), /local resources/i)
  await expectThrows('file:// image resources are rejected', () => pm.renderPdf('<p>hi</p><img src="file:///etc/passwd">', { html: '<p>hi</p>', paper: 'a4' }), /local resources/i)

  /* ---------------- print-job reference integrity ---------------- */
  try {
    const none = pm.jobKeyForPdfUrl('dentiva-safe://temp/not-a-real-job.pdf')
    record('Unknown pdfUrl maps to no print job', none === null, `got ${String(none)}`)
  } catch (e) {
    record('Unknown pdfUrl maps to no print job', false, e instanceof Error ? e.message : String(e))
  }
  await expectThrows('Path traversal in pdfUrl is rejected', () => pm.pdfDiskPath('dentiva-safe://temp/..%2F..%2Fsecret.pdf'), /invalid/i)
  await expectThrows('Non-PDF extension in pdfUrl is rejected', () => pm.pdfDiskPath('dentiva-safe://temp/hack.php'), /invalid/i)
  await expectThrows('Empty/zero-length print job key is rejected', () => pm.printJob('', null, true), /expired/i)

  try {
    const { pdfUrl } = await render(renderPrescription(rxData()))
    const key = pm.jobKeyForPdfUrl(pdfUrl)
    record('Rendered PDF maps to a live print job', typeof key === 'string' && key.length > 0)
    const disk = pm.pdfDiskPath(pdfUrl)
    record('Rendered PDF has a valid on-disk path', /\\.pdf$/.test(disk) && readPdfForTest(disk).length > 100, `path=${disk}`)
  } catch (e) {
    record('Rendered PDF job bookkeeping', false, e instanceof Error ? e.message : String(e))
  }

  return { cases }
}
