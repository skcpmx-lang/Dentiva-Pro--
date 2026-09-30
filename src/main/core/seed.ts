import type { Db } from './db'
import { ALL_PERMISSIONS, PERMISSION_MODULES, SYSTEM_ROLES } from '@shared/permissions'
import { DEFAULT_SETTINGS } from '@shared/settings'

const TOOTH_CONDITIONS = [
  { code: 'caries', name: 'Caries', color: '#B45309' },
  { code: 'g_caries', name: 'G. Caries', color: '#92400E' },
  { code: 'gingivitis', name: 'Gingivitis', color: '#DC2626' },
  { code: 'perio_pocket', name: 'Periodontal Pocket', color: '#B91C1C' },
  { code: 'periodontitis', name: 'Periodontitis', color: '#7F1D1D' },
  { code: 'pulpitis', name: 'Pulpitis', color: '#E11D48' },
  { code: 'impacted', name: 'Impacted Tooth', color: '#6D28D9' },
  { code: 'dry_socket', name: 'Dry Socket', color: '#A21CAF' },
  { code: 'attrition', name: 'Attrition', color: '#0E7490' },
  { code: 'erosion', name: 'Erosion', color: '#0891B2' },
  { code: 'missing', name: 'Missing Tooth', color: '#64748B' },
  { code: 'restored', name: 'Restored Tooth', color: '#059669' },
  { code: 'fracture', name: 'Fracture', color: '#EA580C' },
  { code: 'other', name: 'Other', color: '#475569' }
]

const CC_OPTIONS = ['Pain', 'G. Caries', 'Swelling', 'Gum Bleeding', 'Bad Breath', 'Sensitivity', 'Other']
const OE_OPTIONS = [
  'Caries', 'G. Caries', 'BDR', 'BDC', 'Gingivitis', 'Periodontal Pocket', 'Periodontitis',
  'Pulpitis', 'Impacted Teeth', 'Dry Socket', 'Attrition', 'Erosion', 'Other'
]
const ADVICE_OPTIONS = [
  'Rinse with warm salt water 2–3 times daily.',
  'Brush twice daily with a soft-bristle toothbrush.',
  'Avoid hard, hot and cold foods for 48 hours.',
  'Complete the full course of medication.',
  'Return immediately if pain or swelling increases.'
]

const TREATMENTS: { code: string; name: string; category: string; price: number; duration: number }[] = [
  { code: 'T-CONS', name: 'Consultation & Examination', category: 'General', price: 50000, duration: 15 },
  { code: 'T-SCAL', name: 'Scaling & Polishing (Full Mouth)', category: 'Preventive', price: 200000, duration: 45 },
  { code: 'T-COMP', name: 'Composite Filling', category: 'Restorative', price: 150000, duration: 40 },
  { code: 'T-AMAL', name: 'Amalgam Filling', category: 'Restorative', price: 100000, duration: 40 },
  { code: 'T-GIC', name: 'GIC Filling', category: 'Restorative', price: 120000, duration: 35 },
  { code: 'T-RCT', name: 'Root Canal Treatment', category: 'Endodontics', price: 600000, duration: 60 },
  { code: 'T-PULP', name: 'Pulpotomy', category: 'Endodontics', price: 150000, duration: 30 },
  { code: 'T-EXT', name: 'Simple Tooth Extraction', category: 'Surgery', price: 80000, duration: 30 },
  { code: 'T-SEXT', name: 'Surgical Extraction', category: 'Surgery', price: 300000, duration: 45 },
  { code: 'T-WISD', name: 'Wisdom Tooth Surgery', category: 'Surgery', price: 500000, duration: 60 },
  { code: 'T-IAND', name: 'I&D (Abscess Drainage)', category: 'Surgery', price: 100000, duration: 30 },
  { code: 'T-CROWN', name: 'Porcelain Crown', category: 'Prosthodontics', price: 800000, duration: 60 },
  { code: 'T-DENT', name: 'Complete Denture (Per Arch)', category: 'Prosthodontics', price: 1500000, duration: 90 },
  { code: 'T-PART', name: 'Partial Denture', category: 'Prosthodontics', price: 1000000, duration: 90 },
  { code: 'T-WHIT', name: 'Teeth Whitening', category: 'Cosmetic', price: 800000, duration: 60 },
  { code: 'T-ORTHO', name: 'Orthodontic Adjustment', category: 'Orthodontics', price: 150000, duration: 30 },
  { code: 'T-IMPL', name: 'Dental Implant Placement', category: 'Surgery', price: 4500000, duration: 120 },
  { code: 'T-FLUOR', name: 'Topical Fluoride Application', category: 'Preventive', price: 80000, duration: 20 },
  { code: 'T-SUTURE', name: 'Suture Removal', category: 'General', price: 30000, duration: 10 },
  { code: 'T-POST', name: 'Post & Core Build-up', category: 'Restorative', price: 400000, duration: 45 }
]

const MEDICINES: { name: string; generic: string; form: string; strength: string }[] = [
  { name: 'Amoxicillin', generic: 'Amoxicillin Trihydrate', form: 'capsule', strength: '500 mg' },
  { name: 'Amoxicillin + Clavulanate', generic: 'Amoxicillin/Clavulanic acid', form: 'tablet', strength: '625 mg' },
  { name: 'Metronidazole', generic: 'Metronidazole', form: 'tablet', strength: '400 mg' },
  { name: 'Paracetamol', generic: 'Paracetamol', form: 'tablet', strength: '500 mg' },
  { name: 'Ibuprofen', generic: 'Ibuprofen', form: 'tablet', strength: '400 mg' },
  { name: 'Aceclofenac', generic: 'Aceclofenac', form: 'tablet', strength: '100 mg' },
  { name: 'Diclofenac Sodium', generic: 'Diclofenac Sodium', form: 'tablet', strength: '50 mg' },
  { name: 'Chlorhexidine Mouthwash', generic: 'Chlorhexidine Gluconate', form: 'gargle', strength: '0.2%' },
  { name: 'Cetirizine', generic: 'Cetirizine Hydrochloride', form: 'tablet', strength: '10 mg' },
  { name: 'Omeprazole', generic: 'Omeprazole', form: 'capsule', strength: '20 mg' },
  { name: 'Piroxicam', generic: 'Piroxicam', form: 'capsule', strength: '20 mg' },
  { name: 'Tetracycline (Topical)', generic: 'Tetracycline', form: 'ointment', strength: '3%' }
]

const ACCOUNTING_CATEGORIES: { kind: 'income' | 'expense'; name: string; isSystem: boolean }[] = [
  { kind: 'income', name: 'Service Income', isSystem: true },
  { kind: 'income', name: 'Other Income', isSystem: false },
  { kind: 'expense', name: 'Clinic Rent', isSystem: false },
  { kind: 'expense', name: 'Electricity', isSystem: false },
  { kind: 'expense', name: 'Internet', isSystem: false },
  { kind: 'expense', name: 'Supplies & Accessories', isSystem: false },
  { kind: 'expense', name: 'Salaries', isSystem: false },
  { kind: 'expense', name: 'Maintenance', isSystem: false },
  { kind: 'expense', name: 'Other Expense', isSystem: false }
]

export function seed(db: Db, now = new Date()): void {
  const ts = now.toISOString()

  const moduleOf = (perm: string): string => {
    for (const [mod, perms] of Object.entries(PERMISSION_MODULES)) {
      if (perms.includes(perm as never)) return mod
    }
    return 'General'
  }

  const insPerm = db.prepare('INSERT OR IGNORE INTO permissions (key, module, description) VALUES (?, ?, ?)')
  for (const p of ALL_PERMISSIONS) insPerm.run(p, moduleOf(p), p)

  const permIds = new Map<string, number>(
    (db.prepare('SELECT id, key FROM permissions').all() as { id: number; key: string }[]).map((r) => [r.key, r.id])
  )

  const insRole = db.prepare('INSERT INTO roles (name, description, is_system, created_at) VALUES (?, ?, ?, ?)')
  const insRolePerm = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)')
  for (const role of SYSTEM_ROLES) {
    const res = insRole.run(role.name, role.description, 1, ts)
    const roleId = Number(res.lastInsertRowid)
    for (const p of role.permissions) {
      const pid = permIds.get(p)
      if (pid) insRolePerm.run(roleId, pid)
    }
  }
  // Custom role placeholder is created by users at runtime; no empty system role needed.

  const insCond = db.prepare(
    'INSERT OR IGNORE INTO tooth_conditions (code, name, color, is_system, is_active, sort_order) VALUES (?, ?, ?, 1, 1, ?)'
  )
  TOOTH_CONDITIONS.forEach((c, i) => insCond.run(c.code, c.name, c.color, i))

  const insOpt = db.prepare(
    'INSERT OR IGNORE INTO clinical_options (kind, value, sort_order, is_active) VALUES (?, ?, ?, 1)'
  )
  CC_OPTIONS.forEach((v, i) => insOpt.run('cc', v, i))
  OE_OPTIONS.forEach((v, i) => insOpt.run('oe', v, i))
  ADVICE_OPTIONS.forEach((v, i) => insOpt.run('advice', v, i))

  const insTrt = db.prepare(
    'INSERT OR IGNORE INTO treatments (code, name, category, default_price, duration_minutes, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)'
  )
  for (const t of TREATMENTS) insTrt.run(t.code, t.name, t.category, t.price, t.duration, ts, ts)

  const insMed = db.prepare(
    'INSERT INTO medicines (name, generic_name, dose_form, common_strength, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
  )
  for (const m of MEDICINES) insMed.run(m.name, m.generic, m.form, m.strength, ts, ts)

  const insCat = db.prepare(
    'INSERT OR IGNORE INTO accounting_categories (kind, name, is_system, is_active) VALUES (?, ?, ?, 1)'
  )
  for (const c of ACCOUNTING_CATEGORIES) insCat.run(c.kind, c.name, c.isSystem ? 1 : 0)

  const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
  insSetting.run('settings', JSON.stringify(DEFAULT_SETTINGS))
}
