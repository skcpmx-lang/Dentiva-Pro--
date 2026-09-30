import { z } from 'zod'
import type { Permission } from './permissions'
import type {
  Clinic, Dentist, Staff, SessionUser, Patient, PatientListRow, PatientDetail, Visit, Treatment,
  ToothCondition, ChartEntry, ToothState, Prescription, Medicine, Attachment, Referral,
  AppointmentRow, QueueEntry, Invoice, Payment, PaymentSummary, FinancialTxn, AccountingCategory,
  AccountingSummary, Supplier, InventoryItem, InventoryBatch, StockMovement, InventoryAlerts,
  Role, AuditEntry, NotificationItem, BackupRecord, PrinterProfile, TimelineEvent, Paginated,
  AppVersionInfo
} from './types'
import type { AppSettings, SettingsGroup } from './settings'

/* ---------- Reusable request/response shapes ---------- */

export const rangeQuery = z.object({
  preset: z.enum(['today', '7d', '30d', '90d', '1y', 'all', 'custom']).default('today'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
})
export type RangeQuery = z.infer<typeof rangeQuery>

export const pageQuery = z.object({ page: z.number().int().min(1).default(1), pageSize: z.number().int().min(5).max(200).default(25) })

/* ---------- Setup & auth ---------- */

export interface SetupState { initialized: boolean; activated: boolean }

export interface ActivationPayload { code: string }
export interface SetupCompletePayload {
  clinic: { name: string; address: string; phone: string; phone2?: string | null; email?: string | null; tagline?: string | null }
  dentists: {
    fullName: string; phone?: string | null; email?: string | null
    designations: string[]; qualifications: string[]; workingSchedule?: Record<string, unknown> | null
  }[]
  admin: { username: string; password: string; displayName: string }
  settings: { autoLockMinutes: number; backupFolder: string | null; theme: 'light' | 'dark'; density: 'comfortable' | 'compact' }
}
export interface LoginPayload { username: string; password: string }
export interface LoginResult { token: string; user: SessionUser; permissions: Permission[]; clinicName: string | null }
export interface SessionInfo { user: SessionUser; permissions: Permission[]; locked: boolean; autoLockMinutes: number }
export interface ChangePasswordPayload { currentPassword: string; newPassword: string }

/* ---------- Patients ---------- */

export interface PatientListQuery extends z.infer<typeof rangeQuery> {
  search?: string
  status?: 'active' | 'inactive' | 'archived' | 'all'
  dentistId?: number
  sort?: 'newest' | 'oldest' | 'name' | 'lastVisit'
  page: number
  pageSize: number
}
export interface PatientInput {
  patientCode?: string | null
  fullName: string
  age?: number | null
  dob?: string | null
  gender: 'male' | 'female' | 'other'
  bloodGroup?: string | null
  address?: string | null
  phone?: string | null
  emergencyPhone?: string | null
  emergencyContactName?: string | null
  chiefComplaint?: string | null
  previousHistory?: string | null
  notes?: string | null
  preferredLanguage?: string | null
  status?: 'active' | 'inactive'
  registeredDentistId?: number | null
}
export interface DuplicateCandidate { id: number; patientCode: string; fullName: string; phone: string | null; dob: string | null; registeredAt: string }

/* ---------- Clinical ---------- */

export interface VisitListQuery extends z.infer<typeof rangeQuery> {
  patientId?: number
  dentistId?: number
  search?: string
  page: number
  pageSize: number
}
export interface VisitInput {
  patientId: number
  dentistId: number
  visitDate: string
  visitTime: string
  reason?: string | null
  chiefComplaint?: string | null
  examination?: string | null
  diagnosis?: string | null
  treatmentSummary?: string | null
  notes?: string | null
  followUpDate?: string | null
  followUpNote?: string | null
  status?: 'open' | 'completed'
  treatments?: {
    treatmentId?: number | null
    name: string
    toothNumbers?: string | null
    unitPrice: number
    quantity: number
    notes?: string | null
  }[]
}
export interface TreatmentInput {
  id?: number
  code?: string | null
  name: string
  category?: string | null
  description?: string | null
  defaultPrice: number
  durationMinutes?: number | null
  isActive?: boolean
}
export interface ChartSavePayload {
  patientId: number
  visitId?: number | null
  dentition: 'adult' | 'pediatric'
  entries: { tooth: number; conditionId: number; note?: string | null }[]
}
export interface PrescriptionInput {
  patientId: number
  visitId?: number | null
  dentistId: number
  rxDate: string
  cc: string[]
  oe: string[]
  advice?: string | null
  extraAdvice?: string | null
  followUpDate?: string | null
  medicines: {
    medicineId?: number | null
    name: string
    doseForm?: string | null
    strength?: string | null
    dose?: string | null
    morning?: boolean
    noon?: boolean
    night?: boolean
    meal?: 'before' | 'after' | null
    durationValue?: number | null
    durationUnit?: string | null
    quantity?: string | null
    instruction?: string | null
    isPrn?: boolean
    customInstruction?: string | null
    sortOrder: number
  }[]
}
export interface ClinicalOption { id: number; kind: 'cc' | 'oe' | 'advice'; value: string; sortOrder: number; isActive: boolean }

/* ---------- Practice ---------- */

export interface AppointmentListQuery {
  date?: string
  from?: string
  to?: string
  dentistId?: number
  patientId?: number
  status?: string
  page: number
  pageSize: number
}
export interface AppointmentInput {
  patientId: number
  dentistId: number
  apptDate: string
  apptTime: string
  durationMinutes?: number | null
  reason?: string | null
  notes?: string | null
  status?: string
}
export interface QueueAddPayload { patientId: number; dentistId: number; priority: 'normal' | 'urgent'; appointmentId?: number | null; notes?: string | null }

/* ---------- Billing ---------- */

export interface InvoiceListQuery extends z.infer<typeof rangeQuery> {
  patientId?: number
  status?: string
  search?: string
  page: number
  pageSize: number
}
export interface InvoiceInput {
  patientId: number
  visitId?: number | null
  dentistId?: number | null
  invoiceDate: string
  discount?: number
  notes?: string | null
  lines: { treatmentId?: number | null; description: string; quantity: number; unitPrice: number }[]
}
export interface PaymentInput {
  patientId: number
  invoiceId?: number | null
  paymentDate: string
  amount: number
  method: string
  reference?: string | null
  notes?: string | null
}
export interface FinancialPatientSummary {
  totalBilled: number
  totalPaid: number
  outstanding: number
  invoices: Invoice[]
  payments: Payment[]
}
export interface FinancialDashboard {
  revenueToday: number
  revenueRange: number
  expensesRange: number
  netRange: number
  outstandingTotal: number
  paymentSummary: PaymentSummary
  byDay: { date: string; collected: number }[]
}

/* ---------- Inventory ---------- */

export interface InventoryItemInput {
  id?: number
  name: string
  sku: string
  category?: string | null
  unit: string
  reorderThreshold: number
  notes?: string | null
  isActive?: boolean
}
export interface BatchInput {
  itemId: number
  supplierId?: number | null
  purchaseDate: string
  batchNo?: string | null
  expiryDate?: string | null
  purchaseCost: number
  qtyPurchased: number
}
export interface StockMovePayload {
  itemId: number
  batchId?: number | null
  type: 'in' | 'out' | 'adjust' | 'damaged' | 'expired' | 'returned' | 'usage'
  quantity: number
  reason?: string | null
  reference?: string | null
}
export interface SupplierInput {
  id?: number
  name: string
  contactPerson?: string | null
  phone?: string | null
  address?: string | null
  notes?: string | null
  isActive?: boolean
}

/* ---------- Admin ---------- */

export interface StaffInput {
  id?: number
  name: string
  dob?: string | null
  gender?: string | null
  address?: string | null
  bloodGroup?: string | null
  idDocument?: string | null
  photoPath?: string | null
  phone?: string | null
  designation?: string | null
  department?: string | null
  salary?: number | null
  joiningDate?: string | null
  status?: 'active' | 'inactive'
  notes?: string | null
}
export interface UserRecord {
  id: number
  username: string
  displayName: string
  roleId: number
  roleName: string
  staffId: number | null
  staffName: string | null
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
}
export interface UserInput { id?: number; username: string; displayName: string; roleId: number; staffId?: number | null; isActive?: boolean; password?: string }
export interface RoleInput { id?: number; name: string; description?: string | null; permissions: string[] }
export interface AuditListQuery extends z.infer<typeof rangeQuery> {
  userId?: number
  entity?: string
  action?: string
  search?: string
  page: number
  pageSize: number
}

/* ---------- Search / notifications / dashboard / reports ---------- */

export interface GlobalSearchQuery { q: string; module?: string; limit?: number }
export interface SearchResultGroup { module: string; label: string; items: { id: number; title: string; detail: string | null; route: string }[] }
export interface DashboardData {
  appointmentsToday: AppointmentRow[]
  appointmentCountToday: number
  completedVisitsToday: number
  noShowsToday: number
  newPatientsToday: number
  waitingQueue: QueueEntry[]
  upcomingFollowUps: { visitId: number; patientId: number; patientName: string; followUpDate: string }[]
  lowStockCount: number
  outOfStockCount: number
  expiringCount: number
  financial: {
    revenueToday: number
    collectedToday: number
    outstandingTotal: number
    expensesToday: number
    paymentsByMethod: Record<string, number>
  } | null
}
export interface ReportDescriptor { key: string; title: string; description: string; requires: Permission[] }
export interface ReportRunPayload { key: string; preset: string; from?: string; to?: string }
export interface ReportResult { title: string; columns: { key: string; label: string; money?: boolean }[]; rows: Record<string, string | number | null>[]; summary: { label: string; value: string }[] }

/* ---------- Print ---------- */

export interface PrintPdfPayload {
  html: string
  paper: string
  widthMm?: number | null
  heightMm?: number | null
  marginMm?: number
  scale?: number
  landscape?: boolean
}
export interface PrintPdfResult { pdfUrl: string; pages: number; fileName: string }
export interface PrintPrintPayload { pdfUrl: string; deviceName?: string | null; silent: boolean }
export interface PrinterInfo { name: string; description: string; isDefault: boolean }
export interface ReceiptData {
  clinic: Clinic
  payment: Payment
  invoiceNo: string | null
  balanceAfter: number | null
  operator: string
}

/* ---------- System ---------- */

export interface Diagnostics {
  schemaVersion: number
  appVersion: string
  dbSizeBytes: number
  integrityCheck: string
  foreignKeyIssues: number
  patientCount: number
  visitCount: number
  invoiceCount: number
  attachmentCount: number
  lastBackupAt: string | null
  logFolder: string
  dataFolder: string
}
export interface DeleteBusinessDataPayload { confirm: string; scope: 'business' | 'factory' }

/* ---------- The channel contract ---------- */

export interface ChannelDef<Req, Res> {
  req: Req
  res: Res
  perm: Permission | 'public' | 'authed'
}

export interface DentivaApi {
  // setup & auth
  'setup.state': ChannelDef<void, SetupState>
  'setup.activate': ChannelDef<ActivationPayload, { ok: true }>
  'setup.complete': ChannelDef<SetupCompletePayload, LoginResult>
  'auth.login': ChannelDef<LoginPayload, LoginResult>
  'auth.logout': ChannelDef<void, { ok: true }>
  'auth.lock': ChannelDef<void, { ok: true }>
  'auth.unlock': ChannelDef<{ password: string }, { ok: true }>
  'auth.session': ChannelDef<void, SessionInfo>
  'auth.changePassword': ChannelDef<ChangePasswordPayload, { ok: true }>

  // clinic & dentists
  'clinic.get': ChannelDef<void, Clinic>
  'clinic.update': ChannelDef<Partial<Clinic>, Clinic>
  'dentist.list': ChannelDef<{ activeOnly?: boolean } | void, Dentist[]>
  'dentist.save': ChannelDef<Omit<Dentist, 'designations' | 'qualifications'> & { designations: string[]; qualifications: string[] }, Dentist>
  'dentist.delete': ChannelDef<{ id: number; confirm: string }, { ok: true }>
  'clinic.uploadLogo': ChannelDef<void, Clinic>

  // settings
  'settings.get': ChannelDef<void, AppSettings>
  'settings.update': ChannelDef<{ group: SettingsGroup; patch: Record<string, unknown> }, AppSettings>

  // patients
  'patient.list': ChannelDef<PatientListQuery, Paginated<PatientListRow>>
  'patient.get': ChannelDef<{ id: number }, PatientDetail>
  'patient.duplicates': ChannelDef<{ fullName: string; phone?: string | null; dob?: string | null }, DuplicateCandidate[]>
  'patient.create': ChannelDef<PatientInput, Patient>
  'patient.update': ChannelDef<{ id: number; data: PatientInput }, Patient>
  'patient.archive': ChannelDef<{ id: number; archived: boolean }, { ok: true }>
  'patient.deletePermanent': ChannelDef<{ id: number; confirm: string }, { ok: true }>
  'patient.export': ChannelDef<PatientListQuery, { path: string; count: number }>

  // visits
  'visit.list': ChannelDef<VisitListQuery, Paginated<Visit>>
  'visit.get': ChannelDef<{ id: number }, Visit>
  'visit.create': ChannelDef<VisitInput, Visit>
  'visit.update': ChannelDef<{ id: number; data: VisitInput }, Visit>
  'visit.delete': ChannelDef<{ id: number; confirm: string }, { ok: true }>

  // chart
  'chart.state': ChannelDef<{ patientId: number; dentition: 'adult' | 'pediatric' }, { states: ToothState[]; history: ChartEntry[] }>
  'chart.save': ChannelDef<ChartSavePayload, { ok: true }>
  'chart.toothHistory': ChannelDef<{ patientId: number; dentition: 'adult' | 'pediatric'; tooth: number }, ChartEntry[]>
  'chart.conditions': ChannelDef<void, ToothCondition[]>
  'chart.conditionSave': ChannelDef<{ id?: number; code: string; name: string; color: string; isActive: boolean }, ToothCondition[]>
  'chart.conditionDelete': ChannelDef<{ id: number }, ToothCondition[]>

  // treatments
  'treatment.list': ChannelDef<{ search?: string; activeOnly?: boolean; page?: number; pageSize?: number }, Paginated<Treatment>>
  'treatment.save': ChannelDef<TreatmentInput, Treatment>
  'treatment.delete': ChannelDef<{ id: number }, { ok: true }>

  // prescriptions
  'prescription.list': ChannelDef<VisitListQuery, Paginated<Prescription>>
  'prescription.get': ChannelDef<{ id: number }, Prescription>
  'prescription.create': ChannelDef<PrescriptionInput, Prescription>
  'prescription.update': ChannelDef<{ id: number; data: PrescriptionInput }, Prescription>
  'prescription.void': ChannelDef<{ id: number; reason: string }, { ok: true }>
  'medicine.list': ChannelDef<{ search?: string; activeOnly?: boolean }, Medicine[]>
  'medicine.save': ChannelDef<Medicine, Medicine>
  'medicine.delete': ChannelDef<{ id: number }, { ok: true }>
  'clinicalOptions.list': ChannelDef<{ kind?: 'cc' | 'oe' | 'advice' } | void, ClinicalOption[]>
  'clinicalOptions.save': ChannelDef<ClinicalOption, ClinicalOption[]>
  'clinicalOptions.delete': ChannelDef<{ id: number }, ClinicalOption[]>

  // attachments
  'attachment.list': ChannelDef<{ patientId: number }, Attachment[]>
  'attachment.upload': ChannelDef<{ patientId: number; visitId?: number | null; category?: string }, Attachment>
  'attachment.delete': ChannelDef<{ id: number; confirm: string }, { ok: true }>
  'attachment.export': ChannelDef<{ id: number }, { path: string }>

  // referrals
  'referral.list': ChannelDef<VisitListQuery, Paginated<Referral>>
  'referral.save': ChannelDef<Referral & { id?: number }, Referral>
  'referral.delete': ChannelDef<{ id: number }, { ok: true }>

  // appointments & queue
  'appointment.list': ChannelDef<AppointmentListQuery, Paginated<AppointmentRow>>
  'appointment.create': ChannelDef<AppointmentInput, AppointmentRow>
  'appointment.update': ChannelDef<{ id: number; data: AppointmentInput }, AppointmentRow>
  'appointment.reschedule': ChannelDef<{ id: number; apptDate: string; apptTime: string; reason?: string | null }, AppointmentRow>
  'appointment.setStatus': ChannelDef<{ id: number; status: string; reason?: string | null }, AppointmentRow>
  'appointment.delete': ChannelDef<{ id: number }, { ok: true }>
  'queue.list': ChannelDef<{ date?: string } | void, QueueEntry[]>
  'queue.add': ChannelDef<QueueAddPayload, QueueEntry>
  'queue.setStatus': ChannelDef<{ id: number; status: string }, QueueEntry>
  'queue.remove': ChannelDef<{ id: number }, { ok: true }>

  // invoices & payments
  'invoice.list': ChannelDef<InvoiceListQuery, Paginated<Invoice>>
  'invoice.get': ChannelDef<{ id: number }, Invoice>
  'invoice.create': ChannelDef<InvoiceInput, Invoice>
  'invoice.update': ChannelDef<{ id: number; data: InvoiceInput }, Invoice>
  'invoice.void': ChannelDef<{ id: number; reason: string }, Invoice>
  'invoice.delete': ChannelDef<{ id: number }, { ok: true }>
  'invoice.nextNumber': ChannelDef<void, { invoiceNo: string }>
  'payment.list': ChannelDef<VisitListQuery & { method?: string }, Paginated<Payment>>
  'payment.create': ChannelDef<PaymentInput, Payment>
  'payment.void': ChannelDef<{ id: number; reason: string }, Payment>
  'payment.delete': ChannelDef<{ id: number }, { ok: true }>
  'payment.summary': ChannelDef<RangeQuery, PaymentSummary>
  'payment.receiptData': ChannelDef<{ id: number }, ReceiptData>

  // financial & accounting
  'financial.patient': ChannelDef<{ patientId: number }, FinancialPatientSummary>
  'financial.dashboard': ChannelDef<RangeQuery, FinancialDashboard>
  'accounting.list': ChannelDef<RangeQuery & { kind?: string; categoryId?: number; page: number; pageSize: number }, Paginated<FinancialTxn>>
  'accounting.save': ChannelDef<FinancialTxn & { id?: number }, FinancialTxn>
  'accounting.delete': ChannelDef<{ id: number }, { ok: true }>
  'accounting.categories': ChannelDef<void, AccountingCategory[]>
  'accounting.saveCategory': ChannelDef<AccountingCategory, AccountingCategory[]>
  'accounting.summary': ChannelDef<RangeQuery, AccountingSummary>

  // inventory
  'inventory.items': ChannelDef<{ search?: string; activeOnly?: boolean; page: number; pageSize: number }, Paginated<InventoryItem>>
  'inventory.item': ChannelDef<{ id: number }, { item: InventoryItem; batches: InventoryBatch[]; movements: StockMovement[] }>
  'inventory.saveItem': ChannelDef<InventoryItemInput, InventoryItem>
  'inventory.addBatch': ChannelDef<BatchInput, InventoryBatch>
  'inventory.move': ChannelDef<StockMovePayload, { ok: true }>
  'inventory.alerts': ChannelDef<void, InventoryAlerts>
  'supplier.list': ChannelDef<void, Supplier[]>
  'supplier.save': ChannelDef<SupplierInput, Supplier>
  'supplier.delete': ChannelDef<{ id: number }, { ok: true }>

  // staff, users, roles
  'staff.list': ChannelDef<{ search?: string; page: number; pageSize: number }, Paginated<Staff>>
  'staff.get': ChannelDef<{ id: number }, Staff>
  'staff.save': ChannelDef<StaffInput, Staff>
  'staff.delete': ChannelDef<{ id: number }, { ok: true }>
  'user.list': ChannelDef<void, UserRecord[]>
  'user.save': ChannelDef<UserInput, UserRecord>
  'user.setStatus': ChannelDef<{ id: number; isActive: boolean }, UserRecord>
  'role.list': ChannelDef<void, Role[]>
  'role.save': ChannelDef<RoleInput, Role>
  'role.delete': ChannelDef<{ id: number }, { ok: true }>

  // audit
  'audit.list': ChannelDef<AuditListQuery, Paginated<AuditEntry>>

  // backup & restore
  'backup.list': ChannelDef<void, BackupRecord[]>
  'backup.create': ChannelDef<{ type?: 'manual' | 'auto' }, BackupRecord>
  'backup.verify': ChannelDef<{ id: number }, BackupRecord>
  'backup.restore': ChannelDef<{ id: number; confirm: string }, { ok: true; backupUsed: string }>
  'backup.schedule': ChannelDef<{ folder: string | null; scheduleDays: number }, { ok: true }>
  'backup.pickFolder': ChannelDef<void, { folder: string | null }>
  'backup.status': ChannelDef<void, { lastBackupAt: string | null; lastAutoBackupAt: string | null; scheduleDays: number; folder: string | null }>

  // search / notifications / dashboard / reports
  'search.global': ChannelDef<GlobalSearchQuery, SearchResultGroup[]>
  'notification.list': ChannelDef<{ unreadOnly?: boolean; limit?: number } | void, NotificationItem[]>
  'notification.unreadCount': ChannelDef<void, { count: number }>
  'notification.markRead': ChannelDef<{ ids?: number[] }, { ok: true }>
  'notification.markAllRead': ChannelDef<void, { ok: true }>
  'dashboard.get': ChannelDef<void, DashboardData>
  'report.list': ChannelDef<void, ReportDescriptor[]>
  'report.run': ChannelDef<ReportRunPayload, ReportResult>
  'report.export': ChannelDef<ReportRunPayload, { path: string; count: number }>

  // print
  'print.pdf': ChannelDef<PrintPdfPayload, PrintPdfResult>
  'print.print': ChannelDef<PrintPrintPayload, { ok: true }>
  'print.savePdf': ChannelDef<{ pdfUrl: string; suggestedName: string }, { path: string }>
  'print.printers': ChannelDef<void, PrinterInfo[]>
  'print.profileList': ChannelDef<void, PrinterProfile[]>
  'print.profileSave': ChannelDef<PrinterProfile, PrinterProfile[]>
  'print.profileDelete': ChannelDef<{ id: number }, PrinterProfile[]>

  // timeline
  'timeline.patient': ChannelDef<{ patientId: number; types?: string[]; preset?: string; from?: string; to?: string; page: number; pageSize: number }, Paginated<TimelineEvent>>

  // system
  'system.about': ChannelDef<void, AppVersionInfo & { dbPath: string }>
  'system.diagnostics': ChannelDef<void, Diagnostics>
  'system.openFolder': ChannelDef<{ which: 'logs' | 'data' | 'backups' }, { ok: true }>
  'system.deleteBusinessData': ChannelDef<DeleteBusinessDataPayload, { ok: true }>
}

export type Channel = keyof DentivaApi
export type ChannelReq<C extends Channel> = DentivaApi[C]['req']
export type ChannelRes<C extends Channel> = DentivaApi[C]['res']
export type ChannelPerm<C extends Channel> = DentivaApi[C]['perm']
