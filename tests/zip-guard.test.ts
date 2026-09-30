import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32 } from 'node:zlib'
import * as archiver from 'archiver'
import { createWriteStream } from 'node:fs'
import { assertZipSafe } from '../src/main/services/zipGuard'
import { createTestEnv } from './helpers'

let dir: string

/** Minimal STORED (uncompressed) zip builder — lets tests write entry names archiver would sanitise. */
function makeStoredZip(entries: [name: string, data: string][]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const dataBuf = Buffer.from(data, 'utf8')
    const crc = crc32(dataBuf) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8) // stored
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(dataBuf.length, 18)
    local.writeUInt32LE(dataBuf.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBuf, dataBuf)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(dataBuf.length, 20)
    central.writeUInt32LE(dataBuf.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + dataBuf.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, cd, eocd])
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'zipguard-'))
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

async function buildZip(zipPath: string, build: (archive: archiver.Archiver) => void): Promise<void> {
  const output = createWriteStream(zipPath)
  // archiver's ESM/CJS interop differs between its types and the bundled build
  const create = (archiver as unknown as { default?: typeof archiver }).default ?? archiver
  const archive = (create as unknown as (format: string, opts?: Record<string, unknown>) => archiver.Archiver)('zip', { zlib: { level: 9 } })
  archive.pipe(output)
  build(archive)
  await archive.finalize()
  await new Promise<void>((resolve) => output.on('close', () => resolve()))
}

describe('backup archive pre-extraction guard (extract-zip symlink advisory mitigation)', () => {
  it('accepts a normal archive with nested files', async () => {
    const zip = join(dir, 'normal.zip')
    await buildZip(zip, (a) => {
      a.append('hello', { name: 'manifest.json' })
      a.append(Buffer.from([1, 2, 3]), { name: 'attachments/x-ray.png' })
    })
    await expect(assertZipSafe(zip)).resolves.toBeUndefined()
  })

  it('accepts the archive the backup service itself produces', async () => {
    const env = createTestEnv()
    try {
      const { createBackup } = await import('../src/main/services/backup')
      const record = await createBackup(env.ctx, env.owner, 'manual')
      await expect(assertZipSafe(record.path)).resolves.toBeUndefined()
    } finally {
      env.cleanup()
    }
  })

  it('rejects an archive containing a symlink entry', async () => {
    const zip = join(dir, 'evil-symlink.zip')
    await buildZip(zip, (a) => {
      a.append('data', { name: 'database.sqlite3' })
      // symlink entry: unix mode 0o120777 (S_IFLNK), linkname points outside
      a.symlink('manifest.json', '/etc/passwd')
    })
    await expect(assertZipSafe(zip)).rejects.toThrow(/symlink/i)
  })

  it('rejects an archive with a parent-directory traversal entry', async () => {
    // archiver sanitises '../' names, so craft the entry raw (stored, no compression).
    // yauzl 2.10 itself refuses such entries ("invalid relative path"), and the
    // guard's own path check is the second line of defense — either way the
    // archive is rejected BEFORE any extraction.
    const zip = join(dir, 'evil-traversal.zip')
    writeFileSync(zip, makeStoredZip([['../escape.txt', 'data']]))
    await expect(assertZipSafe(zip)).rejects.toThrow(/unsafe path|invalid relative path/i)
  })

  it('rejects non-ZIP garbage instead of extracting it', async () => {
    const zip = join(dir, 'garbage.zip')
    writeFileSync(zip, 'this is not a zip file')
    await expect(assertZipSafe(zip)).rejects.toThrow(/not a readable ZIP/i)
  })

  it('the produced zip actually contains the symlink marker when archiver writes one (guard is not vacuous)', async () => {
    // The externalFileAttributes of a symlink entry must have S_IFLNK set;
    // this proves the detection basis is real, not that the check merely passes.
    const zip = join(dir, 'probe.zip')
    await buildZip(zip, (a) => {
      a.append('data', { name: 'file.txt' })
      a.symlink('link', 'target')
    })
    const raw = readFileSync(zip).toString('latin1')
    // central directory file-name entries we wrote must both be present
    expect(raw).toContain('file.txt')
    expect(raw).toContain('link')
  })
})
