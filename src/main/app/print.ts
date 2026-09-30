import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { app, BrowserWindow } from 'electron'
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
 * Injects the print-font strategy into a print document. The renderer
 * templates are complete HTML documents — injecting into their <head> keeps a
 * single valid document instead of nesting a full document inside <body>.
 * Bare HTML fragments are wrapped in a minimal document.
 *
 * IMPORTANT — print documents embed their fonts as base64 DATA-URL
 * @font-face rules; they must NOT reference fonts over the custom
 * dentiva-safe:// protocol, and they can not rely on system fonts for
 * Bengali. CI differential evidence (runs 36722132504 / 36723879956 /
 * 36726128680 / 36727894316):
 *
 *  - pages whose webfonts are served over dentiva-safe:// NEVER print
 *    (print compositor: "CompositePages: Page reading failed", printToPDF
 *    rejects with "Printing failed") — WOFF2 and TTF alike;
 *  - the system-font strategy (no @font-face at all) ALSO failed for every
 *    real Bengali document, on Linux CI AND in the packaged Windows app;
 *  - the ONLY Bengali document that ever printed on this stack (Electron 44 /
 *    Chromium 152) was a page whose webfont was inlined as a data: URL
 *    (run 36727894316, "mixed page" diagnostic).
 *
 * A data: URL is self-contained: the print compositor needs no secondary
 * resource fetch (the dentiva-safe:// scheme is registered for the app's
 * network context, but the compositor's serialization path cannot re-fetch
 * through it). The bundled Noto Sans Bengali TTFs are therefore inlined
 * base64. The e2e/print-geometry-entry.ts diagnostics keep probing the
 * remaining attribution questions (system-font resolution, settle-time
 * races, option matrix) as informational, non-gating cases.
 */
function injectPrintFonts(html: string, fontCss: string): string {
  const inject = `<meta charset="utf-8"><style>${fontCss}</style>`
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + inject)
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + `<head>${inject}</head>`)
  return `<!DOCTYPE html><html><head>${inject}</head><body>${html}</body></html>`
}

/** Google-subset unicode ranges for the bundled Noto Sans Bengali builds. */
const BENGALI_RANGE = 'U+0964-0965, U+0980-09FE, U+20B9'
const LATIN_RANGE = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'

/**
 * Print pipeline (docs/PRINT_SPECIFICATION.md):
 * renderer composes semantic HTML → hidden window renders it → printToPDF
 * produces the canonical document (preview == output) → print via the same
 * window (Windows printer selection / silent to a saved printer).
 */
export class PrintManager {
  private jobs = new Map<string, PrintJob>()
  private fontFaceCss: string | null = null

  constructor(private ctx: AppContext, private fontsDir?: string) {}

  /**
   * @font-face rules inlining the bundled Noto Sans Bengali TTFs as base64
   * data URLs (see injectPrintFonts for why data URLs specifically). Built
   * once, cached. If the font files are unavailable the CSS degrades to an
   * empty string and the system-font stack applies (printing Bengali may
   * then fail on this Electron build — see PRINT_SPECIFICATION.md).
   */
  private buildFontFaceCss(): string {
    if (this.fontFaceCss !== null) return this.fontFaceCss
    const dir = this.fontsDir ?? (app.isPackaged ? join(process.resourcesPath, 'fonts') : join(app.getAppPath(), 'resources', 'fonts'))
    const faces: string[] = []
    for (const subset of ['bengali', 'latin'] as const) {
      for (const weight of [400, 500, 600, 700] as const) {
        const file = `noto-sans-bengali-${subset}-${weight}-normal.ttf`
        try {
          const b64 = readFileSync(join(dir, file)).toString('base64')
          const range = subset === 'bengali' ? BENGALI_RANGE : LATIN_RANGE
          faces.push(`@font-face { font-family: 'Noto Sans Bengali'; src: url(data:font/ttf;base64,${b64}) format('truetype'); font-weight: ${weight}; font-style: normal; unicode-range: ${range}; }`)
        } catch {
          // Font file missing — degrade to the system stack.
        }
      }
    }
    this.fontFaceCss = faces.join('\n')
    return this.fontFaceCss
  }

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

    // Data-URL embedded fonts for print (see injectPrintFonts docblock):
    // the compositor cannot re-fetch dentiva-safe:// subresources and system
    // Bengali fonts failed on both platforms — inline base64 TTFs instead.
    const fontCss = `
      ${this.buildFontFaceCss()}
      html, body { font-family: 'Noto Sans Bengali', 'Nirmala UI', 'Inter', system-ui, sans-serif; }
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
