import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { BrowserWindow } from 'electron'
import type { AppContext } from '../core/context'
import { errIo, errValidation } from '@shared/errors'
import { AppError } from '@shared/errors'
import type { PrintPdfPayload, PrintPdfResult } from '@shared/ipc'
import { paperSizeMm } from '@shared/settings'
import { countPdfPages } from '../core/pdf'

export { countPdfPages, pdfFirstPageSizePoints, readPdfForTest } from '../core/pdf'

interface PrintJob {
  key: string
  pdfPath: string
  pdfUrl: string
  htmlWindow: BrowserWindow | null
  createdAt: number
}

/**
 * Injects the bundled-font CSS into a print document. The renderer templates
 * are complete HTML documents — injecting into their <head> keeps a single
 * valid document instead of nesting a full document inside <body>. Bare HTML
 * fragments are wrapped in a minimal document.
 */
function injectPrintFonts(html: string, fontCss: string): string {
  const inject = `<meta charset="utf-8"><style>${fontCss}</style>`
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + inject)
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + `<head>${inject}</head>`)
  return `<!DOCTYPE html><html><head>${inject}</head><body>${html}</body></html>`
}

/**
 * Print pipeline (docs/PRINT_SPECIFICATION.md):
 * renderer composes semantic HTML → hidden window renders it → printToPDF
 * produces the canonical document (preview == output) → print via the same
 * window (Windows printer selection / silent to a saved printer).
 */
export class PrintManager {
  private jobs = new Map<string, PrintJob>()

  constructor(
    private ctx: AppContext,
    private fontsUrl: string
  ) {}

  async renderPdf(html: string, opts: PrintPdfPayload): Promise<PrintPdfResult> {
    if (typeof html !== 'string' || html.length === 0) throw errValidation('Empty print document.')
    if (html.length > 2_000_000) throw errValidation('Print document is too large.')
    // Basic sanitization: the document must not reference remote resources.
    if (/<img[^>]+src\s*=\s*["']?(https?:|file:)/i.test(html)) {
      throw errValidation('Print documents may only reference app-local resources.')
    }

    mkdirSync(this.ctx.paths.tempDir, { recursive: true })
    const id = randomUUID()
    const htmlPath = join(this.ctx.paths.tempDir, `${id}.html`)
    const pdfPath = join(this.ctx.paths.tempDir, `${id}.pdf`)

    // Inject the bundled font + reset CSS before the document's own styles.
    // Print documents reference the TTF builds: differential CI diagnostics
    // (print-geometry suite) showed that pages whose only webfonts are
    // WOFF2-sourced fail inside Chromium's print compositor
    // ("CompositePages: Page reading failed" → printToPDF rejects with
    // "Printing failed") on Linux CI — and the packaged Windows app's invoice
    // print produced no PDF the same way. TTF is the battle-tested format for
    // print embedding. The app UI keeps the smaller WOFF2 files for display.
    const fontCss = `
      @font-face { font-family: 'Noto Sans Bengali'; font-style: normal; font-weight: 400; src: url('${this.fontsUrl}/noto-sans-bengali-bengali-400-normal.ttf') format('truetype'); }
      @font-face { font-family: 'Noto Sans Bengali'; font-style: normal; font-weight: 400; src: url('${this.fontsUrl}/noto-sans-bengali-latin-400-normal.ttf') format('truetype'); }
      @font-face { font-family: 'Noto Sans Bengali'; font-style: normal; font-weight: 500; src: url('${this.fontsUrl}/noto-sans-bengali-bengali-500-normal.ttf') format('truetype'); }
      @font-face { font-family: 'Noto Sans Bengali'; font-style: normal; font-weight: 500; src: url('${this.fontsUrl}/noto-sans-bengali-latin-500-normal.ttf') format('truetype'); }
      @font-face { font-family: 'Noto Sans Bengali'; font-style: normal; font-weight: 600; src: url('${this.fontsUrl}/noto-sans-bengali-bengali-600-normal.ttf') format('truetype'); }
      @font-face { font-family: 'Noto Sans Bengali'; font-style: normal; font-weight: 600; src: url('${this.fontsUrl}/noto-sans-bengali-latin-600-normal.ttf') format('truetype'); }
      @font-face { font-family: 'Noto Sans Bengali'; font-style: normal; font-weight: 700; src: url('${this.fontsUrl}/noto-sans-bengali-bengali-700-normal.ttf') format('truetype'); }
      @font-face { font-family: 'Noto Sans Bengali'; font-style: normal; font-weight: 700; src: url('${this.fontsUrl}/noto-sans-bengali-latin-700-normal.ttf') format('truetype'); }
    `
    const fullHtml = injectPrintFonts(html, fontCss)
    writeFileSync(htmlPath, fullHtml, 'utf8')

    const size = paperSizeMm({ paper: opts.paper, widthMm: opts.widthMm, heightMm: opts.heightMm })
    const scale = typeof opts.scale === 'number' && opts.scale >= 50 && opts.scale <= 150 ? opts.scale : 100

    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
    try {
      await win.loadURL(`dentiva-safe://temp/${id}.html`)
      // Web fonts load asynchronously (did-finish-load does not wait for them).
      // Printing while the @font-face files are still loading makes the print
      // compositor fail to read the serialized page ("CompositePages: Page
      // reading failed" → printToPDF rejects with "Printing failed") — the
      // same race Puppeteer fixed by awaiting document.fonts.ready before
      // Page.printToPDF. Bounded so a stuck font can never hang printing.
      await Promise.race([
        win.webContents.executeJavaScript('document.fonts.ready.then(() => true)', true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000))
      ])
      const pdf = await win.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        landscape: opts.landscape === true,
        scale: scale / 100,
        pageSize: { width: Math.round(size.width * 1000), height: Math.round(size.height * 1000) },
        margins: { top: 0, bottom: 0, left: 0, right: 0 }
      })
      writeFileSync(pdfPath, pdf)
      const pages = countPdfPages(pdf)
      const key = randomUUID()
      this.jobs.set(key, { key, pdfPath, pdfUrl: `dentiva-safe://temp/${id}.pdf`, htmlWindow: win, createdAt: Date.now() })
      this.cleanupOldJobs()
      return { pdfUrl: `dentiva-safe://temp/${id}.pdf`, pages, fileName: `${id}.pdf` }
    } catch (e) {
      win.destroy()
      throw errIo('Failed to generate the print document: ' + (e instanceof Error ? e.message : 'unknown error'))
    }
  }

  async printJob(jobKey: string, deviceName: string | null, silent: boolean): Promise<void> {
    const job = this.jobs.get(jobKey)
    if (!job || !job.htmlWindow) throw errValidation('This print job has expired. Open the preview again and retry.')
    await new Promise<void>((resolvePrint, rejectPrint) => {
      try {
        job.htmlWindow!.webContents.print(
          { silent, deviceName: deviceName ?? undefined, printBackground: true, margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 } },
          (success, reason) => {
            if (success) resolvePrint()
            else rejectPrint(new AppError('ERR_PRINTER', reason || 'Printing failed. Check that the printer is connected and online.'))
          }
        )
      } catch (e) {
        rejectPrint(new AppError('ERR_PRINTER', e instanceof Error ? e.message : 'Printing failed.'))
      }
    })
  }

  jobKeyForPdfUrl(pdfUrl: string): string | null {
    for (const job of this.jobs.values()) if (job.pdfUrl === pdfUrl) return job.key
    return null
  }

  pdfDiskPath(pdfUrl: string): string {
    const name = pdfUrl.replace('dentiva-safe://temp/', '')
    if (!/^[a-f0-9-]+\.pdf$/.test(name)) throw errValidation('Invalid print document reference.')
    const p = resolve(join(this.ctx.paths.tempDir, name))
    if (!p.startsWith(resolve(this.ctx.paths.tempDir) + sep)) throw errValidation('Invalid print document path.')
    return p
  }

  cleanupOldJobs(): void {
    const cutoff = Date.now() - 15 * 60 * 1000
    for (const job of this.jobs.values()) {
      if (job.createdAt < cutoff) {
        try {
          job.htmlWindow?.destroy()
        } catch {
          /* already destroyed */
        }
        this.jobs.delete(job.key)
      }
    }
  }
}
