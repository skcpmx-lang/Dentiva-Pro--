import { createHash } from 'node:crypto'
import { createWriteStream, createReadStream, statSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import * as archiverNs from 'archiver'
import extract from 'extract-zip'
import type { AppContext, Actor } from '../core/context'
import { errValidation, errNotFound, errConflict, errIo } from '@shared/errors'
import type { BackupRecord } from '@shared/types'
import { currentVersion, integrityCheck, foreignKeyCheck, openDatabase, migrate } from '../core/db'
import { getSettings, setSettingsForSystem } from './settings'
import { audit } from './audit'
import { notify } from './notifications'

interface Manifest {
  formatVersion: 1
  appVersion: string
  schemaVersion: number
  createdAt: string
  backupType: 'manual' | 'auto' | 'pre_restore'
  files: { path: string; size: number; sha256: string }[]
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function backupFileName(now: Date, type: string): string {
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  return `DentivaPro_Backup_${stamp}${type === 'pre_restore' ? '_pre-restore' : type === 'auto' ? '_auto' : ''}.zip`
}

async function sha256File(p: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(p)
    stream.on('data', (c) => hash.update(c))
    stream.on('end', () => resolveHash(hash.digest('hex')))
    stream.on('error', reject)
  })
}

async function walkFiles(root: string, base = ''): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(join(root, base), { withFileTypes: true })
  for (const e of entries) {
    const rel = base ? `${base}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...(await walkFiles(root, rel)))
    else out.push(rel)
  }
  return out
}

function mapBackupRecord(ctx: AppContext, r: Record<string, unknown>): BackupRecord {
  let fileExists = false
  try {
    fileExists = statSyncQuiet(r.path as string) !== null
  } catch {
    fileExists = false
  }
  return {
    id: r.id as number,
    filename: r.filename as string,
    path: r.path as string,
    sizeBytes: r.size_bytes as number,
    sha256: (r.sha256 as string | null) ?? null,
    schemaVersion: r.schema_version as number,
    appVersion: r.app_version as string,
    backupType: r.backup_type as BackupRecord['backupType'],
    status: r.status as BackupRecord['status'],
    createdBy: (r.created_by as string | null) ?? 'system',
    createdAt: r.created_at as string,
    verifiedAt: (r.verified_at as string | null) ?? null,
    fileExists
  }
}

function statSyncQuiet(p: string): { size: number } | null {
  try {
    const s = statSync(p)
    return { size: s.size }
  } catch {
    return null
  }
}

function backupFolder(ctx: AppContext): string {
  const s = getSettings(ctx).backup.folder
  return s && s.trim() ? s : ctx.paths.backupsDir
}

export function backupList(ctx: AppContext): BackupRecord[] {
  const rows = ctx.db.prepare('SELECT * FROM backups_metadata ORDER BY created_at DESC LIMIT 200').all() as Record<string, unknown>[]
  return rows.map((r) => mapBackupRecord(ctx, r))
}

export function backupStatus(ctx: AppContext) {
  const s = getSettings(ctx).backup
  const last = ctx.db.prepare("SELECT created_at FROM backups_metadata WHERE status = 'verified' ORDER BY created_at DESC LIMIT 1").get() as { created_at: string } | undefined
  return {
    lastBackupAt: last?.created_at ?? null,
    lastAutoBackupAt: s.lastAutoBackupAt,
    scheduleDays: s.scheduleDays,
    folder: s.folder
  }
}

export async function createBackup(ctx: AppContext, actor: Actor | null, type: 'manual' | 'auto' | 'pre_restore' = 'manual'): Promise<BackupRecord> {
  const now = ctx.clock()
  const folder = backupFolder(ctx)
  await mkdir(folder, { recursive: true })
  const filename = backupFileName(now, type)
  const zipPath = join(folder, filename)
  if (statSyncQuiet(zipPath)) throw errConflict(`A backup named ${filename} already exists. Wait a second and try again.`)

  const tempDir = join(ctx.paths.tempDir, `backup-${now.getTime()}`)
  await mkdir(tempDir, { recursive: true })
  const dbSnapshot = join(tempDir, 'database.sqlite3')
  try {
    // Consistent online snapshot of the live database (WAL-safe).
    ctx.db.prepare('BEGIN IMMEDIATE').run()
    try {
      ctx.db.exec(`VACUUM INTO '${dbSnapshot.replace(/'/g, "''")}'`)
    } finally {
      ctx.db.prepare('COMMIT').run()
    }

    // Build the manifest with per-file checksums.
    const files: Manifest['files'] = []
    files.push({ path: 'database.sqlite3', size: (await stat(dbSnapshot)).size, sha256: await sha256File(dbSnapshot) })
    const stagingAttach = join(tempDir, 'attachments')
    await mkdir(stagingAttach, { recursive: true })
    const attachmentRoot = ctx.paths.attachmentsDir
    let attachmentFiles: string[] = []
    try {
      attachmentFiles = await walkFiles(attachmentRoot)
    } catch {
      attachmentFiles = [] // no attachments yet
    }
    for (const rel of attachmentFiles) {
      const src = join(attachmentRoot, rel)
      const dest = join(stagingAttach, rel)
      await mkdir(dirname(dest), { recursive: true })
      await copyFile(src, dest)
      files.push({ path: `attachments/${rel}`, size: (await stat(src)).size, sha256: await sha256File(src) })
    }
    const manifest: Manifest = {
      formatVersion: 1,
      appVersion: ctx.appVersion,
      schemaVersion: currentVersion(ctx.db),
      createdAt: now.toISOString(),
      backupType: type,
      files
    }
    await writeFile(join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

    // Zip it.
    await new Promise<void>((resolveZip, rejectZip) => {
      const output = createWriteStream(zipPath)
      const archiver = (archiverNs as unknown as { default?: typeof archiverNs } ).default ?? archiverNs
      const archive = (archiver as unknown as (format: string, opts?: Record<string, unknown>) => archiverNs.Archiver)('zip', { level: 6 })
      output.on('close', () => resolveZip())
      output.on('error', rejectZip)
      archive.on('error', rejectZip)
      archive.pipe(output)
      archive.file(dbSnapshot, { name: 'database.sqlite3' })
      archive.file(join(tempDir, 'manifest.json'), { name: 'manifest.json' })
      if (attachmentFiles.length > 0) archive.directory(stagingAttach, 'attachments')
      void archive.finalize()
    })
  } catch (e) {
    await rm(zipPath, { force: true })
    await rm(tempDir, { recursive: true, force: true })
    if (e instanceof Error) {
      throw errIo('Backup failed: ' + e.message)
    }
    throw e
  }

  // Post-create verification: re-open the archive and verify every checksum.
  const record = insertBackupRecord(ctx, actor, { filename, zipPath, type, now })
  const verified = await verifyBackupIntegrity(zipPath)
  if (!verified.ok) {
    ctx.db.prepare("UPDATE backups_metadata SET status = 'failed' WHERE id = ?").run(record.id)
    await rm(zipPath, { force: true })
    await rm(tempDir, { recursive: true, force: true })
    throw errIo(`Backup verification failed: ${verified.message}. The backup file was discarded.`)
  }
  ctx.db.prepare("UPDATE backups_metadata SET status = 'verified', verified_at = ? WHERE id = ?")
    .run(now.toISOString(), record.id)
  await rm(tempDir, { recursive: true, force: true })

  if (type === 'auto') setSettingsForSystem(ctx, (s) => ({ ...s, backup: { ...s.backup, lastAutoBackupAt: now.toISOString() } }))
  audit(ctx, actor, { action: 'backup', entity: 'backup', entityId: record.id, context: `${type} backup verified (${(record.sizeBytes / 1048576).toFixed(2)} MB)` })
  notify(ctx, {
    type: 'backup', severity: 'success', audience: 'admin',
    title: 'Backup completed', body: `${filename} was created and verified successfully.`
  })
  return mapBackupRecord(ctx, ctx.db.prepare('SELECT * FROM backups_metadata WHERE id = ?').get(record.id) as Record<string, unknown>)
}

function insertBackupRecord(ctx: AppContext, actor: Actor | null, meta: { filename: string; zipPath: string; type: string; now: Date }): BackupRecord {
  const size = statSyncQuiet(meta.zipPath)?.size ?? 0
  const run = ctx.db.transaction((): number => {
    const r = ctx.db.prepare(`
      INSERT INTO backups_metadata (filename, path, size_bytes, sha256, schema_version, app_version, backup_type, status, created_by, created_at)
      VALUES (?, ?, ?, NULL, ?, ?, ?, 'pending', ?, ?)
    `).run(meta.filename, meta.zipPath, size, currentVersion(ctx.db), ctx.appVersion, meta.type, actor?.username ?? 'system', meta.now.toISOString())
    return Number(r.lastInsertRowid)
  })
  const id = run()
  // The zip's own hash is recorded after creation for outer integrity.
  void sha256File(meta.zipPath).then((h) => {
    try {
      ctx.db.prepare('UPDATE backups_metadata SET sha256 = ? WHERE id = ?').run(h, id)
    } catch {
      /* non-fatal */
    }
  })
  const row = ctx.db.prepare('SELECT * FROM backups_metadata WHERE id = ?').get(id) as Record<string, unknown>
  return mapBackupRecord(ctx, row)
}

export async function verifyBackup(ctx: AppContext, id: number): Promise<BackupRecord> {
  const row = ctx.db.prepare('SELECT * FROM backups_metadata WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) throw errNotFound('Backup record not found.')
  const result = await verifyBackupIntegrity(row.path as string)
  const now = ctx.clock().toISOString()
  if (result.ok) {
    ctx.db.prepare("UPDATE backups_metadata SET status = 'verified', verified_at = ? WHERE id = ?").run(now, id)
  } else {
    ctx.db.prepare("UPDATE backups_metadata SET status = 'failed' WHERE id = ?").run(id)
  }
  return mapBackupRecord(ctx, ctx.db.prepare('SELECT * FROM backups_metadata WHERE id = ?').get(id) as Record<string, unknown>)
}

async function verifyBackupIntegrity(zipPath: string): Promise<{ ok: boolean; message: string }> {
  try {
    if (!statSyncQuiet(zipPath)) return { ok: false, message: 'backup file is missing' }
    const tempDir = join(tmpdir(), `dentiva-verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    await mkdir(tempDir, { recursive: true })
    try {
      await extract(zipPath, { dir: tempDir })
      const manifestRaw = await readFile(join(tempDir, 'manifest.json'), 'utf8')
      const manifest = JSON.parse(manifestRaw) as Manifest
      if (manifest.formatVersion !== 1) return { ok: false, message: 'unsupported backup format' }
      for (const f of manifest.files) {
        if (f.path.includes('..')) return { ok: false, message: 'invalid manifest path' }
        const p = join(tempDir, f.path)
        const s = await stat(p)
        if (s.size !== f.size) return { ok: false, message: `size mismatch for ${f.path}` }
        const h = await sha256File(p)
        if (h !== f.sha256) return { ok: false, message: `checksum mismatch for ${f.path}` }
      }
      return { ok: true, message: 'ok' }
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'unknown error' }
  }
}

export function backupSchedule(ctx: AppContext, actor: Actor, folder: string | null, scheduleDays: number): void {
  if (![0, 7, 15, 30].includes(scheduleDays)) throw errValidation('Backup schedule must be 7, 15 or 30 days, or disabled.')
  if (scheduleDays > 0 && !folder) throw errValidation('Choose a backup folder before enabling scheduled backups.')
  setSettingsForSystem(ctx, (s) => ({ ...s, backup: { ...s.backup, folder, scheduleDays } }))
  audit(ctx, actor, { action: 'settings_change', entity: 'settings', entityId: 'backup', newValue: { folder, scheduleDays } })
}

/** Runs on startup: create the scheduled backup when due. */
export async function maybeRunScheduledBackup(ctx: AppContext): Promise<void> {
  const s = getSettings(ctx).backup
  if (!s.scheduleDays || !s.folder) return
  const last = s.lastAutoBackupAt ? new Date(s.lastAutoBackupAt).getTime() : 0
  const dueAt = last + s.scheduleDays * 86400000
  if (ctx.clock().getTime() < dueAt) return
  try {
    await createBackup(ctx, null, 'auto')
  } catch (e) {
    notify(ctx, {
      type: 'backup', severity: 'error', audience: 'admin',
      title: 'Scheduled backup failed',
      body: e instanceof Error ? e.message : 'Unknown error while creating the scheduled backup.'
    })
  }
}

/**
 * Restore pipeline (spec §61):
 * verify → typed confirmation → pre-restore backup → swap files → verify restored DB
 * → rollback on failure. The application reloads state afterwards via the callback.
 */
export async function restoreBackup(
  ctx: AppContext,
  actor: Actor,
  id: number,
  confirm: string,
  onRestored?: () => void
): Promise<{ ok: true; backupUsed: string }> {
  if (confirm !== 'RESTORE') throw errValidation('Type RESTORE to confirm. Restoring replaces ALL current data with the backup contents.')
  const row = ctx.db.prepare('SELECT * FROM backups_metadata WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) throw errNotFound('Backup record not found.')
  const zipPath = row.path as string
  const verify = await verifyBackupIntegrity(zipPath)
  if (!verify.ok) throw errIo(`Backup verification failed (${verify.message}). Restore aborted — your current data is untouched.`)

  const now = ctx.clock()
  const staging = join(ctx.paths.tempDir, `restore-${now.getTime()}`)
  await mkdir(staging, { recursive: true })
  await extract(zipPath, { dir: staging })
  const manifest = JSON.parse(await readFile(join(staging, 'manifest.json'), 'utf8')) as Manifest
  if (manifest.schemaVersion > currentVersion(ctx.db)) {
    await rm(staging, { recursive: true, force: true })
    throw errConflict(`This backup uses a newer database schema (v${manifest.schemaVersion}) than this application supports. Update Dentiva Pro first.`)
  }

  // Mandatory pre-restore backup of the CURRENT data.
  const preRestore = await createBackup(ctx, actor, 'pre_restore')

  const oldAttachments = `${ctx.paths.attachmentsDir}.pre-restore-${now.getTime()}`
  const oldDb = `${ctx.paths.dbPath}.pre-restore-${now.getTime()}`
  let swapped = false
  try {
    ctx.db.close()
    await rename(ctx.paths.dbPath, oldDb)
    await copyFile(join(staging, 'database.sqlite3'), ctx.paths.dbPath)
    // attachments swap
    try {
      await rename(ctx.paths.attachmentsDir, oldAttachments)
    } catch {
      // attachments dir may not exist
    }
    const stagedAttachments = join(staging, 'attachments')
    await mkdir(ctx.paths.attachmentsDir, { recursive: true })
    try {
      const files = await walkFiles(stagedAttachments)
      for (const rel of files) {
        const dest = join(ctx.paths.attachmentsDir, rel)
        if (!resolve(dest).startsWith(resolve(ctx.paths.attachmentsDir) + sep)) throw new Error('invalid path in backup')
        await mkdir(dirname(dest), { recursive: true })
        await copyFile(join(stagedAttachments, rel), dest)
      }
    } catch {
      // backup without attachments — fine
    }
    swapped = true

    // Reopen and verify the restored database.
    const newDb = openDatabase(ctx.paths.dbPath)
    migrate(newDb)
    const integrity = integrityCheck(newDb)
    const fkIssues = foreignKeyCheck(newDb)
    if (!integrity.ok || fkIssues > 0) {
      newDb.close()
      throw errIo(`Restored database failed verification (${integrity.message}; FK issues: ${fkIssues}).`)
    }
    ctx.db = newDb

    // Success: mark records + audit + notify.
    ctx.db.prepare("UPDATE backups_metadata SET status = 'restored' WHERE id = ?").run(id)
    ctx.db.prepare("UPDATE backups_metadata SET status = 'verified' WHERE id = ?").run(preRestore.id)
    audit(ctx, actor, {
      action: 'restore_db', entity: 'backup', entityId: id,
      context: `Restored ${row.filename as string} (pre-restore backup: ${preRestore.filename})`
    })
    notify(ctx, {
      type: 'restore', severity: 'success', audience: 'admin',
      title: 'Restore completed',
      body: `Data was restored from ${row.filename as string}. A backup of the previous state was saved first.`
    })
    await rm(oldDb, { force: true })
    await rm(oldAttachments, { recursive: true, force: true })
    await rm(staging, { recursive: true, force: true })
    onRestored?.()
    return { ok: true, backupUsed: row.filename as string }
  } catch (e) {
    // Rollback to the pre-restore state — current data must never be lost.
    if (swapped) {
      try {
        ctx.db.close()
      } catch {
        /* already closed */
      }
      try {
        await rm(ctx.paths.dbPath, { force: true })
        await rename(oldDb, ctx.paths.dbPath)
        await rm(ctx.paths.attachmentsDir, { recursive: true, force: true })
        try {
          await rename(oldAttachments, ctx.paths.attachmentsDir)
        } catch {
          await mkdir(ctx.paths.attachmentsDir, { recursive: true })
        }
      } catch {
        /* best effort — the pre-restore backup zip still exists */
      }
    }
    try {
      ctx.db = openDatabase(ctx.paths.dbPath)
    } catch {
      throw errIo('Restore failed and the previous database could not be reopened. Restore manually from: ' + preRestore.path)
    }
    notify(ctx, {
      type: 'restore', severity: 'error', audience: 'admin',
      title: 'Restore failed',
      body: `The previous data was kept. Error: ${e instanceof Error ? e.message : 'unknown'}. A safety backup exists at ${preRestore.path}`
    })
    throw e
  }
}
