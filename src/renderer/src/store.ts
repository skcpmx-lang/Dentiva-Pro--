import { create } from 'zustand'
import { call, setToken, onUnauthorized } from './ipc'
import type { AppSettings, ClinicRow, NotificationItem } from '@shared/types'
import type { SessionInfo } from '@shared/ipc'

export type Phase = 'loading' | 'setup' | 'login' | 'locked' | 'ready'

interface AppState {
  phase: Phase
  session: SessionInfo | null
  settings: AppSettings | null
  clinic: ClinicRow | null
  notifications: NotificationItem[]
  unread: number
  booted: boolean
  boot: () => Promise<void>
  refreshSession: () => Promise<void>
  refreshMeta: () => Promise<void>
  refreshNotifications: () => Promise<void>
  markAllRead: () => Promise<void>
  enterSession: (token: string) => Promise<void>
  logout: () => Promise<void>
  lock: () => Promise<void>
}

export const useApp = create<AppState>((set, get) => ({
  phase: 'loading',
  session: null,
  settings: null,
  clinic: null,
  notifications: [],
  unread: 0,
  booted: false,

  boot: async () => {
    if (get().booted) return
    set({ booted: true })
    try {
      const state = await call('setup.state')
      if (!state.initialized) {
        set({ phase: 'setup' })
        return
      }
    } catch {
      set({ phase: 'login' })
      return
    }
    set({ phase: 'login' })
  },

  refreshSession: async () => {
    try {
      const session = await call('auth.session')
      if (session.locked) set({ phase: 'locked', session })
      else set({ phase: 'ready', session })
    } catch {
      setToken(null)
      set({ phase: 'login', session: null })
    }
  },

  refreshMeta: async () => {
    const [settings, clinic] = await Promise.all([
      call('settings.get').catch(() => null),
      call('clinic.get').catch(() => null)
    ])
    set({ settings, clinic })
  },

  refreshNotifications: async () => {
    try {
      const [items, count] = await Promise.all([call('notification.list'), call('notification.unreadCount')])
      set({ notifications: items, unread: count.count })
    } catch {
      /* notification issues must never block the app */
    }
  },

  markAllRead: async () => {
    await call('notification.markAllRead')
    await get().refreshNotifications()
  },

  enterSession: async (token) => {
    setToken(token)
    const session = await call('auth.session')
    if (session.locked) {
      set({ phase: 'locked', session })
      return
    }
    set({ phase: 'ready', session })
    await Promise.all([get().refreshMeta(), get().refreshNotifications()])
  },

  logout: async () => {
    try {
      await call('auth.logout')
    } catch {
      /* session may already be gone */
    }
    setToken(null)
    set({ phase: 'login', session: null, settings: null, clinic: null, notifications: [], unread: 0 })
  },

  lock: async () => {
    try {
      await call('auth.lock')
    } catch {
      /* ignore */
    }
    set({ phase: 'locked' })
  }
}))

/* Global unauthorized handling: session expired → back to login. */
onUnauthorized(() => {
  setToken(null)
  useApp.setState({ phase: 'login', session: null })
})

export function can(perm: string): boolean {
  return useApp.getState().session?.permissions.includes(perm as never) ?? false
}
