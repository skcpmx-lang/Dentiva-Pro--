import { scryptSync, timingSafeEqual } from 'node:crypto'
import type { AppContext } from '../core/context'
import { errValidation, errConflict } from '@shared/errors'
import { ACTIVATION_SALT, ACTIVATION_VERIFIER, ACTIVATION_PARAMS, ACTIVATION_FINGERPRINT } from '../core/activationSecret'
import { audit } from './audit'

/**
 * Offline one-time activation (see docs/SECURITY_MODEL.md §6).
 * The verification uses a scrypt-derived verifier — the activation code is never
 * stored, logged, or transmitted anywhere in plaintext.
 */
function verifyCode(input: string): boolean {
  const normalized = String(input ?? '').replace(/\D/g, '')
  if (normalized.length < 6 || normalized.length > 32) return false
  try {
    const salt = Buffer.from(ACTIVATION_SALT, 'base64')
    const expected = Buffer.from(ACTIVATION_VERIFIER, 'base64')
    const actual = scryptSync(normalized, salt, ACTIVATION_PARAMS.keylen, {
      N: ACTIVATION_PARAMS.N, r: ACTIVATION_PARAMS.r, p: ACTIVATION_PARAMS.p
    })
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

export function isActivated(ctx: AppContext): boolean {
  const row = ctx.db.prepare('SELECT is_activated FROM activation_state WHERE id = 1').get() as { is_activated: number } | undefined
  return row?.is_activated === 1
}

export function activate(ctx: AppContext, code: string): void {
  if (isActivated(ctx)) throw errConflict('The application is already activated.')
  if (typeof code !== 'string' || code.trim().length === 0) throw errValidation('Activation code is required.')
  if (!verifyCode(code)) {
    audit(ctx, null, { action: 'activation', entity: 'activation_state', context: 'Failed activation attempt' })
    throw errValidation('Invalid activation code. Please check the code and try again.')
  }
  const now = new Date(ctx.clock().getTime()).toISOString()
  ctx.db
    .prepare(
      `INSERT INTO activation_state (id, is_activated, activated_at, verifier_fingerprint, created_at, updated_at)
       VALUES (1, 1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET is_activated = 1, activated_at = ?, verifier_fingerprint = ?, updated_at = ?`
    )
    .run(now, ACTIVATION_FINGERPRINT, now, now, now, ACTIVATION_FINGERPRINT, now)
  audit(ctx, null, { action: 'activation', entity: 'activation_state', context: 'Application activated' })
}
