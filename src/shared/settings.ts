import { z } from 'zod'
import { PAPER_SIZES_MM } from './enums'

export interface AppSettings {
  general: {
    timezone: string
    patientCodePrefix: string
    invoicePrefix: string
    rxPrefix: string
    patientCodeNext: number
    invoiceNext: number
    rxNext: number
  }
  security: {
    autoLockMinutes: number // 0 = never
    allowOverpayment: boolean
  }
  backup: {
    folder: string | null
    scheduleDays: number // 0 = disabled
    lastAutoBackupAt: string | null
  }
  notifications: {
    appointments: boolean
    lowStock: boolean
    expiryDays: number
    backup: boolean
    dues: boolean
  }
  appearance: {
    theme: 'light' | 'dark'
    density: 'comfortable' | 'compact'
  }
  invoice: {
    footerNote: string
    enableDiscount: boolean
  }
  prescription: {
    footerMessage: string
    doctorTiming: string
    defaultPaper: string
  }
  printing: {
    defaultPaper: string
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    timezone: 'Asia/Dhaka',
    patientCodePrefix: 'DP-',
    invoicePrefix: 'INV-',
    rxPrefix: 'RX-',
    patientCodeNext: 1,
    invoiceNext: 1,
    rxNext: 1
  },
  security: {
    autoLockMinutes: 10,
    allowOverpayment: false
  },
  backup: {
    folder: null,
    scheduleDays: 0,
    lastAutoBackupAt: null
  },
  notifications: {
    appointments: true,
    lowStock: true,
    expiryDays: 30,
    backup: true,
    dues: true
  },
  appearance: {
    theme: 'light',
    density: 'comfortable'
  },
  invoice: {
    footerNote: 'Thank you for visiting. Please keep this invoice for your records.',
    enableDiscount: true
  },
  prescription: {
    footerMessage: 'Take care of your smile — follow the advice above for a healthy recovery.',
    doctorTiming: '',
    defaultPaper: 'a4'
  },
  printing: {
    defaultPaper: 'a4'
  }
}

export const SETTINGS_GROUPS = ['general', 'security', 'backup', 'notifications', 'appearance', 'invoice', 'prescription', 'printing'] as const
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number]

export const autoLockSchema = z.number().int().refine((v) => [0, 5, 10, 15, 30].includes(v), 'Auto-lock must be 5, 10, 15, 30 minutes or Never')

export function paperSizeMm(profile: { paper: string; widthMm?: number | null; heightMm?: number | null }): { width: number; height: number } {
  const known = PAPER_SIZES_MM[profile.paper as keyof typeof PAPER_SIZES_MM]
  if (known) return known
  const w = Number(profile.widthMm)
  const h = Number(profile.heightMm)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 30 || w > 350 || h < 30 || h > 350) {
    return PAPER_SIZES_MM.a4
  }
  return { width: w, height: h }
}
