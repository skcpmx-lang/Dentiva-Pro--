import type { Channel, ChannelReq, ChannelRes } from '@shared/ipc'
import type { IpcResult } from '@shared/errors'

/**
 * Typed bridge to the trusted main process. Every call carries the session
 * token; permission checks happen server-side before any data is touched.
 */
let token: string | null = null

export function setToken(t: string | null): void {
  token = t
}

export function getToken(): string | null {
  return token
}

export class IpcError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

const unauthorizedHandlers: Array<() => void> = []
export function onUnauthorized(handler: () => void): void {
  unauthorizedHandlers.push(handler)
}

export async function call<C extends Channel>(
  channel: C,
  ...args: undefined extends ChannelReq<C> ? [payload?: ChannelReq<C>] : [payload: ChannelReq<C>]
): Promise<ChannelRes<C>> {
  const payload = args[0] as ChannelReq<C> | undefined
  const result = (await window.dentiva.call(channel, token, payload)) as IpcResult<ChannelRes<C>>
  if (result.ok) return result.data as ChannelRes<C>
  if (result.code === 'ERR_UNAUTHORIZED') {
    for (const h of unauthorizedHandlers) h()
  }
  throw new IpcError(result.code ?? 'ERR_UNKNOWN', result.message ?? 'Request failed.')
}

/** Fire a call, ignoring errors (for optimistic refreshes). */
export function fireAndForget<C extends Channel>(channel: C, payload: ChannelReq<C>): void {
  void call(channel, payload).catch(() => undefined)
}
