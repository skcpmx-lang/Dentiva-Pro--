export const PERMISSIONS = [
  // patients
  'patient.view', 'patient.create', 'patient.edit', 'patient.archive', 'patient.delete', 'patient.export',
  // appointments & queue
  'appointment.view', 'appointment.create', 'appointment.edit', 'appointment.delete',
  'queue.view', 'queue.manage',
  // clinical
  'visit.view', 'visit.create', 'visit.edit', 'visit.delete',
  'chart.view', 'chart.edit',
  'treatment.view', 'treatment.manage',
  'prescription.view', 'prescription.create', 'prescription.edit', 'prescription.void', 'prescription.print',
  'attachment.view', 'attachment.upload', 'attachment.delete',
  'referral.view', 'referral.create', 'referral.edit', 'referral.delete',
  // billing
  'invoice.view', 'invoice.create', 'invoice.edit', 'invoice.void', 'invoice.delete', 'invoice.print',
  'payment.view', 'payment.create', 'payment.void', 'payment.delete', 'payment.export',
  'financial.view', 'financial.export',
  'accounting.view', 'accounting.manage', 'accounting.export',
  // inventory
  'inventory.view', 'inventory.manage',
  'supplier.view', 'supplier.manage',
  // administration
  'staff.view', 'staff.manage',
  'user.view', 'user.manage',
  'role.view', 'role.manage',
  'audit.view',
  'backup.view', 'backup.create', 'backup.restore', 'backup.schedule',
  'settings.view', 'settings.manage',
  'report.view', 'report.export',
  'business.delete',
  'notification.view'
] as const

export type Permission = (typeof PERMISSIONS)[number]

export const PERMISSION_MODULES: Record<string, Permission[]> = {
  Patients: ['patient.view', 'patient.create', 'patient.edit', 'patient.archive', 'patient.delete', 'patient.export'],
  Appointments: ['appointment.view', 'appointment.create', 'appointment.edit', 'appointment.delete'],
  Queue: ['queue.view', 'queue.manage'],
  Visits: ['visit.view', 'visit.create', 'visit.edit', 'visit.delete'],
  'Dental Chart': ['chart.view', 'chart.edit'],
  Treatments: ['treatment.view', 'treatment.manage'],
  Prescriptions: ['prescription.view', 'prescription.create', 'prescription.edit', 'prescription.void', 'prescription.print'],
  Attachments: ['attachment.view', 'attachment.upload', 'attachment.delete'],
  Referrals: ['referral.view', 'referral.create', 'referral.edit', 'referral.delete'],
  Invoices: ['invoice.view', 'invoice.create', 'invoice.edit', 'invoice.void', 'invoice.delete', 'invoice.print'],
  Payments: ['payment.view', 'payment.create', 'payment.void', 'payment.delete', 'payment.export'],
  Financials: ['financial.view', 'financial.export'],
  Accounting: ['accounting.view', 'accounting.manage', 'accounting.export'],
  Inventory: ['inventory.view', 'inventory.manage'],
  Suppliers: ['supplier.view', 'supplier.manage'],
  Staff: ['staff.view', 'staff.manage'],
  Users: ['user.view', 'user.manage'],
  Roles: ['role.view', 'role.manage'],
  'Audit Log': ['audit.view'],
  Backup: ['backup.view', 'backup.create', 'backup.restore', 'backup.schedule'],
  Settings: ['settings.view', 'settings.manage'],
  Reports: ['report.view', 'report.export'],
  Business: ['business.delete'],
  Notifications: ['notification.view']
}

export const ALL_PERMISSIONS: Permission[] = [...PERMISSIONS]

export interface RoleSeed {
  name: string
  description: string
  permissions: Permission[]
}

const CLINICAL_VIEW: Permission[] = [
  'patient.view', 'appointment.view', 'queue.view', 'queue.manage', 'visit.view', 'chart.view',
  'treatment.view', 'prescription.view', 'attachment.view', 'attachment.upload', 'referral.view', 'referral.create',
  'referral.edit', 'notification.view', 'settings.view'
]

export const SYSTEM_ROLES: RoleSeed[] = [
  {
    name: 'Owner',
    description: 'Full control of the practice, including destructive operations.',
    permissions: [...ALL_PERMISSIONS]
  },
  {
    name: 'Administrator',
    description: 'Manages the practice, users and configuration. Cannot delete business data.',
    permissions: ALL_PERMISSIONS.filter((p) => p !== 'business.delete')
  },
  {
    name: 'Dentist',
    description: 'Clinical work: patients, visits, charts, prescriptions, treatments.',
    permissions: [
      ...CLINICAL_VIEW, 'patient.create', 'patient.edit', 'appointment.create', 'appointment.edit',
      'visit.create', 'visit.edit', 'visit.delete', 'chart.edit', 'treatment.manage',
      'prescription.create', 'prescription.edit', 'prescription.void', 'prescription.print',
      'attachment.delete', 'referral.delete', 'report.view'
    ]
  },
  {
    name: 'Receptionist',
    description: 'Front desk: patients, appointments, queue, billing and payment entry.',
    permissions: [
      'patient.view', 'patient.create', 'patient.edit', 'appointment.view', 'appointment.create',
      'appointment.edit', 'appointment.delete', 'queue.view', 'queue.manage', 'visit.view',
      'attachment.view', 'attachment.upload', 'referral.view', 'referral.create', 'referral.edit',
      'invoice.view', 'invoice.create', 'invoice.edit', 'invoice.print', 'payment.view', 'payment.create',
      'notification.view', 'settings.view'
    ]
  },
  {
    name: 'Assistant',
    description: 'Clinical assistance: read-only clinical access plus queue management.',
    permissions: [...CLINICAL_VIEW]
  },
  {
    name: 'Accountant',
    description: 'Financial management: payments, accounting and financial reports.',
    permissions: [
      'patient.view', 'invoice.view', 'invoice.create', 'invoice.print', 'payment.view', 'payment.create',
      'payment.void', 'payment.export', 'financial.view', 'financial.export', 'accounting.view',
      'accounting.manage', 'accounting.export', 'staff.view', 'report.view', 'report.export',
      'notification.view'
    ]
  },
  {
    name: 'Inventory Staff',
    description: 'Inventory and supplier management.',
    permissions: ['inventory.view', 'inventory.manage', 'supplier.view', 'supplier.manage', 'notification.view']
  }
]
