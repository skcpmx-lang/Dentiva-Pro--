import Database from 'better-sqlite3'
import { MIGRATIONS } from './migrations'

export type Db = Database.Database

export function openDatabase(dbPath: string): Db {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')
  return db
}

export function migrate(db: Db): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`)
  const applied = new Set<number>(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version)
  )
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue
    const run = db.transaction(() => {
      db.exec(m.sql)
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version, m.name, new Date().toISOString()
      )
    })
    run()
  }
  return currentVersion(db)
}

export function currentVersion(db: Db): number {
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null }
  return row.v ?? 0
}

export function integrityCheck(db: Db): { ok: boolean; message: string } {
  const res = db.pragma('integrity_check') as { integrity_check: string }[]
  const msg = res.map((r) => r.integrity_check).join('; ')
  return { ok: msg === 'ok', message: msg }
}

export function foreignKeyCheck(db: Db): number {
  const rows = db.pragma('foreign_key_check') as unknown[]
  return rows.length
}
