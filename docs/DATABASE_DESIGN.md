# Dentiva Pro — Database Design

Engine: **SQLite** (via better-sqlite3 13). Pragmas: `journal_mode=WAL`, `foreign_keys=ON`, `synchronous=NORMAL`, `busy_timeout=5000`, `trusted_schema=OFF`.

## 1. Conventions

- Primary keys: `INTEGER PRIMARY KEY` (rowid) — compact, fast.
- **Money: INTEGER paisa** (1 BDT = 100 paisa). All arithmetic integer. Display-only conversion via shared formatter.
- **System timestamps: TEXT UTC ISO-8601** (`created_at`, `updated_at`). **Business dates: TEXT `YYYY-MM-DD`** (clinic-local); times `HH:mm`.
- Soft delete where history matters (`archived_at`); hard delete only where integrity rules permit.
- Every mutation writes an `audit_log` row (service layer).

## 2. Entity-Relationship Overview

```
Clinic (1)──(n) Dentist ──(n) DentistDesignation
                      ──(n) DentistQualification
Staff (1)──(0..1) User (n)──(1) Role (n)──(n) Permission [role_permissions]
Patient (1)──(n) Visit (1)──(n) VisitTreatment ──(0..1) Treatment (catalog)
Patient (1)──(n) Appointment ──(0..1) QueueEntry
Patient (1)──(n) Prescription (1)──(n) PrescriptionMedicine ──(0..1) Medicine (catalog)
Patient (1)──(n) ChartEntry (per tooth, full history)
Patient (1)──(n) Attachment (0..1 Visit)
Patient (1)──(n) Referral
Patient (1)──(n) Invoice (1)──(n) InvoiceLine ──(0..1) Treatment
Invoice (1)──(n) Payment (also standalone payments per patient)
Payment (1)──(0..1) FinancialTransaction (auto income, reversible)
Supplier (1)──(n) InventoryBatch (n)──(1) InventoryItem (1)──(n) StockMovement
AccountingCategory (1)──(n) FinancialTransaction
AuditLog · Notification · BackupMetadata · PrinterProfile · Setting · ActivationState
```

## 3. Tables (final schema, migration v1)

### Identity & access
| Table | Key columns & constraints |
|---|---|
| `roles` | id, name UNIQUE, description, is_system (Owner/Admin/Dentist/… uneditable core), created_at |
| `permissions` | id, key UNIQUE (e.g. `patient.view`), module, description |
| `role_permissions` | role_id FK→roles, permission_id FK→permissions, PK(role_id, permission_id) |
| `users` | id, username UNIQUE COLLATE NOCASE, password_hash (scrypt), display_name, role_id FK, staff_id FK NULL, is_active, must_change_password, failed_attempts, locked_until, last_login_at, created_at, updated_at |
| `staff` | id, name, dob, gender, address, blood_group, id_document, photo_attachment_id NULL, phone, designation, department, salary (paisa, NULL), joining_date, status, notes, created_at, updated_at |

### Practice & clinical
| Table | Key columns & constraints |
|---|---|
| `clinic` | id=1, name, address, phone, phone2, email, logo_path, tagline, footer_message, doctor_timing, created_at, updated_at |
| `dentists` | id, full_name, phone, email, signature_path NULL, working_schedule (JSON), is_active, notes, created_at, updated_at |
| `dentist_designations` | id, dentist_id FK CASCADE, value, sort_order |
| `dentist_qualifications` | id, dentist_id FK CASCADE, value, sort_order |
| `patients` | id, patient_code UNIQUE, full_name, age NULL, dob NULL, gender, blood_group NULL, address NULL, phone NULL, emergency_phone NULL, emergency_contact_name NULL, chief_complaint NULL, previous_history NULL, notes NULL, preferred_language NULL, status, registered_dentist_id FK NULL, registered_at (date), archived_at NULL, created_by FK→users, created_at, updated_at. CHECK (gender in list), CHECK (age 0..150) |
| `visits` | id, patient_id FK RESTRICT, dentist_id FK, visit_date (date), visit_time, reason, chief_complaint, examination, diagnosis, treatment_summary, notes, follow_up_date NULL, follow_up_note NULL, status, created_by, created_at, updated_at |
| `treatments` | id, code UNIQUE NULLABLE, name, category, description NULL, default_price (paisa), duration_minutes NULL, is_active, created_at, updated_at |
| `visit_treatments` | id, visit_id FK CASCADE, treatment_id FK RESTRICT NULL, name (snapshot), tooth_numbers NULL, unit_price (snapshot paisa), quantity, line_total, notes NULL |
| `tooth_conditions` | id, code UNIQUE, name, color, is_system, is_active, sort_order |
| `chart_entries` | id, patient_id FK RESTRICT, visit_id FK SET NULL, dentition ('adult'\|'pediatric'), tooth (FDI number), condition_id FK RESTRICT, note NULL, recorded_by FK, recorded_at; INDEX (patient_id, dentition, tooth, recorded_at) |
| `clinical_options` | id, kind ('cc'\|'oe'\|'advice'), value, sort_order, is_active (seeded per spec §32, configurable) |

### Prescriptions
| Table | Key columns |
|---|---|
| `prescriptions` | id, rx_no UNIQUE, patient_id FK RESTRICT, visit_id FK SET NULL, dentist_id FK, rx_date (date), cc_json, oe_json, advice (text), extra_advice NULL, follow_up_date NULL, status ('active'\|'void'), created_by, created_at, updated_at |
| `prescription_medicines` | id, prescription_id FK CASCADE, medicine_id FK NULL, name, dose_form, strength NULL, dose NULL, morning/noon/night (0/1), meal ('before'\|'after'\|NULL), duration_value NULL, duration_unit ('day'\|'week'\|'month'\|NULL), quantity NULL, instruction NULL, is_prn (0/1), custom_instruction NULL, sort_order |
| `medicines` | id, name, generic_name NULL, dose_form NULL, common_strength NULL, is_active, created_at, updated_at |

### Scheduling & flow
| Table | Key columns |
|---|---|
| `appointments` | id, patient_id FK RESTRICT, dentist_id FK, appt_date (date), appt_time, duration_minutes, reason, status ('scheduled','confirmed','arrived','waiting','in_consultation','completed','cancelled','no_show','rescheduled'), notes, source_appointment_id FK NULL (reschedule chain), cancelled_reason NULL, created_by, created_at, updated_at; INDEX(appt_date), (patient_id), (dentist_id, appt_date) |
| `queue_entries` | id, token_no, queue_date (date), patient_id FK RESTRICT, appointment_id FK SET NULL, dentist_id FK, priority, status ('waiting','called','in_treatment','billing','finished','cancelled'), arrived_at, called_at NULL, started_at NULL, completed_at NULL, finished_at NULL, notes NULL; UNIQUE(queue_date, token_no) |

### Documents & files
| Table | Key columns |
|---|---|
| `attachments` | id, patient_id FK RESTRICT, visit_id FK SET NULL, original_filename, stored_filename (uuid.ext, server-generated), mime_type, size_bytes, sha256, category, description NULL, uploaded_by, uploaded_at, deleted_at NULL |
| `referrals` | id, patient_id FK RESTRICT, visit_id FK SET NULL, from_dentist_id FK, to_doctor_name, to_clinic NULL, reason, notes NULL, status ('pending','completed','cancelled'), follow_up_date NULL, created_by, created_at, updated_at |

### Billing & finance
| Table | Key columns |
|---|---|
| `invoices` | id, invoice_no UNIQUE, patient_id FK RESTRICT, visit_id FK SET NULL, dentist_id FK NULL, invoice_date, subtotal, discount, total, paid_amount, due_amount (paisa; denormalized + invariant-checked), status ('unpaid','partial','paid','void'), notes NULL, voided_reason NULL, created_by, created_at, updated_at |
| `invoice_lines` | id, invoice_id FK CASCADE, treatment_id FK RESTRICT NULL, description, quantity, unit_price, line_total (paisa) |
| `payments` | id, patient_id FK RESTRICT, invoice_id FK SET NULL, payment_date (date), payment_time, amount (paisa), method ('cash','bank','card','bkash','nagad','rocket','upay','other'), reference NULL, received_by FK→users, notes NULL, status ('valid','void'), voided_reason NULL, voided_by NULL, voided_at NULL, created_at |
| `financial_transactions` | id, kind ('income','expense'), category_id FK RESTRICT, amount (paisa), txn_date, method, description, reference NULL, payment_id FK SET NULL (auto-income link), created_by, created_at |
| `accounting_categories` | id, kind ('income','expense'), name, is_system, is_active |

### Inventory
| Table | Key columns |
|---|---|
| `suppliers` | id, name, contact_person NULL, phone NULL, address NULL, notes NULL, is_active |
| `inventory_items` | id, name, sku UNIQUE, category NULL, unit, reorder_threshold, notes NULL, is_active, created_at, updated_at |
| `inventory_batches` | id, item_id FK CASCADE, supplier_id FK SET NULL, purchase_date, batch_no NULL, expiry_date NULL, purchase_cost (paisa), qty_purchased, qty_current, status ('active','depleted','expired','damaged','returned'), created_at; CHECK(qty_current >= 0) |
| `stock_movements` | id, item_id FK CASCADE, batch_id FK SET NULL, type ('in','out','adjust','damaged','expired','returned','usage'), quantity, reason NULL, reference NULL, created_by, created_at |

### System
| Table | Key columns |
|---|---|
| `settings` | key TEXT PK, value TEXT (JSON); typed accessor in service |
| `audit_log` | id, user_id NULL, username, action, entity, entity_id NULL, old_value NULL, new_value NULL, context NULL, created_at; INDEX(created_at), (entity, entity_id) |
| `notifications` | id, type, severity ('info','success','warning','error'), title, body, data_json NULL, route NULL, audience ('all','financial','inventory','admin'), is_read, created_at |
| `backups_metadata` | id, filename, path UNIQUE, size_bytes, sha256, schema_version, app_version, backup_type ('manual','auto','pre_restore'), status ('pending','verified','failed','restored'), created_by, created_at, verified_at NULL |
| `printer_profiles` | id, name, device_name NULL, paper ('a4','a5','letter','thermal80','thermal58','custom'), width_mm NULL, height_mm NULL, margin_mm, scale, use_for ('prescription','invoice','receipt','report'), is_default, created_at |
| `activation_state` | id=1, is_activated, activated_at, verifier_fingerprint, created_at, updated_at |
| `schema_migrations` | version INTEGER PK, name, applied_at |

## 4. Referential Integrity Rules

- Financial/clinical parents use `ON DELETE RESTRICT` — an invoice with payments, or a patient with visits, cannot be hard-deleted (prevents orphans, spec §75).
- Child rows (lines, medicines, designations) cascade with their document.
- `visit_id` on prescriptions/invoices/attachments is `SET NULL` — deleting a visit never orphans financial records.
- Unique constraints: patient_code, invoice_no, rx_no, sku, username (NOCASE), (queue_date, token_no), role/permission pairs.
- CHECK constraints: non-negative quantities/amounts, gender/status enums, age range.
- Invariant maintenance inside transactions: `invoice.paid_amount/due_amount/status` recomputed from valid payments on every payment change; unit tests assert consistency under partial payment, overpay rejection, and void.

## 5. Migration Strategy

- Numbered migrations in `src/main/core/migrations.ts` executed inside a transaction at startup; `schema_migrations` records applied versions. Baseline v1 creates the full schema; future migrations append. Backup/restore validates schema version compatibility before restore.

## 6. Unbounded Growth (spec §8)

- No application-level record limits anywhere.
- All list APIs paginated (`LIMIT/OFFSET` + count); profile screens load per-tab lazily.
- Indexes on every hot filter/sort column (date ranges, codes, phones, names, FKs).
- Patient list default window: Today; timeline paginated; audit viewer paginated with date filters.
- Stress evidence (generated datasets, measured timings) recorded in `TEST_PLAN.md`.
