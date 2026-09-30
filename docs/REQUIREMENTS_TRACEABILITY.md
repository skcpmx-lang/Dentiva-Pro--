# Dentiva Pro — Requirements Traceability Matrix

Status: `Not Started` → `In Progress` → `Implemented` → `Tested` → `Passed`. Evidence column cites code/test locations; updated only after verification. This matrix covers every requirement in the master specification (sections 0–150).

## Product fundamentals

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-PRD-001 | Commercial-grade Windows desktop app, not a demo/prototype | In Progress | |
| REQ-PRD-002 | Currency BDT ৳, formatting default, configurable | Planned | |
| REQ-PRD-003 | Professional English UI; Bengali Unicode user content | Planned | |
| REQ-PRD-004 | Fully offline operation; no cloud/API/telemetry dependencies | Planned | |
| REQ-PRD-005 | No fake functionality — every visible feature works | Planned | |
| REQ-PRD-006 | Ambiguities identified, interpreted, documented, verified | In Progress | DECISION_LOG |
| REQ-PRD-007 | About: creator Shohan Khan, helloiamshohan@gmail.com | Planned | |

## Architecture & data

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-ARC-001 | Stack evaluated & documented with rejected alternatives | Implemented | docs/ARCHITECTURE.md |
| REQ-ARC-002 | Layered separation: UI / domain / data / storage / security / print / backup / config / reporting | In Progress | src/main/services |
| REQ-ARC-003 | Business rules outside UI components, independently enforceable | In Progress | |
| REQ-ARC-004 | Real relational local DB (SQLite) with FK, indexes, transactions, constraints, migrations, recovery, audit, large datasets | In Progress | |
| REQ-ARC-005 | No localStorage/JSON/flat-file/in-memory primary store | Planned | |
| REQ-ARC-006 | No artificial record limits; pagination/virtualization/lazy loading/indexes | Planned | |
| REQ-ARC-007 | Single-entry accounting model documented w/ limitations | Implemented | DECISION_LOG AD-009 |

## Shell & UI quality

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-SHL-001 | Header: brand, clinic name, date, notifications, global search, user area, lock/logout, status | Planned | |
| REQ-SHL-002 | Grouped sidebar (Practice/Clinical/Billing/Administration) per spec | Planned | |
| REQ-SHL-003 | Collapsible sidebar, usable collapsed, tooltips | Planned | |
| REQ-SHL-004 | Formal design system (tokens, components, states) | Planned | |
| REQ-SHL-005 | Responsive 1280×720→3840×2160, scaling 100–200 %, no clipping/overflow | Planned | |
| REQ-SHL-006 | Grid discipline (no orphan rows) | Planned | |
| REQ-SHL-007 | Restrained premium animation | Planned | |
| REQ-SHL-008 | Keyboard shortcuts (Ctrl+K/N/S/P, Esc, nav) documented | Planned | |
| REQ-SHL-009 | Accessibility: keyboard nav, focus, contrast, labels, tooltips | Planned | |
| REQ-SHL-010 | Loading/empty/error/success states on every data screen | Planned | |
| REQ-SHL-011 | Helpful empty states with actions; no fake sample data | Planned | |
| REQ-SHL-012 | Theme (light/dark) + density settings | Planned | |

## First-run, activation, clinic setup

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-SET-001 | First-run wizard: welcome→activation→clinic→logo→address→phones→dentist(s)→designations→qualifications→admin→security→backup→printer→preferences→review→finish with validation | Planned | |
| REQ-SET-002 | Activation code required; offline; derived representation; not plaintext anywhere; audited; documented limitation | Planned | |
| REQ-SET-003 | Clinic info: name, logo (validated upload), address, phones, email, configurable | Planned | |
| REQ-SET-004 | Dentist profiles: multiple, independent info, multiple designations & qualifications, schedule, active status | Planned | |

## Patients

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-PAT-001 | Patient fields per spec §19 (code, name, age, dob, gender, blood group, address, phones, emergency, complaint, history, notes, language, status, registration date) | Planned | |
| REQ-PAT-002 | Unique patient code: auto-generation, optional manual, duplicate detection | Planned | |
| REQ-PAT-003 | Patient list: range tabs (Today/7/30/90/365/All/Custom, default Today newest-first), search, filters (dentist, status), sorting, pagination, export (perm) | Planned | |
| REQ-PAT-004 | Duplicate detection before creation (name/phone/dob/code) with confirmation, no false blocks | Planned | |
| REQ-PAT-005 | Patient profile: header (name, code, age, gender, phone, status, alerts, outstanding w/ perm) | Planned | |
| REQ-PAT-006 | Profile tabs: Overview, Timeline, Visits, Chart, Treatments, Prescriptions, Appointments, Invoices, Payments, Financial, Referrals, Attachments, Notes/Audit | Planned | |
| REQ-PAT-007 | Longitudinal history: visit count, all histories, totals billed/paid/outstanding, upcoming appointment, never overwritten | Planned | |
| REQ-PAT-008 | Quick actions from profile (visit/appointment/Rx/invoice/payment/attachment/referral/chart) auto-associate patient | Planned | |
| REQ-PAT-009 | Archive (soft) vs permanent delete policy w/ integrity protection | Planned | |

## Clinical

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-VIS-001 | Visits: separate records, all spec §24 fields, billing/referral/attachment links, follow-up; history immutable (edits audited) | Planned | |
| REQ-TIM-001 | Clinical timeline: all event types, chronological, filterable by type & date, paginated | Planned | |
| REQ-CHT-001 | Dental chart: adult+pediatric dentitions, FDI numbering, tooth selection/multi-select, conditions, notes, visit association, persisted history | Planned | |
| REQ-CHT-002 | Configurable condition library incl. spec §27 list | Planned | |
| REQ-TRT-001 | Treatment catalog: code, name, category, description, default price, duration, active; reusable; historical price snapshots | Planned | |
| REQ-RX-001 | Prescription creation from profile/visit/module; linked to patient/visit/dentist/date | Planned | |
| REQ-RX-002 | Rx content: clinic header, dentist credentials, patient block, C/C + O/E structured selectable options + custom, advice | Planned | |
| REQ-RX-003 | Multi-medicine builder: all spec §33 fields, add/remove/reorder, structured storage | Planned | |
| REQ-RX-004 | Rx print: premium layout, signature space, footer message, doctor timing | Planned | |
| REQ-RX-005 | Medicine catalog (name, generic, form, strength, active) | Planned | |
| REQ-ATT-001 | Attachments: images/PDF/docs; metadata (name/type/size/date/patient/visit/uploader/sha256); preview/open/export/delete w/ perm; validation & audit | Planned | |
| REQ-REF-001 | Referrals: all spec §110 fields, history in profile | Planned | |

## Practice flow

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-APT-001 | Appointments: all spec §29 fields/statuses; create/reschedule/cancel/no-show; filters by date/dentist/patient/status; history | Planned | |
| REQ-QUE-001 | Queue: token, priority, dentist, arrival/waiting times, states (waiting/called/in_treatment/billing/finished/cancelled), persistence | Planned | |
| REQ-DSH-001 | Role-aware dashboard: practice/clinical/financial(perm)/inventory widgets + quick actions | Planned | |
| REQ-SRC-001 | Global search: all authorized entity types, filters, RBAC-respecting, Ctrl+K palette | Planned | |
| REQ-NOT-001 | Notification center: types per spec §56, actionable, read/unread, mark all, categories, not spammy | Planned | |

## Billing & finance

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-INV-001 | Invoices: clinic identity, invoice no, patient, lines (treatment/custom, qty, unit price), discount, subtotal/total/paid/due, status | Planned | |
| REQ-INV-002 | Invoice printing: paper profiles, preview, PDF, Bengali, no signature by default | Planned | |
| REQ-INV-003 | Historical financial documents retain original amounts (price snapshots) | Planned | |
| REQ-PAY-001 | Payments: methods (cash/bank/card/bkash/nagad/rocket/upay/other), all spec §40 fields, invalid amounts rejected | Planned | |
| REQ-PAY-002 | Payment list: range tabs (default Today), method breakdown, totals, transaction count (perm) | Planned | |
| REQ-FIN-001 | Transactional financial integrity; integer money; consistent invoice/patient/audit state; no partial updates | Planned | |
| REQ-FIN-002 | Patient financial history (perm): totals, invoice & payment history, dues | Planned | |
| REQ-FIN-003 | Financial permission enforcement at business layer (spec §50 hard requirement) | Planned | |
| REQ-ACC-001 | Accounting: income/expense categories per spec §46, transactions, reports daily→yearly+custom, summaries, export (perm) | Planned | |

## Inventory

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-STK-001 | Items: name, SKU, category, unit, supplier, purchase info, batch, expiry, cost, qty, current stock, reorder threshold, status, notes | Planned | |
| REQ-STK-002 | Stock movements: in/out/adjust/damaged/expired/returned/usage; non-negative stock | Planned | |
| REQ-STK-003 | Alerts: low stock, out of stock, expiry approaching (configurable threshold), expired | Planned | |
| REQ-SUP-001 | Suppliers: contact, phone, address, notes, status; purchases linked | Planned | |

## Administration & security

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-STF-001 | Staff profiles per spec §47 (incl. photo, salary perm-controlled) | Planned | |
| REQ-USR-001 | Users separate from staff: username, password, staff link, role, status, last login, security settings | Planned | |
| REQ-USR-002 | Password hashing (scrypt), never plaintext, no hardcoded production passwords | Planned | |
| REQ-RBAC-001 | Granular RBAC: 7 system roles + custom roles, permission matrix editor, guards | Planned | |
| REQ-RBAC-002 | Permission enforcement at service layer; direct invocation cannot bypass | Planned | |
| REQ-AUD-001 | Audit log: all spec §51 events w/ old/new values; protected viewer; no delete path | Planned | |
| REQ-SEC-001 | Auto-lock 5/10/15/30 min; locked = data inaccessible + re-auth required | Planned | |
| REQ-SEC-002 | Local attack surface assessment + controls (spec §78) | Implemented | docs/SECURITY_MODEL.md |
| REQ-SEC-003 | No secret leaks; pre-release scan (activation code, passwords, keys) | Planned | |
| REQ-SEC-004 | Safe file uploads (type/size/corruption/duplicates/traversal) | Planned | |
| REQ-SEC-005 | Error handling: human-readable messages, no raw stack traces, safe technical logs | Planned | |
| REQ-SEC-006 | Crash safety: transactions on all critical ops | Planned | |
| REQ-SEC-007 | Data privacy: no external data transfer, no tracking | Planned | |
| REQ-SEC-008 | Destructive action safeguards (warning, impact, confirmation, typed confirm, admin auth, audit, pre-backup) | Planned | |

## Backup & restore

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-BKP-001 | Manual backup w/ folder selection, dated filenames, no overwrite | Planned | |
| REQ-BKP-002 | Scheduled backup 7/15/30/off, visible status, failure notification | Planned | |
| REQ-BKP-003 | Backup integrity: metadata (version, schema, timestamp, type, state) + checksums + post-create verification | Planned | |
| REQ-RST-001 | Restore: selection, warning, auth, pre-restore backup, verification, transactional swap, post-verify, state reload, audit; failure never destroys data | Planned | |

## Printing

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-PRN-001 | Reusable print system: profiles, paper sizes, orientation, margins, scale, preview, Windows printers, PDF, Bengali | Planned | |
| REQ-PRN-002 | Print preview: zoom, page navigation, paper/printer selection, print, cancel | Planned | |
| REQ-PRN-003 | Prescription layout per spec §36 incl. signature area ≥ adequate | Planned | |
| REQ-PRN-004 | Paper sizes A4/A5/thermal/mini/custom adapt without breakage | Planned | |
| REQ-PRN-005 | Bundled Bengali font w/ fallback strategy; Bengali print tested | Planned | |
| REQ-PRN-006 | No claim of universal printer compatibility; Windows-accessible printers + documented limits | Implemented | docs/PRINT_SPECIFICATION.md |

## Settings & misc

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-SETN-001 | Settings categories per spec §62 (Practice, Dentists, Users & Security, Clinical, Prescription, Invoice, Printing, Backup, Notifications, Appearance, Data Management, Advanced, About) | Planned | |
| REQ-RPT-001 | Reports: clinical/appointment/financial/inventory, RBAC-obeyed, export (perm) | Planned | |
| REQ-EXP-001 | Controlled export (CSV/PDF) w/ permission enforcement | Planned | |
| REQ-DAT-001 | Bangladesh-local date/time behavior (Asia/Dhaka default), consistent display | Planned | |
| REQ-LOG-001 | Safe diagnostic logging, rotation, redaction | Planned | |
| REQ-ICO-001 | Professional app icon (multi-size .ico) used for exe/installer/shortcut/shell | Planned | |

## Engineering & release

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-ENG-001 | Planning docs maintained & synchronized | In Progress | docs/ |
| REQ-ENG-002 | Dependency audit: package, version, license, purpose, compatibility | Implemented | docs/DEPENDENCY_LICENSE_AUDIT.md |
| REQ-ENG-003 | Third-party notices shipped in-app | Planned | |
| REQ-ENG-004 | Dead-code scan (TODO/FIXME/placeholder/fake/debug) clean | Planned | |
| REQ-ENG-005 | Unit + integration + E2E tests; 50-step workflow test; RBAC/financial/backup/print matrices | Planned | |
| REQ-ENG-006 | Stress testing w/ measured results | Planned | |
| REQ-ENG-007 | GitHub Actions: install, lint, typecheck, tests, build validation, Windows build, installer, artifacts | Planned | |
| REQ-ENG-008 | Production NSIS installer (name, publisher, version, icon, shortcuts, uninstaller, clean uninstall) | Planned | |
| REQ-ENG-009 | Release validation of the actual artifact (exists, checksum, installs, launches, core flows) — CI-substituted where hardware absent, honestly documented | Planned | |
| REQ-ENG-010 | Final gates: requirements 100 %, P0/P1 = 0, security/DB/UX/print audits | Planned | |
| REQ-ENG-011 | Git workflow: clean commits, no secrets/data/temp artifacts committed | In Progress | |
| REQ-ENG-012 | PR created; **not merged** without explicit user instruction | Planned | |
| REQ-ENG-013 | GitHub Release with verified installer (or /dist fallback) | Planned | |
| REQ-ENG-014 | Final documentation set (README, install, requirements, backup/restore, printer, shortcuts, permissions, troubleshooting, notices, notes) | Planned | |
| REQ-ENG-015 | Final report per spec §145 with honest limitations | Planned | |
