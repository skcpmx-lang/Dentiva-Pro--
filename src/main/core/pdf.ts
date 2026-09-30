import { readFileSync } from 'node:fs'

/**
 * Pure PDF inspection helpers (no Electron imports) so they can be unit-tested
 * under plain Node/vitest and reused by the print pipeline and e2e geometry
 * tests. All parsing is deliberately simple: these operate on Chromium
 * printToPDF output, which is uncompressed enough at the object-header level
 * for regex extraction of /Type /Page and /MediaBox.
 */

/** Counts pages in a PDF buffer (enough for display purposes). */
export function countPdfPages(pdf: Buffer): number {
  const text = pdf.toString('latin1')
  const matches = text.match(/\/Type\s*\/Page[^s]/g)
  if (matches && matches.length > 0) return matches.length
  const counts = text.match(/\/Count\s+(\d+)/g)
  if (counts && counts.length > 0) {
    const nums = counts.map((c) => Number(c.replace(/\D+/g, '')))
    return Math.max(...nums)
  }
  return 1
}

/** Extracts the MediaBox of the first page in PDF points (1 pt = 1/72") — used by tests to assert exact paper geometry. */
export function pdfFirstPageSizePoints(pdf: Buffer): { width: number; height: number } | null {
  const text = pdf.toString('latin1')
  const m = text.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/)
  if (!m) return null
  return { width: Number(m[3]) - Number(m[1]), height: Number(m[4]) - Number(m[2]) }
}

/** Reads a generated PDF from disk (test helper). */
export function readPdfForTest(pdfPath: string): Buffer {
  return readFileSync(pdfPath)
}

/** Millimetres → PDF points. */
export function mmToPoints(mm: number): number {
  return (mm * 72) / 25.4
}
