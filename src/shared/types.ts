import type {
  Gender, BloodGroup, PaymentMethod, AppointmentStatus, QueueStatus, InvoiceStatus,
  PaymentStatus, PrescriptionStatus, ReferralStatus, StockMovementType, DoseForm,
  DurationUnit, Dentition, PaperType, PrintDocType, NotificationAudience, NotificationSeverity
} from './enums'
import type { Permission } from './permissions'

export type {
  Gender, BloodGroup, PaymentMethod, AppointmentStatus, QueueStatus, InvoiceStatus,
  PaymentStatus, PrescriptionStatus, ReferralStatus, StockMovementType, DoseForm,
  DurationUnit, Dentition, PaperType, PrintDocType, NotificationAudience, NotificationSeverity
} from './enums'

export interface DentistInput {
  id?: number
  fullName: string
  phone?: string | null
  email?: string | null
  workingSchedule?: Record<string, unknown> | null
  isActive?: boolean
  notes?: string | null
  designations: string[]
  qualifications?: string[]
}

export type ClinicRow = Clinic

export interface Clinic {
  name: string
  address: string
  phone: string
  phone2: string | null
  email: string | null
  logoPath: string | null
  tagline: string | null
  footerMessage: string | null
  doctorTiming: string | null
}

export interface Dentist {
  id: number
  fullName: string
  phone: string | null
  email: string | null
  workingSchedule: Record<string, { from: string; to: string } | null> | null
  isActive: boolean
  notes: string | null
  designations: string[]
  qualifications: string[]
}

export interface Staff {
  id: number
  name: string
  dob: string | null
  gender: Gender | null
  address: string | null
  bloodGroup: BloodGroup | null
  idDocument: string | null
  photoPath: string | null
  phone: string | null
  designation: string | null
  department: string | null
  salary: number | null
  joiningDate: string | null
  status: 'active' | 'inactive'
  notes: string | null
}

export interface SessionUser {
  id: number
  username: string
  displayName: string
  roleName: string
  staffId: number | null
}

export interface PatientListRow {
  id: number
  patientCode: string
  fullName: string
  age: number | null
  gender: Gender
  phone: string | null
  chiefComplaint: string | null
  status: 'active' | 'inactive'
  registeredAt: string
  lastVisitDate: string | null
  visitCount: number
  archived: boolean
}

export interface Patient {
  id: number
  patientCode: string
  fullName: string
  age: number | null
  dob: string | null
  gender: Gender
  bloodGroup: BloodGroup | null
  address: string | null
  phone: string | null
  emergencyPhone: string | null
  emergencyContactName: string | null
  chiefComplaint: string | null
  previousHistory: string | null
  notes: string | null
  preferredLanguage: string | null
  status: 'active' | 'inactive'
  registeredDentistId: number | null
  registeredAt: string
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface PatientDetail extends Patient {
  visitCount: number
  lastVisitDate: string | null
  nextAppointment: AppointmentRow | null
  upcomingAppointments: AppointmentRow[]
  missedAppointments: number
  prescriptionCount: number
  referralCount: number
  attachmentCount: number
  invoiceCount: number
  totalBilled: number | null
  totalPaid: number | null
  outstanding: number | null
  lastPayment: { date: string; amount: number; method: PaymentMethod } | null
  dentistName: string | null
}

export interface Visit {
  id: number
  patientId: number
  dentistId: number
  visitDate: string
  visitTime: string
  reason: string | null
  chiefComplaint: string | null
  examination: string | null
  diagnosis: string | null
  treatmentSummary: string | null
  notes: string | null
  followUpDate: string | null
  followUpNote: string | null
  status: 'open' | 'completed'
  dentistName: string
  patientName: string
  patientCode: string
  treatments: VisitTreatmentLine[]
  prescriptionId: number | null
  invoiceId: number | null
}

export interface VisitTreatmentLine {
  id: number
  treatmentId: number | null
  name: string
  toothNumbers: string | null
  unitPrice: number
  quantity: number
  lineTotal: number
  notes: string | null
}

export interface Treatment {
  id: number
  code: string | null
  name: string
  category: string | null
  description: string | null
  defaultPrice: number
  durationMinutes: number | null
  isActive: boolean
}

export interface ToothCondition {
  id: number
  code: string
  name: string
  color: string
  isSystem: boolean
  isActive: boolean
  sortOrder: number
}

export interface ChartEntry {
  id: number
  patientId: number
  visitId: number | null
  dentition: Dentition
  tooth: number
  conditionId: number
  conditionName: string
  conditionColor: string
  note: string | null
  recordedBy: string
  recordedAt: string
}

export interface ToothState {
  tooth: number
  conditionId: number | null
  conditionName: string | null
  conditionColor: string | null
  note: string | null
  lastRecordedAt: string | null
}

export interface Prescription {
  id: number
  rxNo: string
  patientId: number
  visitId: number | null
  dentistId: number
  rxDate: string
  cc: string[]
  oe: string[]
  advice: string | null
  extraAdvice: string | null
  followUpDate: string | null
  status: PrescriptionStatus
  patientName: string
  patientCode: string
  patientAge: number | null
  patientGender: Gender
  dentistName: string
  dentistDesignations: string[]
  dentistQualifications: string[]
  medicines: PrescriptionMedicine[]
}

export interface PrescriptionMedicine {
  id: number
  medicineId: number | null
  name: string
  doseForm: DoseForm | null
  strength: string | null
  dose: string | null
  morning: boolean
  noon: boolean
  night: boolean
  meal: 'before' | 'after' | null
  durationValue: number | null
  durationUnit: DurationUnit | null
  quantity: string | null
  instruction: string | null
  isPrn: boolean
  customInstruction: string | null
  sortOrder: number
}

export interface Medicine {
  id: number
  name: string
  genericName: string | null
  doseForm: DoseForm | null
  commonStrength: string | null
  isActive: boolean
}

export interface Attachment {
  id: number
  patientId: number
  visitId: number | null
  originalFilename: string
  storedFilename: string
  mimeType: string
  sizeBytes: number
  sha256: string
  category: string
  description: string | null
  uploadedBy: string
  uploadedAt: string
  url: string
}

export interface Referral {
  id: number
  patientId: number
  visitId: number | null
  fromDentistId: number
  toDoctorName: string
  toClinic: string | null
  reason: string
  notes: string | null
  status: ReferralStatus
  followUpDate: string | null
  createdAt: string
  patientName: string
  patientCode: string
  fromDentistName: string
}

export interface AppointmentRow {
  id: number
  patientId: number
  dentistId: number
  apptDate: string
  apptTime: string
  durationMinutes: number | null
  reason: string | null
  status: AppointmentStatus
  notes: string | null
  sourceAppointmentId: number | null
  cancelledReason: string | null
  patientName: string
  patientCode: string
  patientPhone: string | null
  dentistName: string
}

export interface QueueEntry {
  id: number
  tokenNo: number
  queueDate: string
  patientId: number
  appointmentId: number | null
  dentistId: number
  priority: 'normal' | 'urgent'
  status: QueueStatus
  arrivedAt: string
  calledAt: string | null
  startedAt: string | null
  completedAt: string | null
  finishedAt: string | null
  notes: string | null
  patientName: string
  patientCode: string
  dentistName: string
  waitingMinutes: number
}

export interface Invoice {
  id: number
  invoiceNo: string
  patientId: number
  visitId: number | null
  dentistId: number | null
  invoiceDate: string
  subtotal: number
  discount: number
  total: number
  paidAmount: number
  dueAmount: number
  status: InvoiceStatus
  notes: string | null
  voidedReason: string | null
  createdAt: string
  patientName: string
  patientCode: string
  patientPhone: string | null
  dentistName: string | null
  lines: InvoiceLine[]
}

export interface InvoiceLine {
  id: number
  treatmentId: number | null
  description: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

export interface Payment {
  id: number
  patientId: number
  invoiceId: number | null
  paymentDate: string
  paymentTime: string
  amount: number
  method: PaymentMethod
  reference: string | null
  receivedBy: string
  notes: string | null
  status: PaymentStatus
  voidedReason: string | null
  invoiceNo: string | null
  patientName: string
  patientCode: string
}

export interface PaymentSummary {
  totalCollected: number
  byMethod: Record<PaymentMethod, number>
  transactionCount: number
  cash: number
  bank: number
  card: number
  mobileWallet: number
  other: number
  outstanding: number
}

export interface FinancialTxn {
  id: number
  kind: 'income' | 'expense'
  categoryId: number
  categoryName: string
  amount: number
  txnDate: string
  method: PaymentMethod
  description: string | null
  reference: string | null
  paymentId: number | null
  createdBy: string
  createdAt: string
}

export interface FinancialTxnInput {
  id?: number
  kind: 'income' | 'expense'
  categoryId: number
  amount: number
  txnDate: string
  method: PaymentMethod
  description?: string | null
  reference?: string | null
}

export interface AccountingCategoryInput {
  id?: number
  kind: 'income' | 'expense'
  name: string
  isActive?: boolean
}

export interface AccountingCategory {
  id: number
  kind: 'income' | 'expense'
  name: string
  isSystem: boolean
  isActive: boolean
}

export interface AccountingSummary {
  income: number
  expense: number
  net: number
  byCategory: { name: string; amount: number }[]
  byMonth: { month: string; income: number; expense: number }[]
}

export interface Supplier {
  id: number
  name: string
  contactPerson: string | null
  phone: string | null
  address: string | null
  notes: string | null
  isActive: boolean
}

export interface InventoryItem {
  id: number
  name: string
  sku: string
  category: string | null
  unit: string
  reorderThreshold: number
  notes: string | null
  isActive: boolean
  currentStock: number
  stockStatus: 'ok' | 'low' | 'out'
}

export interface InventoryBatch {
  id: number
  itemId: number
  supplierId: number | null
  supplierName: string | null
  purchaseDate: string
  batchNo: string | null
  expiryDate: string | null
  purchaseCost: number
  qtyPurchased: number
  qtyCurrent: number
  status: 'active' | 'depleted' | 'damaged' | 'returned'
  createdAt: string
}

export interface StockMovement {
  id: number
  itemId: number
  itemName: string
  batchId: number | null
  type: StockMovementType
  quantity: number
  reason: string | null
  reference: string | null
  createdBy: string
  createdAt: string
}

export interface InventoryAlerts {
  lowStock: InventoryItem[]
  outOfStock: InventoryItem[]
  expiringSoon: (InventoryBatch & { itemName: string; daysToExpiry: number })[]
  expired: (InventoryBatch & { itemName: string; daysToExpiry: number })[]
}

export interface Role {
  id: number
  name: string
  description: string | null
  isSystem: boolean
  permissions: Permission[]
}

export interface AuditEntry {
  id: number
  userId: number | null
  username: string
  action: string
  entity: string
  entityId: string | null
  oldValue: unknown
  newValue: unknown
  context: string | null
  createdAt: string
}

export interface NotificationItem {
  id: number
  type: string
  severity: NotificationSeverity
  title: string
  body: string
  route: string | null
  audience: NotificationAudience
  isRead: boolean
  createdAt: string
}

export interface BackupRecord {
  id: number
  filename: string
  path: string
  sizeBytes: number
  sha256: string | null
  schemaVersion: number
  appVersion: string
  backupType: 'manual' | 'auto' | 'pre_restore'
  status: 'pending' | 'verified' | 'failed' | 'restored'
  createdBy: string
  createdAt: string
  verifiedAt: string | null
  fileExists: boolean
}

export interface PrinterProfile {
  id: number
  name: string
  deviceName: string | null
  paper: PaperType
  widthMm: number | null
  heightMm: number | null
  marginMm: number
  scale: number
  useFor: PrintDocType | 'any'
  isDefault: boolean
}

export interface TimelineEvent {
  id: string
  type: 'registration' | 'visit' | 'treatment' | 'prescription' | 'appointment' | 'invoice' | 'payment' | 'referral' | 'attachment' | 'chart'
  title: string
  detail: string | null
  date: string
  route: string | null
}

export interface Paginated<T> {
  rows: T[]
  total: number
  page: number
  pageSize: number
}

export interface AppVersionInfo {
  version: string
  creatorName: string
  creatorEmail: string
}

export type { AppSettings, SettingsGroup } from './settings'
