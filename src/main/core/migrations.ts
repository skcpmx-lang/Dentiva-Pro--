export interface Migration {
  version: number
  name: string
  sql: string
}

const V1 = `
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE activation_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  is_activated INTEGER NOT NULL DEFAULT 0,
  activated_at TEXT,
  verifier_fingerprint TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE roles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE permissions (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  module TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE staff (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  dob TEXT,
  gender TEXT CHECK (gender IN ('male','female','other') OR gender IS NULL),
  address TEXT,
  blood_group TEXT,
  id_document TEXT,
  photo_path TEXT,
  phone TEXT,
  designation TEXT,
  department TEXT,
  salary INTEGER,
  joining_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE clinic (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  phone2 TEXT,
  email TEXT,
  logo_path TEXT,
  tagline TEXT,
  footer_message TEXT,
  doctor_timing TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE dentists (
  id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  signature_path TEXT,
  working_schedule TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE dentist_designations (
  id INTEGER PRIMARY KEY,
  dentist_id INTEGER NOT NULL REFERENCES dentists(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE dentist_qualifications (
  id INTEGER PRIMARY KEY,
  dentist_id INTEGER NOT NULL REFERENCES dentists(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE patients (
  id INTEGER PRIMARY KEY,
  patient_code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  age INTEGER CHECK (age IS NULL OR (age >= 0 AND age <= 150)),
  dob TEXT,
  gender TEXT NOT NULL CHECK (gender IN ('male','female','other')),
  blood_group TEXT,
  address TEXT,
  phone TEXT,
  emergency_phone TEXT,
  emergency_contact_name TEXT,
  chief_complaint TEXT,
  previous_history TEXT,
  notes TEXT,
  preferred_language TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  registered_dentist_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  registered_at TEXT NOT NULL,
  archived_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_patients_name ON patients(full_name);
CREATE INDEX idx_patients_phone ON patients(phone);
CREATE INDEX idx_patients_registered ON patients(registered_at);
CREATE INDEX idx_patients_status ON patients(status);

CREATE TABLE treatments (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  default_price INTEGER NOT NULL DEFAULT 0 CHECK (default_price >= 0),
  duration_minutes INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE visits (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  dentist_id INTEGER NOT NULL REFERENCES dentists(id) ON DELETE RESTRICT,
  visit_date TEXT NOT NULL,
  visit_time TEXT NOT NULL,
  reason TEXT,
  chief_complaint TEXT,
  examination TEXT,
  diagnosis TEXT,
  treatment_summary TEXT,
  notes TEXT,
  follow_up_date TEXT,
  follow_up_note TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('open','completed')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_visits_patient ON visits(patient_id, visit_date);
CREATE INDEX idx_visits_date ON visits(visit_date);
CREATE INDEX idx_visits_dentist ON visits(dentist_id, visit_date);

CREATE TABLE visit_treatments (
  id INTEGER PRIMARY KEY,
  visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  treatment_id INTEGER REFERENCES treatments(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  tooth_numbers TEXT,
  unit_price INTEGER NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  line_total INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_visit_treatments_visit ON visit_treatments(visit_id);

CREATE TABLE tooth_conditions (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#94A3B8',
  is_system INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE chart_entries (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  dentition TEXT NOT NULL CHECK (dentition IN ('adult','pediatric')),
  tooth INTEGER NOT NULL CHECK (tooth > 0),
  condition_id INTEGER NOT NULL REFERENCES tooth_conditions(id) ON DELETE RESTRICT,
  note TEXT,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recorded_at TEXT NOT NULL
);
CREATE INDEX idx_chart_lookup ON chart_entries(patient_id, dentition, tooth, recorded_at);

CREATE TABLE clinical_options (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('cc','oe','advice')),
  value TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (kind, value)
);

CREATE TABLE medicines (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  generic_name TEXT,
  dose_form TEXT,
  common_strength TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE prescriptions (
  id INTEGER PRIMARY KEY,
  rx_no TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  dentist_id INTEGER NOT NULL REFERENCES dentists(id) ON DELETE RESTRICT,
  rx_date TEXT NOT NULL,
  cc_json TEXT NOT NULL DEFAULT '[]',
  oe_json TEXT NOT NULL DEFAULT '[]',
  advice TEXT,
  extra_advice TEXT,
  follow_up_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_rx_patient ON prescriptions(patient_id, rx_date);
CREATE INDEX idx_rx_date ON prescriptions(rx_date);

CREATE TABLE prescription_medicines (
  id INTEGER PRIMARY KEY,
  prescription_id INTEGER NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  medicine_id INTEGER REFERENCES medicines(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  dose_form TEXT,
  strength TEXT,
  dose TEXT,
  morning INTEGER NOT NULL DEFAULT 0,
  noon INTEGER NOT NULL DEFAULT 0,
  night INTEGER NOT NULL DEFAULT 0,
  meal TEXT CHECK (meal IN ('before','after') OR meal IS NULL),
  duration_value INTEGER,
  duration_unit TEXT CHECK (duration_unit IN ('day','week','month') OR duration_unit IS NULL),
  quantity TEXT,
  instruction TEXT,
  is_prn INTEGER NOT NULL DEFAULT 0,
  custom_instruction TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE appointments (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  dentist_id INTEGER NOT NULL REFERENCES dentists(id) ON DELETE RESTRICT,
  appt_date TEXT NOT NULL,
  appt_time TEXT NOT NULL,
  duration_minutes INTEGER,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','confirmed','arrived','waiting','in_consultation','completed','cancelled','no_show','rescheduled')),
  notes TEXT,
  source_appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  cancelled_reason TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_appt_date ON appointments(appt_date);
CREATE INDEX idx_appt_patient ON appointments(patient_id);
CREATE INDEX idx_appt_dentist_date ON appointments(dentist_id, appt_date);

CREATE TABLE queue_entries (
  id INTEGER PRIMARY KEY,
  token_no INTEGER NOT NULL,
  queue_date TEXT NOT NULL,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  dentist_id INTEGER NOT NULL REFERENCES dentists(id) ON DELETE RESTRICT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent')),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','called','in_treatment','billing','finished','cancelled')),
  arrived_at TEXT NOT NULL,
  called_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  finished_at TEXT,
  notes TEXT,
  UNIQUE (queue_date, token_no)
);
CREATE INDEX idx_queue_date ON queue_entries(queue_date, status);

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'document',
  description TEXT,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_attachments_patient ON attachments(patient_id);

CREATE TABLE referrals (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  from_dentist_id INTEGER NOT NULL REFERENCES dentists(id) ON DELETE RESTRICT,
  to_doctor_name TEXT NOT NULL,
  to_clinic TEXT,
  reason TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','cancelled')),
  follow_up_date TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  invoice_no TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  dentist_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  invoice_date TEXT NOT NULL,
  subtotal INTEGER NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  paid_amount INTEGER NOT NULL DEFAULT 0,
  due_amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','partial','paid','void')),
  notes TEXT,
  voided_reason TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_invoices_patient ON invoices(patient_id);
CREATE INDEX idx_invoices_date ON invoices(invoice_date);
CREATE INDEX idx_invoices_no ON invoices(invoice_no);

CREATE TABLE invoice_lines (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  treatment_id INTEGER REFERENCES treatments(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price INTEGER NOT NULL DEFAULT 0,
  line_total INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE RESTRICT,
  payment_date TEXT NOT NULL,
  payment_time TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('cash','bank','card','bkash','nagad','rocket','upay','other')),
  reference TEXT,
  received_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','void')),
  voided_reason TEXT,
  voided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  voided_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);
CREATE INDEX idx_payments_date ON payments(payment_date);
CREATE INDEX idx_payments_patient ON payments(patient_id);

CREATE TABLE accounting_categories (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  name TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (kind, name)
);

CREATE TABLE financial_transactions (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  category_id INTEGER NOT NULL REFERENCES accounting_categories(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  txn_date TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',
  description TEXT,
  reference TEXT,
  payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ftxn_date ON financial_transactions(txn_date, kind);
CREATE INDEX idx_ftxn_payment ON financial_transactions(payment_id);

CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  address TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE inventory_items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT NOT NULL UNIQUE,
  category TEXT,
  unit TEXT NOT NULL DEFAULT 'piece',
  reorder_threshold INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE inventory_batches (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  purchase_date TEXT NOT NULL,
  batch_no TEXT,
  expiry_date TEXT,
  purchase_cost INTEGER NOT NULL DEFAULT 0,
  qty_purchased INTEGER NOT NULL CHECK (qty_purchased > 0),
  qty_current INTEGER NOT NULL CHECK (qty_current >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','depleted','damaged','returned')),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_batches_item ON inventory_batches(item_id);
CREATE INDEX idx_batches_expiry ON inventory_batches(expiry_date);

CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  batch_id INTEGER REFERENCES inventory_batches(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('in','out','adjust','damaged','expired','returned','usage')),
  quantity INTEGER NOT NULL,
  reason TEXT,
  reference TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_stock_item ON stock_movements(item_id, created_at);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  old_value TEXT,
  new_value TEXT,
  context TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_created ON audit_log(created_at);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','success','warning','error')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data_json TEXT,
  route TEXT,
  audience TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','financial','inventory','admin')),
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notifications_read ON notifications(is_read, created_at);

CREATE TABLE backups_metadata (
  id INTEGER PRIMARY KEY,
  filename TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT,
  schema_version INTEGER NOT NULL,
  app_version TEXT NOT NULL,
  backup_type TEXT NOT NULL CHECK (backup_type IN ('manual','auto','pre_restore')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','failed','restored')),
  created_by TEXT,
  created_at TEXT NOT NULL,
  verified_at TEXT
);

CREATE TABLE printer_profiles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  device_name TEXT,
  paper TEXT NOT NULL DEFAULT 'a4',
  width_mm REAL,
  height_mm REAL,
  margin_mm REAL NOT NULL DEFAULT 8,
  scale REAL NOT NULL DEFAULT 100,
  use_for TEXT NOT NULL DEFAULT 'any' CHECK (use_for IN ('prescription','invoice','receipt','report','any')),
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
`

export const MIGRATIONS: Migration[] = [{ version: 1, name: 'baseline', sql: V1 }]
