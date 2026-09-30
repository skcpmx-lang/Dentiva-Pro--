import * as yauzl from 'yauzl'
import { errValidation } from '@shared/errors'

/**
 * Pre-extraction safety scan for backup archives.
 *
 * extract-zip 2.0.1 has an open HIGH advisory (unvalidated symlink path
 * traversal, no upstream fix available). Dentiva Pro only extracts archives
 * the app itself created and recorded in `backups_metadata`, so exploiting
 * this requires filesystem write access to the data directory — the same
 * privilege needed to modify the database directly (not a trust-boundary
 * crossing). This guard is defense in depth: the archive's central directory
 * is scanned BEFORE any extraction, and archives containing symlink entries
 * or unsafe entry paths are rejected outright.
 */
export function assertZipSafe(zipPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const done = (err?: Error): void => {
      if (settled) return
      settled = true
      if (err) reject(err)
      else resolve()
    }
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) {
        done(errValidation('The archive is not a readable ZIP file.'))
        return
      }
      zip.on('error', (e) => {
        try { zip.close() } catch { /* already closed */ }
        done(errValidation(`The archive is not a readable ZIP file: ${e.message}`))
      })
      zip.on('entry', (entry) => {
        if (settled) return
        // Unix mode bits live in the high 16 bits of the external attributes.
        const mode = (entry.externalFileAttributes >>> 16) & 0xffff
        if ((mode & 0xf000) === 0xa000) {
          try { zip.close() } catch { /* already closed */ }
          done(errValidation('The archive contains a symlink entry — refusing to extract it.'))
          return
        }
        const name = entry.fileName.split('\\').join('/')
        if (name.split('/').includes('..') || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) {
          try { zip.close() } catch { /* already closed */ }
          done(errValidation('The archive contains an unsafe path entry — refusing to extract it.'))
          return
        }
        zip.readEntry()
      })
      zip.on('end', () => done())
      zip.readEntry()
    })
  })
}
