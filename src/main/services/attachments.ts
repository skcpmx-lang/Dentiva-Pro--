import { createHash, randomUUID } from 'node:crypto'
import { statSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs'
import { dirname, extname, join, resolve, basename, sep } from 'node:path'
import type { AppContext, Actor } from '../core/context'
import { errValidation, errNotFound, errIo } from '@shared/errors'
import type { Attachment } from '@shared/types'
import { audit } from './audit'

const MAX_SIZE_BYTES = 25 * 1024 * 1024 // 25 MB per attachment

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']
const DOC_EXTS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv', '.rtf']
const ALL_ALLOWED = new Set([...IMAGE_EXTS, ...DOC_EXTS])

function sniffMime(buffer: Buffer, ext: string): string | null {
  if (buffer.length < 4) return null
  const hex4 = buffer.subarray(0, 4).toString('hex')
  const ascii4 = buffer.subarray(0, 4).toString('latin1')
  if (hex4.startsWith('ffd8ff')) return 'image/jpeg'
  if (buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png'
  if (ascii4 === 'GIF8') return 'image/gif'
  if (ascii4 === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  if (buffer.subarray(0, 2).toString('latin1') === 'BM') return 'image/bmp'
  if (ascii4 === '%PDF') return 'application/pdf'
  switch (ext) {
    case '.txt': case '.csv': return 'text/plain'
    case '.doc': return 'application/msword'
    case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case '.xls': return 'application/vnd.ms-excel'
    case '.xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case '.rtf': return 'application/rtf'
    default: return null
  }
}

function mapAttachment(ctx: AppContext, r: Record<string, unknown>): Attachment {
  const uploader = r.uploaded_by
    ? (ctx.db.prepare('SELECT display_name FROM users WHERE id = ?').get(r.uploaded_by) as { display_name: string } | undefined)?.display_name
    : null
  return {
    id: r.id as number,
    patientId: r.patient_id as number,
    visitId: (r.visit_id as number | null) ?? null,
    originalFilename: r.original_filename as string,
    storedFilename: r.stored_filename as string,
    mimeType: r.mime_type as string,
    sizeBytes: r.size_bytes as number,
    sha256: r.sha256 as string,
    category: r.category as string,
    description: (r.description as string | null) ?? null,
    uploadedBy: uploader ?? '—',
    uploadedAt: r.uploaded_at as string,
    url: `dentiva-safe://attach/${r.patient_id}/${r.stored_filename}`
  }
}

export function attachmentList(ctx: AppContext, patientId: number): Attachment[] {
  const rows = ctx.db.prepare(
    'SELECT * FROM attachments WHERE patient_id = ? AND deleted_at IS NULL ORDER BY uploaded_at DESC'
  ).all(patientId) as unknown as Record<string, unknown>[]
  return rows.map((r) => mapAttachment(ctx, r))
}

/**
 * Validates and stores a file into the patient's attachment folder.
 * The source path always originates from a native file dialog in the main
 * process — never from a renderer-supplied free-text path.
 */
export function attachmentStore(
  ctx: AppContext,
  actor: Actor,
  sourcePath: string,
  meta: { patientId: number; visitId?: number | null; category?: string; description?: string | null }
): Attachment {
  const patient = ctx.db.prepare('SELECT id FROM patients WHERE id = ?').get(meta.patientId)
  if (!patient) throw errNotFound('Patient not found.')
  if (meta.visitId && !ctx.db.prepare('SELECT id FROM visits WHERE id = ? AND patient_id = ?').get(meta.visitId, meta.patientId)) {
    throw errValidation('The linked visit does not belong to this patient.')
  }

  const src = resolve(sourcePath)
  let info: { isFile: boolean; size: number }
  try {
    const s = statSync(src)
    info = { isFile: s.isFile(), size: s.size }
  } catch {
    throw errIo('The selected file could not be read.')
  }
  if (!info.isFile) throw errValidation('The selected path is not a file.')
  if (info.size <= 0) throw errValidation('The selected file is empty.')
  if (info.size > MAX_SIZE_BYTES) {
    throw errValidation(`File is too large (${(info.size / 1048576).toFixed(1)} MB). Maximum attachment size is 25 MB.`)
  }

  const ext = extname(src).toLowerCase()
  if (!ALL_ALLOWED.has(ext)) {
    throw errValidation(
      `File type "${ext || 'unknown'}" is not supported. Allowed: images (JPG, PNG, WebP, GIF, BMP), PDF and common document formats.`
    )
  }

  const buffer = readFileSync(src)
  const sniffed = sniffMime(buffer, ext)
  if (!sniffed) throw errValidation('The file content does not match a supported type — it may be corrupted or renamed.')
  if (IMAGE_EXTS.includes(ext) && !sniffed.startsWith('image/')) {
    throw errValidation('The file claims to be an image but its content is not a valid image.')
  }
  if (ext === '.pdf' && sniffed !== 'application/pdf') throw errValidation('The file is not a valid PDF.')

  const sha256 = createHash('sha256').update(buffer).digest('hex')
  const storedFilename = `${randomUUID()}${ext}`
  const category = meta.category && ['image', 'document', 'prescription', 'report', 'xray', 'other'].includes(meta.category)
    ? meta.category
    : sniffed.startsWith('image/') ? 'image' : 'document'

  const dir = join(ctx.paths.attachmentsDir, String(meta.patientId))
  const dest = join(dir, storedFilename)
  // Defense in depth: the resolved destination must stay inside the attachments root.
  if (!resolve(dest).startsWith(resolve(ctx.paths.attachmentsDir) + sep)) {
    throw errIo('Invalid attachment destination.')
  }
  try {
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(src, dest)
  } catch {
    throw errIo('Failed to store the attachment. Check available disk space.')
  }

  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction((): number => {
    const r = ctx.db.prepare(`
      INSERT INTO attachments (patient_id, visit_id, original_filename, stored_filename, mime_type, size_bytes,
        sha256, category, description, uploaded_by, uploaded_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      meta.patientId, meta.visitId ?? null, basename(src), storedFilename, sniffed, info.size,
      sha256, category, meta.description ?? null, actor.userId, ts
    )
    const id = Number(r.lastInsertRowid)
    audit(ctx, actor, {
      action: 'create', entity: 'attachment', entityId: id,
      newValue: { patientId: meta.patientId, filename: basename(src), sha256, size: info.size }
    })
    return id
  })
  const id = run()
  const row = ctx.db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as Record<string, unknown>
  return mapAttachment(ctx, row)
}

export function attachmentDelete(ctx: AppContext, actor: Actor, id: number, confirm: string): void {
  if (confirm !== 'DELETE') throw errValidation('Type DELETE to confirm attachment deletion.')
  const existing = ctx.db.prepare('SELECT * FROM attachments WHERE id = ? AND deleted_at IS NULL').get(id) as Record<string, unknown> | undefined
  if (!existing) throw errNotFound('Attachment not found.')
  const ts = new Date(ctx.clock().getTime()).toISOString()
  const run = ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE attachments SET deleted_at = ? WHERE id = ?').run(ts, id)
    audit(ctx, actor, { action: 'delete', entity: 'attachment', entityId: id, oldValue: { filename: existing.original_filename } })
  })
  run()
}

export function attachmentSourcePath(ctx: AppContext, id: number): string {
  const row = ctx.db.prepare('SELECT patient_id, stored_filename FROM attachments WHERE id = ? AND deleted_at IS NULL').get(id) as
    { patient_id: number; stored_filename: string } | undefined
  if (!row) throw errNotFound('Attachment not found.')
  const p = join(ctx.paths.attachmentsDir, String(row.patient_id), row.stored_filename)
  if (!resolve(p).startsWith(resolve(ctx.paths.attachmentsDir))) throw errIo('Invalid attachment path.')
  return p
}
