import { contextBridge, ipcRenderer } from 'electron'
import type { IpcResult } from '@shared/errors'

/**
 * The ONLY bridge between the untrusted renderer and the trusted main process.
 * Every call is permission-checked in main before any data is touched.
 */
const api = {
  call: (channel: string, token: string | null, payload: unknown): Promise<IpcResult<unknown>> =>
    ipcRenderer.invoke('dentiva:invoke', channel, token, payload),
  onEvent: (callback: (event: { type: string }) => void): (() => void) => {
    const listener = (_e: unknown, payload: { type: string }) => callback(payload)
    ipcRenderer.on('dentiva:event', listener)
    return () => ipcRenderer.removeListener('dentiva:event', listener)
  },
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node }
}

contextBridge.exposeInMainWorld('dentiva', api)

export type DentivaPreload = typeof api
