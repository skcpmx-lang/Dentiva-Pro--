import type { AppContext, Actor } from '../core/context'
import type { Channel } from '@shared/ipc'
import { AppError, errValidation, type IpcResult, type ErrorCode } from '@shared/errors'
import type { PrinterInfo } from '@shared/ipc'
import type { Permission } from '@shared/permissions'
import type { SessionManager } from '../services/auth'
import { login, lock, unlock, changePassword } from '../services/auth'
import { activate } from '../services/activation'
import { integrityCheck, foreignKeyCheck, currentVersion } from '../core/db'
import { getSetupState, completeSetup } from '../services/setup'
import * as settingsSvc from '../services/settings'
import * as patients from '../services/patients'
import * as visits from '../services/visits'
import * as chart from '../services/chart'
import * as treatments from '../services/treatments'
import * as rx from '../services/prescriptions'
import * as attachments from '../services/attachments'
import * as referrals from '../services/referrals'
import * as appointments from '../services/appointments'
import * as queue from '../services/queue'
import * as invoices from '../services/invoices'
import * as payments from '../services/payments'
import * as accounting from '../services/accounting'
import * as inventory from '../services/inventory'
import * as staffSvc from '../services/staff'
import { auditList } from '../services/auditQuery'
import * as backup from '../services/backup'
import { globalSearch } from '../services/search'
import * as notifications from '../services/notifications'
import { dashboardGet } from '../services/dashboard'
import { patientTimeline } from '../services/timeline'
import { reportList, reportRun, reportExportCsv } from '../services/reports'
import { printerProfileList, printerProfileSave, printerProfileDelete } from '../services/printing'
import { deleteBusinessData } from '../services/destructive'
import type { PrintManager } from '../app/print'
import type { Logger } from '../app/logger'
import { copyFileSync, mkdirSync, statSync } from 'node:fs'

/* ---------------- Platform bridge (Electron-coupled capabilities) ---------------- */

export interface PlatformBridge {
  pickOpenFile(filters: { name: string; extensions: string[] }[]): Promise<string | null>
  pickSaveFile(defaultName: string, filters: { name: string; extensions: string[] }[]): Promise<string | null>
  pickFolder(): Promise<string | null>
  openPath(path: string): void
  listPrinters(): Promise<PrinterInfo[]>
  saveTextFile(contents: string, defaultName: string): Promise<string | null>
  validateAndStoreImage(sourcePath: string, destDir: string, maxBytes: number): Promise<string | null>
}

export interface RouterDeps {
  ctx: AppContext
  sessions: SessionManager
  platform: PlatformBridge
  print: PrintManager
  logger: Logger
  reloadAfterRestore: () => void
}

type Handler = (deps: RouterDeps, actor: Actor, req: never, token: string | null) => unknown

/* ---------------- Route permission table (single source of enforcement truth) ---------------- */

export const ROUTE_PERMS: Record<Channel, Permission | 'public' | 'authed'> = {
  'setup.state': 'public',
  'setup.activate': 'public',
  'setup.complete': 'public',
  'auth.login': 'public',
  'auth.logout': 'authed',
  'auth.lock': 'authed',
  'auth.unlock': 'authed',
  'auth.session': 'authed',
  'auth.changePassword': 'authed',

  'clinic.get': 'authed',
  'clinic.update': 'settings.manage',
  'dentist.list': 'authed',
  'dentist.save': 'settings.manage',
  'dentist.delete': 'settings.manage',
  'clinic.uploadLogo': 'settings.manage',

  'settings.get': 'settings.view',
  'settings.update': 'settings.manage',

  'patient.list': 'patient.view',
  'patient.get': 'patient.view',
  'patient.duplicates': 'patient.create',
  'patient.create': 'patient.create',
  'patient.update': 'patient.edit',
  'patient.archive': 'patient.archive',
  'patient.deletePermanent': 'patient.delete',
  'patient.export': 'patient.export',

  'visit.list': 'visit.view',
  'visit.get': 'visit.view',
  'visit.create': 'visit.create',
  'visit.update': 'visit.edit',
  'visit.delete': 'visit.delete',

  'chart.state': 'chart.view',
  'chart.save': 'chart.edit',
  'chart.toothHistory': 'chart.view',
  'chart.conditions': 'chart.view',
  'chart.conditionSave': 'settings.manage',
  'chart.conditionDelete': 'settings.manage',

  'treatment.list': 'treatment.view',
  'treatment.save': 'treatment.manage',
  'treatment.delete': 'treatment.manage',

  'prescription.list': 'prescription.view',
  'prescription.get': 'prescription.view',
  'prescription.create': 'prescription.create',
  'prescription.update': 'prescription.edit',
  'prescription.void': 'prescription.void',
  'medicine.list': 'prescription.view',
  'medicine.save': 'settings.manage',
  'medicine.delete': 'settings.manage',
  'clinicalOptions.list': 'authed',
  'clinicalOptions.save': 'settings.manage',
  'clinicalOptions.delete': 'settings.manage',

  'attachment.list': 'attachment.view',
  'attachment.upload': 'attachment.upload',
  'attachment.delete': 'attachment.delete',
  'attachment.export': 'attachment.view',

  'referral.list': 'referral.view',
  'referral.save': 'referral.create',
  'referral.delete': 'referral.delete',

  'appointment.list': 'appointment.view',
  'appointment.create': 'appointment.create',
  'appointment.update': 'appointment.edit',
  'appointment.reschedule': 'appointment.edit',
  'appointment.setStatus': 'appointment.edit',
  'appointment.delete': 'appointment.delete',

  'queue.list': 'queue.view',
  'queue.add': 'queue.manage',
  'queue.setStatus': 'queue.manage',
  'queue.remove': 'queue.manage',

  'invoice.list': 'invoice.view',
  'invoice.get': 'invoice.view',
  'invoice.create': 'invoice.create',
  'invoice.update': 'invoice.edit',
  'invoice.void': 'invoice.void',
  'invoice.delete': 'invoice.delete',
  'invoice.nextNumber': 'invoice.create',

  'payment.list': 'payment.view',
  'payment.create': 'payment.create',
  'payment.void': 'payment.void',
  'payment.delete': 'payment.delete',
  'payment.summary': 'financial.view',
  'payment.receiptData': 'payment.view',

  'financial.patient': 'financial.view',
  'financial.dashboard': 'financial.view',

  'accounting.list': 'accounting.view',
  'accounting.save': 'accounting.manage',
  'accounting.delete': 'accounting.manage',
  'accounting.categories': 'accounting.view',
  'accounting.saveCategory': 'accounting.manage',
  'accounting.summary': 'accounting.view',

  'inventory.items': 'inventory.view',
  'inventory.item': 'inventory.view',
  'inventory.saveItem': 'inventory.manage',
  'inventory.addBatch': 'inventory.manage',
  'inventory.move': 'inventory.manage',
  'inventory.alerts': 'inventory.view',
  'supplier.list': 'supplier.view',
  'supplier.save': 'supplier.manage',
  'supplier.delete': 'supplier.manage',

  'staff.list': 'staff.view',
  'staff.get': 'staff.view',
  'staff.save': 'staff.manage',
  'staff.delete': 'staff.manage',
  'user.list': 'user.view',
  'user.save': 'user.manage',
  'user.setStatus': 'user.manage',
  'role.list': 'role.view',
  'role.save': 'role.manage',
  'role.delete': 'role.manage',

  'audit.list': 'audit.view',

  'backup.list': 'backup.view',
  'backup.create': 'backup.create',
  'backup.verify': 'backup.create',
  'backup.restore': 'backup.restore',
  'backup.schedule': 'backup.schedule',
  'backup.pickFolder': 'backup.schedule',
  'backup.status': 'backup.view',

  'search.global': 'authed',
  'notification.list': 'notification.view',
  'notification.unreadCount': 'notification.view',
  'notification.markRead': 'notification.view',
  'notification.markAllRead': 'notification.view',
  'dashboard.get': 'authed',
  'report.list': 'report.view',
  'report.run': 'report.view',
  'report.export': 'report.export',

  'print.pdf': 'authed',
  'print.print': 'authed',
  'print.savePdf': 'authed',
  'print.printers': 'authed',
  'print.profileList': 'settings.view',
  'print.profileSave': 'settings.manage',
  'print.profileDelete': 'settings.manage',

  'timeline.patient': 'patient.view',

  'system.about': 'authed',
  'system.diagnostics': 'settings.view',
  'system.openFolder': 'settings.view',
  'system.deleteBusinessData': 'business.delete'
}

/* ---------------- Handlers ---------------- */

export const HANDLERS: Record<Channel, Handler> = {
  'setup.state': (d) => getSetupState(d.ctx),
  'setup.activate': (d, _a, req) => activate(d.ctx, (req as { code: string }).code),
  'setup.complete': (d, _a, req) => completeSetup(d.ctx, d.sessions, req),
  'auth.login': (d, _a, req) => login(d.ctx, d.sessions, (req as { username: string }).username, (req as { password: string }).password),
  'auth.logout': (d, _a, _req, token) => {
    d.sessions.drop(token as string)
    return { ok: true as const }
  },
  'auth.lock': (d, _a, _req, token) => {
    lock(d.sessions, token as string)
    return { ok: true as const }
  },
  'auth.unlock': (d, _a, req, token) => unlock(d.ctx, d.sessions, token as string, (req as { password: string }).password),
  'auth.session': (d, _a, _req, token) => {
    const s = d.sessions.get(token as string)
    if (!s) throw new AppError('ERR_UNAUTHORIZED', 'Session expired. Please sign in again.')
    d.sessions.refreshActor(d.ctx, s)
    const current = d.sessions.get(token as string)
    if (!current) throw new AppError('ERR_UNAUTHORIZED', 'Session expired. Please sign in again.')
    return {
      user: { id: current.actor.userId, username: current.actor.username, displayName: current.actor.displayName, roleName: roleOf(d, current.actor.userId), staffId: null },
      permissions: [...current.actor.permissions],
      locked: current.locked,
      autoLockMinutes: settingsSvc.getSettings(d.ctx).security.autoLockMinutes
    }
  },
  'auth.changePassword': (d, _a, req, token) => changePassword(d.ctx, d.sessions, token as string, (req as { currentPassword: string }).currentPassword, (req as { newPassword: string }).newPassword),

  'clinic.get': (d) => {
    try {
      return settingsSvc.getClinic(d.ctx)
    } catch {
      return null
    }
  },
  'clinic.update': (d, a, req) => settingsSvc.updateClinic(d.ctx, a, req),
  'dentist.list': (d, _a, req) => settingsSvc.listDentists(d.ctx, !!(req as { activeOnly?: boolean } | void)?.activeOnly),
  'dentist.save': (d, a, req) => settingsSvc.saveDentist(d.ctx, a, req),
  'dentist.delete': (d, a, req) => {
    settingsSvc.deleteDentist(d.ctx, a, (req as { id: number }).id, (req as { confirm: string }).confirm)
    return { ok: true as const }
  },
  'clinic.uploadLogo': async (d, a) => {
    const src = await d.platform.pickOpenFile([
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }
    ])
    if (!src) throw new AppError('ERR_CANCELLED', 'No file selected.')
    mkdirSync(d.ctx.paths.logosDir, { recursive: true })
    const stored = await d.platform.validateAndStoreImage(src, d.ctx.paths.logosDir, 2 * 1024 * 1024)
    if (!stored) throw errValidation('The selected file is not a valid image (PNG, JPG, WebP or BMP, max 2 MB).')
    const clinic = settingsSvc.updateClinic(d.ctx, a, { logo_path: stored })
    return clinic
  },

  'settings.get': (d) => settingsSvc.getSettings(d.ctx),
  'settings.update': (d, a, req) => settingsSvc.updateSettings(d.ctx, a, (req as { group: never }).group, (req as { patch: Record<string, unknown> }).patch),

  'patient.list': (d, a, req) => patients.patientList(d.ctx, a, req),
  'patient.get': (d, a, req) => patients.patientGet(d.ctx, a, (req as { id: number }).id),
  'patient.duplicates': (d, _a, req) => patients.patientDuplicates(d.ctx, (req as { fullName: string }).fullName, (req as { phone?: string }).phone, (req as { dob?: string }).dob),
  'patient.create': (d, a, req) => patients.patientCreate(d.ctx, a, req),
  'patient.update': (d, a, req) => patients.patientUpdate(d.ctx, a, (req as { id: number }).id, (req as { data: never }).data),
  'patient.archive': (d, a, req) => {
    patients.patientArchive(d.ctx, a, (req as { id: number }).id, (req as { archived: boolean }).archived)
    return { ok: true as const }
  },
  'patient.deletePermanent': (d, a, req) => {
    patients.patientDeletePermanent(d.ctx, a, (req as { id: number }).id, (req as { confirm: string }).confirm)
    return { ok: true as const }
  },
  'patient.export': async (d, a, req) => {
    const { csv, count } = patients.patientExportCsv(d.ctx, a, req)
    const stamp = new Date().toISOString().slice(0, 10)
    const path = await d.platform.saveTextFile(csv, `dentiva-patients-${stamp}.csv`)
    if (!path) throw new AppError('ERR_CANCELLED', 'Export cancelled.')
    return { path, count }
  },

  'visit.list': (d, a, req) => visits.visitList(d.ctx, a, req),
  'visit.get': (d, _a, req) => visits.visitGet(d.ctx, (req as { id: number }).id),
  'visit.create': (d, a, req) => visits.visitCreate(d.ctx, a, req),
  'visit.update': (d, a, req) => visits.visitUpdate(d.ctx, a, (req as { id: number }).id, (req as { data: never }).data),
  'visit.delete': (d, a, req) => {
    visits.visitDelete(d.ctx, a, (req as { id: number }).id, (req as { confirm: string }).confirm)
    return { ok: true as const }
  },

  'chart.state': (d, _a, req) => chart.chartState(d.ctx, (req as { patientId: number }).patientId, (req as { dentition: 'adult' | 'pediatric' }).dentition),
  'chart.save': (d, a, req) => {
    chart.chartSave(d.ctx, a, req)
    return { ok: true as const }
  },
  'chart.toothHistory': (d, _a, req) => chart.toothHistory(d.ctx, (req as { patientId: number }).patientId, (req as { dentition: 'adult' | 'pediatric' }).dentition, (req as { tooth: number }).tooth),
  'chart.conditions': (d) => chart.toothConditions(d.ctx),
  'chart.conditionSave': (d, a, req) => chart.conditionSave(d.ctx, a, req),
  'chart.conditionDelete': (d, a, req) => chart.conditionDelete(d.ctx, a, (req as { id: number }).id),

  'treatment.list': (d, _a, req) => treatments.treatmentList(d.ctx, (req as { search?: string; activeOnly?: boolean; page?: number; pageSize?: number } | void) ?? {}),
  'treatment.save': (d, a, req) => treatments.treatmentSave(d.ctx, a, req),
  'treatment.delete': (d, a, req) => {
    treatments.treatmentDelete(d.ctx, a, (req as { id: number }).id)
    return { ok: true as const }
  },

  'prescription.list': (d, a, req) => rx.prescriptionList(d.ctx, a, req),
  'prescription.get': (d, _a, req) => rx.prescriptionGet(d.ctx, (req as { id: number }).id),
  'prescription.create': (d, a, req) => rx.prescriptionCreate(d.ctx, a, req),
  'prescription.update': (d, a, req) => rx.prescriptionUpdate(d.ctx, a, (req as { id: number }).id, (req as { data: never }).data),
  'prescription.void': (d, a, req) => {
    rx.prescriptionVoid(d.ctx, a, (req as { id: number }).id, (req as { reason: string }).reason)
    return { ok: true as const }
  },
  'medicine.list': (d, _a, req) => rx.medicineList(d.ctx, (req as { search?: string; activeOnly?: boolean } | void) ?? {}),
  'medicine.save': (d, a, req) => rx.medicineSave(d.ctx, a, req),
  'medicine.delete': (d, a, req) => {
    rx.medicineDelete(d.ctx, a, (req as { id: number }).id)
    return { ok: true as const }
  },
  'clinicalOptions.list': (d, _a, req) => rx.clinicalOptions(d.ctx, (req as { kind?: 'cc' | 'oe' | 'advice' } | void)?.kind),
  'clinicalOptions.save': (d, a, req) => rx.clinicalOptionSave(d.ctx, a, req),
  'clinicalOptions.delete': (d, a, req) => rx.clinicalOptionDelete(d.ctx, a, (req as { id: number }).id),

  'attachment.list': (d, _a, req) => attachments.attachmentList(d.ctx, (req as { patientId: number }).patientId),
  'attachment.upload': async (d, a, req) => {
    const src = await d.platform.pickOpenFile([
      { name: 'Images & Documents', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'csv', 'rtf'] }
    ])
    if (!src) throw new AppError('ERR_CANCELLED', 'No file selected.')
    return attachments.attachmentStore(d.ctx, a, src, {
      patientId: (req as { patientId: number }).patientId,
      visitId: (req as { visitId?: number | null }).visitId ?? null,
      category: (req as { category?: string }).category,
      description: (req as { description?: string }).description ?? null
    })
  },
  'attachment.delete': (d, a, req) => {
    attachments.attachmentDelete(d.ctx, a, (req as { id: number }).id, (req as { confirm: string }).confirm)
    return { ok: true as const }
  },
  'attachment.export': async (d, _a, req) => {
    const id = (req as { id: number }).id
    const src = attachments.attachmentSourcePath(d.ctx, id)
    const original = (d.ctx.db.prepare('SELECT original_filename FROM attachments WHERE id = ?').get(id) as { original_filename: string }).original_filename
    const dest = await d.platform.pickSaveFile(original, [{ name: 'All files', extensions: ['*'] }])
    if (!dest) throw new AppError('ERR_CANCELLED', 'Export cancelled.')
    copyFileSync(src, dest)
    return { path: dest }
  },

  'referral.list': (d, _a, req) => referrals.referralList(d.ctx, req),
  'referral.save': (d, a, req) => referrals.referralSave(d.ctx, a, req),
  'referral.delete': (d, a, req) => {
    referrals.referralDelete(d.ctx, a, (req as { id: number }).id)
    return { ok: true as const }
  },

  'appointment.list': (d, _a, req) => appointments.appointmentList(d.ctx, req),
  'appointment.create': (d, a, req) => appointments.appointmentCreate(d.ctx, a, req),
  'appointment.update': (d, a, req) => appointments.appointmentUpdate(d.ctx, a, (req as { id: number }).id, (req as { data: never }).data),
  'appointment.reschedule': (d, a, req) => appointments.appointmentReschedule(d.ctx, a, (req as { id: number }).id, (req as { apptDate: string }).apptDate, (req as { apptTime: string }).apptTime, (req as { reason?: string }).reason),
  'appointment.setStatus': (d, a, req) => appointments.appointmentSetStatus(d.ctx, a, (req as { id: number }).id, (req as { status: string }).status, (req as { reason?: string }).reason),
  'appointment.delete': (d, a, req) => {
    appointments.appointmentDelete(d.ctx, a, (req as { id: number }).id)
    return { ok: true as const }
  },

  'queue.list': (d, _a, req) => queue.queueList(d.ctx, (req as { date?: string } | void)?.date),
  'queue.add': (d, a, req) => queue.queueAdd(d.ctx, a, req),
  'queue.setStatus': (d, a, req) => queue.queueSetStatus(d.ctx, a, (req as { id: number }).id, (req as { status: string }).status),
  'queue.remove': (d, a, req) => {
    queue.queueRemove(d.ctx, a, (req as { id: number }).id)
    return { ok: true as const }
  },

  'invoice.list': (d, _a, req) => invoices.invoiceList(d.ctx, req),
  'invoice.get': (d, _a, req) => invoices.invoiceGet(d.ctx, (req as { id: number }).id),
  'invoice.create': (d, a, req) => invoices.invoiceCreate(d.ctx, a, req),
  'invoice.update': (d, a, req) => invoices.invoiceUpdate(d.ctx, a, (req as { id: number }).id, (req as { data: never }).data),
  'invoice.void': (d, a, req) => invoices.invoiceVoid(d.ctx, a, (req as { id: number }).id, (req as { reason: string }).reason),
  'invoice.delete': (d, a, req) => {
    invoices.invoiceDelete(d.ctx, a, (req as { id: number }).id)
    return { ok: true as const }
  },
  'invoice.nextNumber': (d) => ({ invoiceNo: invoices.nextInvoiceNumber(d.ctx) }),

  'payment.list': (d, _a, req) => payments.paymentList(d.ctx, req),
  'payment.create': (d, a, req) => payments.paymentCreate(d.ctx, a, req),
  'payment.void': (d, a, req) => payments.paymentVoid(d.ctx, a, (req as { id: number }).id, (req as { reason: string }).reason),
  'payment.delete': (d, a, req) => {
    payments.paymentDelete(d.ctx, a, (req as { id: number }).id)
    return { ok: true as const }
  },
  'payment.summary': (d, _a, req) => payments.paymentSummary(d.ctx, req),
  'payment.receiptData': (d, a, req) => payments.receiptData(d.ctx, a, (req as { id: number }).id),

  'financial.patient': (d, _a, req) => payments.financialPatientSummary(d.ctx, (req as { patientId: number }).patientId),
  'financial.dashboard': (d, _a, req) => payments.financialDashboard(d.ctx, req),

  'accounting.list': (d, _a, req) => accounting.accountingList(d.ctx, req),
  'accounting.save': (d, a, req) => accounting.accountingSave(d.ctx, a, req),
  'accounting.delete': (d, a, req) => {
    accounting.accountingDelete(d.ctx, a, (req as { id: number }).id)
    return { ok: true as const }
  },
  'accounting.categories': (d) => accounting.accountingCategories(d.ctx),
  'accounting.saveCategory': (d, a, req) => accounting.accountingSaveCategory(d.ctx, a, req),
  'accounting.summary': (d, _a, req) => accounting.accountingSummary(d.ctx, req),

  'inventory.items': (d, _a, req) => inventory.inventoryItems(d.ctx, (req as { search?: string; activeOnly?: boolean; page: number; pageSize: number })),
  'inventory.item': (d, _a, req) => inventory.inventoryItemDetail(d.ctx, (req as { id: number }).id),
  'inventory.saveItem': (d, a, req) => inventory.inventorySaveItem(d.ctx, a, req),
  'inventory.addBatch': (d, a, req) => inventory.inventoryAddBatch(d.ctx, a, req),
  'inventory.move': (d, a, req) => {
    inventory.inventoryMove(d.ctx, a, req)
    return { ok: true as const }
  },
  'inventory.alerts': (d) => inventory.inventoryAlerts(d.ctx),
  'supplier.list': (d) => inventory.supplierList(d.ctx),
  'supplier.save': (d, a, req) => inventory.supplierSave(d.ctx, a, req),
  'supplier.delete': (d, a, req) => {
    inventory.supplierDelete(d.ctx, a, (req as { id: number }).id)
    return { ok: true as const }
  },

  'staff.list': (d, _a, req) => staffSvc.staffList(d.ctx, (req as { search?: string; page: number; pageSize: number })),
  'staff.get': (d, _a, req) => staffSvc.staffGet(d.ctx, (req as { id: number }).id),
  'staff.save': (d, a, req) => staffSvc.staffSave(d.ctx, a, req),
  'staff.delete': (d, a, req) => {
    staffSvc.staffDelete(d.ctx, a, (req as { id: number }).id)
    return { ok: true as const }
  },
  'user.list': (d) => staffSvc.userList(d.ctx),
  'user.save': (d, a, req) => staffSvc.userSave(d.ctx, a, d.sessions, req),
  'user.setStatus': (d, a, req) => staffSvc.userSetStatus(d.ctx, a, d.sessions, (req as { id: number }).id, (req as { isActive: boolean }).isActive),
  'role.list': (d) => staffSvc.roleList(d.ctx),
  'role.save': (d, a, req) => staffSvc.roleSave(d.ctx, a, req),
  'role.delete': (d, a, req) => {
    staffSvc.roleDelete(d.ctx, a, (req as { id: number }).id)
    return { ok: true as const }
  },

  'audit.list': (d, a, req) => auditList(d.ctx, a, req),

  'backup.list': (d) => backup.backupList(d.ctx),
  'backup.create': (d, a, req) => backup.createBackup(d.ctx, a, ((req as { type?: 'manual' | 'auto' } | void)?.type ?? 'manual')),
  'backup.verify': (d, _a, req) => backup.verifyBackup(d.ctx, (req as { id: number }).id),
  'backup.restore': async (d, a, req) => {
    const result = await backup.restoreBackup(d.ctx, a, (req as { id: number }).id, (req as { confirm: string }).confirm, d.reloadAfterRestore)
    return result
  },
  'backup.schedule': (d, a, req) => {
    backup.backupSchedule(d.ctx, a, (req as { folder: string | null }).folder, (req as { scheduleDays: number }).scheduleDays)
    return { ok: true as const }
  },
  'backup.pickFolder': async (d) => {
    const folder = await d.platform.pickFolder()
    return { folder }
  },
  'backup.status': (d) => backup.backupStatus(d.ctx),

  'search.global': (d, a, req) => globalSearch(d.ctx, a, (req as { q: string }).q, (req as { module?: string }).module, (req as { limit?: number }).limit),
  'notification.list': (d, a, req) => notifications.notificationList(d.ctx, a, (req as { unreadOnly?: boolean; limit?: number } | void) ?? {}),
  'notification.unreadCount': (d, a) => ({ count: notifications.notificationUnreadCount(d.ctx, a) }),
  'notification.markRead': (d, a, req) => {
    notifications.notificationMarkRead(d.ctx, a, (req as { ids?: number[] }).ids)
    return { ok: true as const }
  },
  'notification.markAllRead': (d, a) => {
    notifications.notificationMarkRead(d.ctx, a)
    return { ok: true as const }
  },
  'dashboard.get': (d, a) => dashboardGet(d.ctx, a),
  'report.list': (d) => reportList(d.ctx),
  'report.run': (d, a, req) => reportRun(d.ctx, a, req),
  'report.export': async (d, a, req) => {
    const { csv, title, count } = reportExportCsv(d.ctx, a, req)
    const stamp = new Date().toISOString().slice(0, 10)
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const path = await d.platform.saveTextFile(csv, `dentiva-${slug}-${stamp}.csv`)
    if (!path) throw new AppError('ERR_CANCELLED', 'Export cancelled.')
    return { path, count }
  },

  'print.pdf': (d, _a, req) => d.print.renderPdf((req as { html: string }).html, req),
  'print.print': async (d, _a, req) => {
    const pdfUrl = (req as { pdfUrl: string }).pdfUrl
    const jobKey = d.print.jobKeyForPdfUrl(pdfUrl)
    await d.print.printJob(jobKey ?? '', (req as { deviceName?: string | null }).deviceName ?? null, (req as { silent: boolean }).silent)
    return { ok: true as const }
  },
  'print.savePdf': async (d, _a, req) => {
    const src = d.print.pdfDiskPath((req as { pdfUrl: string }).pdfUrl)
    const dest = await d.platform.pickSaveFile((req as { suggestedName: string }).suggestedName, [{ name: 'PDF document', extensions: ['pdf'] }])
    if (!dest) throw new AppError('ERR_CANCELLED', 'Save cancelled.')
    copyFileSync(src, dest)
    return { path: dest }
  },
  'print.printers': (d) => d.platform.listPrinters(),
  'print.profileList': (d) => printerProfileList(d.ctx),
  'print.profileSave': (d, a, req) => printerProfileSave(d.ctx, a, req),
  'print.profileDelete': (d, a, req) => printerProfileDelete(d.ctx, a, (req as { id: number }).id),

  'timeline.patient': (d, _a, req) => patientTimeline(d.ctx, (req as { patientId: number }).patientId, (req as { types?: string[]; preset?: string; page: number; pageSize: number })),

  'system.about': (d) => ({
    version: d.ctx.appVersion,
    creatorName: 'Shohan Khan',
    creatorEmail: 'helloiamshohan@gmail.com',
    dbPath: d.ctx.paths.dbPath
  }),
  'system.diagnostics': (d) => {
    const counts = (table: string): number => (d.ctx.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c
    const lastBackup = backup.backupStatus(d.ctx).lastBackupAt
    let dbSize = 0
    try {
      dbSize = statSync(d.ctx.paths.dbPath).size
    } catch {
      dbSize = 0
    }
    return {
      schemaVersion: currentVersion(d.ctx.db),
      appVersion: d.ctx.appVersion,
      dbSizeBytes: dbSize,
      integrityCheck: integrityCheck(d.ctx.db).message,
      foreignKeyIssues: foreignKeyCheck(d.ctx.db),
      patientCount: counts('patients'),
      visitCount: counts('visits'),
      invoiceCount: counts('invoices'),
      attachmentCount: counts('attachments'),
      lastBackupAt: lastBackup,
      logFolder: d.logger.path,
      dataFolder: d.ctx.paths.dataDir
    }
  },
  'system.openFolder': (d, _a, req) => {
    const which = (req as { which: 'logs' | 'data' | 'backups' }).which
    const folder = which === 'logs' ? d.ctx.paths.logsDir : which === 'backups' ? backupFolderOf(d) : d.ctx.paths.dataDir
    mkdirSync(folder, { recursive: true })
    d.platform.openPath(folder)
    return { ok: true as const }
  },
  'system.deleteBusinessData': async (d, a, req) => {
    const scope = (req as { scope: 'business' | 'factory' }).scope
    const confirm = (req as { confirm: string }).confirm
    // Mandatory fresh pre-operation backup (spec §63).
    const pre = await backup.createBackup(d.ctx, a, 'pre_restore')
    deleteBusinessData(d.ctx, a, scope, confirm, pre.path)
    return { ok: true as const }
  }
}

function backupFolderOf(d: RouterDeps): string {
  const folder = settingsSvc.getSettings(d.ctx).backup.folder
  return folder && folder.trim() ? folder : d.ctx.paths.backupsDir
}

function roleOf(d: RouterDeps, userId: number): string {
  const row = d.ctx.db.prepare('SELECT r.name AS name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?').get(userId) as { name: string } | undefined
  return row?.name ?? ''
}

/* ---------------- Dispatcher ---------------- */

export async function dispatch(deps: RouterDeps, channel: string, token: string | null, payload: unknown): Promise<IpcResult<unknown>> {
  const handler = (HANDLERS as Record<string, Handler | undefined>)[channel]
  const perm = (ROUTE_PERMS as Record<string, Permission | 'public' | 'authed' | undefined>)[channel]
  if (!handler || perm === undefined) {
    deps.logger.warn('ipc', `Unknown channel requested: ${channel}`)
    return { ok: false, code: 'ERR_INTERNAL', message: 'Unknown command.' }
  }

  try {
    if (perm === 'public') {
      const result = await handler(deps, null as never, payload as never, token)
      return { ok: true, data: result === undefined ? { ok: true } : result }
    }

    const session = token ? deps.sessions.get(token) : null
    if (!session) {
      return { ok: false, code: 'ERR_UNAUTHORIZED', message: 'Session expired. Please sign in again.' }
    }
    if (session.locked && channel !== 'auth.unlock') {
      return { ok: false, code: 'ERR_LOCKED', message: 'The application is locked. Unlock to continue.' }
    }
    // Keep role/permission changes effective immediately.
    deps.sessions.refreshActor(deps.ctx, session)
    const live = deps.sessions.get(token as string)
    if (!live) {
      return { ok: false, code: 'ERR_UNAUTHORIZED', message: 'Session expired. Please sign in again.' }
    }

    if (perm !== 'authed' && !live.actor.permissions.has(perm)) {
      deps.logger.warn('security', `Permission denied: user "${live.actor.username}" -> ${channel} (needs ${perm})`)
      return { ok: false, code: 'ERR_PERMISSION', message: 'You do not have permission to perform this action.' }
    }

    const result = await handler(deps, live.actor, payload as never, token)
    return { ok: true, data: result === undefined ? { ok: true } : result }
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === 'ERR_INTERNAL' || e.code === 'ERR_IO') deps.logger.error('ipc', `${channel}: ${e.message}`)
      return { ok: false, code: e.code satisfies ErrorCode, message: e.message, details: e.details }
    }
    const message = e instanceof Error ? e.message : 'Unexpected error.'
    deps.logger.error('ipc', `${channel} failed`, { message })
    return { ok: false, code: 'ERR_INTERNAL', message: 'Something went wrong. The error has been logged — try again or contact support if it repeats.' }
  }
}

