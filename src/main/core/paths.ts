import { join } from 'node:path'

export interface AppPaths {
  dataDir: string
  dbPath: string
  attachmentsDir: string
  backupsDir: string
  logsDir: string
  tempDir: string
  logosDir: string
}

export function buildPaths(dataDir: string): AppPaths {
  return {
    dataDir,
    dbPath: join(dataDir, 'dentiva.sqlite3'),
    attachmentsDir: join(dataDir, 'attachments'),
    backupsDir: join(dataDir, 'backups'),
    logsDir: join(dataDir, 'logs'),
    tempDir: join(dataDir, 'temp'),
    logosDir: join(dataDir, 'logos')
  }
}
