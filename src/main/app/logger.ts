import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const MAX_LOG_BYTES = 5 * 1024 * 1024
const KEEP_FILES = 4
const SENSITIVE_KEYS = /password|passphrase|token|secret|activation|authorization/i

/** Redacts values of sensitive keys and truncates long payloads — logs must never carry secrets or patient data. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[deep]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return value.length > 300 ? `${value.slice(0, 300)}…` : value
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.slice(0, 10).map((v) => redact(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1)
  }
  return out
}

export interface Logger {
  info(module: string, message: string, meta?: unknown): void
  warn(module: string, message: string, meta?: unknown): void
  error(module: string, message: string, meta?: unknown): void
  path: string
}

export function createLogger(logsDir: string): Logger {
  mkdirSync(logsDir, { recursive: true })
  const logPath = join(logsDir, 'main.log')

  const rotateIfNeeded = (): void => {
    try {
      if (!existsSync(logPath)) return
      if (statSync(logPath).size < MAX_LOG_BYTES) return
      const existing = readdirSync(logsDir).filter((f) => f.startsWith('main.log.')).map((f) => Number(f.split('.').pop())).sort((a, b) => a - b)
      for (const n of existing) {
        if (n >= KEEP_FILES - 1) {
          const old = join(logsDir, `main.log.${n}`)
          if (existsSync(old)) unlinkSync(old)
        }
      }
      for (let n = Math.min(KEEP_FILES - 1, existing.length + 1); n >= 1; n--) {
        const from = join(logsDir, `main.log.${n - 1}`)
        const to = join(logsDir, `main.log.${n}`)
        if (n === 1 && existsSync(logPath)) renameSync(logPath, to)
        else if (existsSync(from)) renameSync(from, to)
      }
    } catch {
      /* rotation is best-effort */
    }
  }

  const write = (level: string, module: string, message: string, meta?: unknown): void => {
    try {
      rotateIfNeeded()
      const line = `${new Date().toISOString()} ${level.padEnd(5)} [${module}] ${message}${meta !== undefined ? ' ' + JSON.stringify(redact(meta)) : ''}\n`
      appendFileSync(logPath, line)
    } catch {
      /* logging must never crash the app */
    }
  }

  return {
    info: (m, msg, meta) => write('INFO', m, msg, meta),
    warn: (m, msg, meta) => write('WARN', m, msg, meta),
    error: (m, msg, meta) => write('ERROR', m, msg, meta),
    path: logPath
  }
}
