/**
 * Money is represented everywhere as INTEGER PAISA (1 BDT = 100 paisa).
 * All arithmetic is integer arithmetic — no floating point in business logic.
 */

/** Parse a user-entered amount ("1234.50", "১২৩"? — Bengali digits not parsed here) into paisa. Throws on invalid. */
export function parseMoneyToPaisa(input: string | number): number {
  let s = String(input ?? '').trim()
  if (s === '') throw new Error('Amount is required')
  s = s.replace(/[৳,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error('Invalid amount. Use up to two decimal places, e.g. 1250.50')
  const [whole, frac = ''] = s.split('.')
  const fracPadded = (frac + '00').slice(0, 2)
  const paisa = Number(whole) * 100 + Number(fracPadded)
  if (!Number.isSafeInteger(paisa)) throw new Error('Amount is too large')
  return paisa
}

/** Convert paisa to a display string: ৳ 1,234.56 (fraction shown only when present). */
export function formatPaisa(paisa: number, opts?: { withSymbol?: boolean }): string {
  const withSymbol = opts?.withSymbol !== false
  const neg = paisa < 0
  const abs = Math.abs(Math.round(paisa))
  const whole = Math.floor(abs / 100)
  const frac = abs % 100
  const wholeStr = whole.toLocaleString('en-IN')
  const fracStr = frac === 0 ? '' : `.${String(frac).padStart(2, '0')}`
  return `${neg ? '-' : ''}${withSymbol ? '\u09F3 ' : ''}${wholeStr}${fracStr}`
}

/** Convert paisa to a plain decimal string without symbol (for CSV export). */
export function paisaToDecimalString(paisa: number): string {
  const neg = paisa < 0
  const abs = Math.abs(Math.round(paisa))
  return `${neg ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

export function sumPaisa(values: number[]): number {
  let t = 0
  for (const v of values) t += Math.round(v)
  return t
}

/** Integer-safe line total. */
export function lineTotalPaisa(quantity: number, unitPricePaisa: number): number {
  return Math.round(quantity) * Math.round(unitPricePaisa)
}

/** Percentage helpers stay integer: discount is stored as an absolute paisa amount. */
export function clampNonNegative(v: number): number {
  return v < 0 ? 0 : v
}
