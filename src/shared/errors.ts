export const ERROR_CODES = [
  'ERR_VALIDATION',
  'ERR_PERMISSION',
  'ERR_LOCKED',
  'ERR_UNAUTHORIZED',
  'ERR_NOT_FOUND',
  'ERR_CONFLICT',
  'ERR_INTEGRITY',
  'ERR_IO',
  'ERR_ACTIVATION',
  'ERR_SETUP',
  'ERR_PRINTER',
  'ERR_CANCELLED',
  'ERR_INTERNAL'
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export class AppError extends Error {
  code: ErrorCode
  details?: unknown

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.code = code
    this.details = details
  }
}

export interface IpcResult<T> {
  ok: boolean
  data?: T
  code?: ErrorCode
  message?: string
  details?: unknown
}

export const errValidation = (m: string, d?: unknown): AppError => new AppError('ERR_VALIDATION', m, d)
export const errPermission = (m = 'You do not have permission to perform this action.'): AppError =>
  new AppError('ERR_PERMISSION', m)
export const errLocked = (m = 'The application is locked. Unlock to continue.'): AppError => new AppError('ERR_LOCKED', m)
export const errNotFound = (m = 'Record not found.'): AppError => new AppError('ERR_NOT_FOUND', m)
export const errConflict = (m: string, d?: unknown): AppError => new AppError('ERR_CONFLICT', m, d)
export const errIntegrity = (m: string, d?: unknown): AppError => new AppError('ERR_INTEGRITY', m, d)
export const errIo = (m: string, d?: unknown): AppError => new AppError('ERR_IO', m, d)
