export type Gender = 'male' | 'female' | 'other'
export const GENDERS: Gender[] = ['male', 'female', 'other']

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const
export type BloodGroup = (typeof BLOOD_GROUPS)[number]

export type PaymentMethod = 'cash' | 'bank' | 'card' | 'bkash' | 'nagad' | 'rocket' | 'upay' | 'other'
export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank' },
  { value: 'card', label: 'Card' },
  { value: 'bkash', label: 'bKash' },
  { value: 'nagad', label: 'Nagad' },
  { value: 'rocket', label: 'Rocket' },
  { value: 'upay', label: 'Upay' },
  { value: 'other', label: 'Other' }
]

export type AppointmentStatus =
  | 'scheduled' | 'confirmed' | 'arrived' | 'waiting' | 'in_consultation'
  | 'completed' | 'cancelled' | 'no_show' | 'rescheduled'
export const APPOINTMENT_STATUSES: AppointmentStatus[] = [
  'scheduled', 'confirmed', 'arrived', 'waiting', 'in_consultation', 'completed', 'cancelled', 'no_show', 'rescheduled'
]
export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Scheduled', confirmed: 'Confirmed', arrived: 'Arrived', waiting: 'Waiting',
  in_consultation: 'In Consultation', completed: 'Completed', cancelled: 'Cancelled',
  no_show: 'No-show', rescheduled: 'Rescheduled'
}

export type QueueStatus = 'waiting' | 'called' | 'in_treatment' | 'billing' | 'finished' | 'cancelled'
export const QUEUE_STATUSES: QueueStatus[] = ['waiting', 'called', 'in_treatment', 'billing', 'finished', 'cancelled']
export const QUEUE_STATUS_LABELS: Record<QueueStatus, string> = {
  waiting: 'Waiting', called: 'Called', in_treatment: 'In Treatment', billing: 'Billing', finished: 'Finished', cancelled: 'Cancelled'
}

export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'void'
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  unpaid: 'Unpaid', partial: 'Partially Paid', paid: 'Paid', void: 'Void'
}

export type PaymentStatus = 'valid' | 'void'

export type PrescriptionStatus = 'active' | 'void'

export type ReferralStatus = 'pending' | 'completed' | 'cancelled'
export const REFERRAL_STATUS_LABELS: Record<ReferralStatus, string> = {
  pending: 'Pending', completed: 'Completed', cancelled: 'Cancelled'
}

export type StockMovementType = 'in' | 'out' | 'adjust' | 'damaged' | 'expired' | 'returned' | 'usage'
export const STOCK_MOVEMENT_LABELS: Record<StockMovementType, string> = {
  in: 'Stock In', out: 'Stock Out', adjust: 'Adjustment', damaged: 'Damaged',
  expired: 'Expired', returned: 'Returned', usage: 'Usage'
}

export type DoseForm =
  | 'tablet' | 'capsule' | 'syrup' | 'suspension' | 'ointment' | 'gel' | 'drop' | 'injection'
  | 'paste' | 'gargle' | 'powder' | 'inhaler' | 'spray' | 'lotion' | 'other'
export const DOSE_FORMS: { value: DoseForm; label: string }[] = [
  { value: 'tablet', label: 'Tablet' }, { value: 'capsule', label: 'Capsule' },
  { value: 'syrup', label: 'Syrup' }, { value: 'suspension', label: 'Suspension' },
  { value: 'ointment', label: 'Ointment' }, { value: 'gel', label: 'Gel' },
  { value: 'drop', label: 'Drop' }, { value: 'injection', label: 'Injection' },
  { value: 'paste', label: 'Paste' }, { value: 'gargle', label: 'Gargle' },
  { value: 'powder', label: 'Powder' }, { value: 'inhaler', label: 'Inhaler' },
  { value: 'spray', label: 'Spray' }, { value: 'lotion', label: 'Lotion' },
  { value: 'other', label: 'Other' }
]

export type DurationUnit = 'day' | 'week' | 'month'
export const DURATION_UNITS: { value: DurationUnit; label: string }[] = [
  { value: 'day', label: 'Day(s)' }, { value: 'week', label: 'Week(s)' }, { value: 'month', label: 'Month(s)' }
]

export type Dentition = 'adult' | 'pediatric'

export type PaperType = 'a4' | 'a5' | 'letter' | 'thermal80' | 'thermal58' | 'custom'
export const PAPER_TYPES: { value: PaperType; label: string }[] = [
  { value: 'a4', label: 'A4 (210 × 297 mm)' },
  { value: 'a5', label: 'A5 (148 × 210 mm)' },
  { value: 'letter', label: 'Letter (216 × 279 mm)' },
  { value: 'thermal80', label: 'Thermal 80 mm' },
  { value: 'thermal58', label: 'Thermal 58 mm' },
  { value: 'custom', label: 'Custom' }
]
export const PAPER_SIZES_MM: Record<Exclude<PaperType, 'custom'>, { width: number; height: number }> = {
  a4: { width: 210, height: 297 },
  a5: { width: 148, height: 210 },
  letter: { width: 215.9, height: 279.4 },
  thermal80: { width: 80, height: 297 },
  thermal58: { width: 58, height: 297 }
}

export type PrintDocType = 'prescription' | 'invoice' | 'receipt' | 'report'

export type DateRangePreset = 'today' | '7d' | '30d' | '90d' | '1y' | 'all' | 'custom'
export const DATE_RANGE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '1y', label: 'Last 1 year' },
  { value: 'all', label: 'All' },
  { value: 'custom', label: 'Custom' }
]

/** FDI tooth numbering. Adult quadrants 1-4, pediatric quadrants 5-8. */
export const ADULT_TEETH: number[] = [
  18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28,
  48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38
]
export const PEDIATRIC_TEETH: number[] = [
  55, 54, 53, 52, 51, 61, 62, 63, 64, 65,
  85, 84, 83, 82, 81, 71, 72, 73, 74, 75
]

export type AuditAction =
  | 'create' | 'update' | 'delete' | 'archive' | 'restore' | 'void' | 'login' | 'login_failed'
  | 'logout' | 'lock' | 'unlock' | 'permission_change' | 'backup' | 'restore_db' | 'print'
  | 'export' | 'activation' | 'settings_change' | 'security_event' | 'business_delete' | 'reset'

export type NotificationAudience = 'all' | 'financial' | 'inventory' | 'admin'
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error'
