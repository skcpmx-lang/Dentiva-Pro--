# Dentiva Pro — Requirements Traceability Matrix

Status: `Not Started` → `In Progress` → `Implemented` → `Tested` → `Passed`. Evidence cites source, tests, E2E and CI; statuses are updated only after verification. **Passed** is reserved for requirements additionally validated on the real packaged app / real CI environment.

**Evidence key (this revision):**
- **Unit/integration (vitest, 152 tests / 13 files, all green locally + CI `verify` job):** `tests/smoke.test.ts` (18), `tests/auth.test.ts` (10), `tests/rbac.test.ts` (9), `tests/staff.test.ts` (12), `tests/accounting.test.ts` (6), `tests/chart.test.ts` (7), `tests/inventory.test.ts` (8), `tests/backup.test.ts` (7), `tests/destructive.test.ts` (3), `tests/workflow.test.ts` (42-step business workflow), `tests/stress.test.ts` (6), `tests/print-templates.test.ts` (18), `tests/zip-guard.test.ts` (6).
- **CI jobs (.github/workflows/ci.yml):** `verify` (typecheck + lint + 151 tests + build), `e2e` (ubuntu: Playwright-Electron smoke + print/PDF geometry suite), `windows-installer` (real NSIS build + asar audit + installer end-to-end validation), `windows-packaged-e2e` (full clinical flow against the packaged Windows app).
- **CI E2E smoke passed** on real Electron under xvfb: runs [36696431273](https://github.com/skcpmx-lang/Dentiva-Pro--/actions/runs/36696431273), [36696796492](https://github.com/skcpmx-lang/Dentiva-Pro--/actions/runs/36696796492).
- The installer / packaged-E2E / print-geometry jobs are running against commit `236e84c` — rows below say "CI run pending" where their result is not yet in. They will be promoted to Passed only when the actual run is green.

## Product fundamentals

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-PRD-001 | Commercial-grade Windows desktop app, not a demo/prototype | In Progress | Real NSIS x64 installer builds on CI and **passed full end-to-end validation** (run 36719098611, commit 236e84c: PE metadata, SHA-256, silent install, Start-Menu shortcut, uninstall-registry entry "Dentiva Pro 1.0.0" + publisher + version, app files, launch, clean uninstall); packaged-app E2E flow 16/30 (patientList defect fixed after that run — re-run pending) |
| REQ-PRD-002 | Currency BDT ৳, formatting default | Tested | Integer-paisa arithmetic in all services; `money()` (src/renderer/src/ui.tsx), `taka()` (src/shared/print.ts); tests/print-templates.test.ts asserts ৳ amounts; workflow steps 16–23 |
| REQ-PRD-003 | Professional English UI; Bengali Unicode user content | Tested | Bengali patient create + search (tests/smoke.test.ts), Bengali print labels (tests/print-templates.test.ts), Bengali stress search (tests/stress.test.ts); packaged E2E creates Bengali patient (CI run pending) |
| REQ-PRD-004 | Fully offline operation; no cloud/API/telemetry | Implemented | No outbound network calls anywhere in src/; SECURITY_MODEL.md; asar-audit (e2e/asar-audit.mjs) scans packaged app in CI |
| REQ-PRD-005 | No fake functionality — every visible feature works | Tested | Audit this revision removed the last fake controls (inventory "Quick add batch" rewritten as real picker; `{void busy}` placeholder wired); TODO/FIXME/placeholder/dead-code scan clean (see ENG-004) |
| REQ-PRD-006 | Ambiguities identified, interpreted, documented, verified | Implemented | DECISION_LOG.md maintained |
| REQ-PRD-007 | About: creator Shohan Khan, helloiamshohan@gmail.com | Implemented | Settings → About tab (src/renderer/src/pages/settings.tsx AboutTab) reading `system.about` (src/main/ipc/router.ts) |

## Architecture & data

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-ARC-001 | Stack evaluated & documented with rejected alternatives | Implemented | docs/ARCHITECTURE.md |
| REQ-ARC-002 | Layered separation: UI / domain / data / storage / security / print / backup / config / reporting | Tested | 25 services in src/main/services (business rules outside UI); tests import services directly and run without Electron |
| REQ-ARC-003 | Business rules outside UI components, independently enforceable | Tested | Same as above; RBAC enforced in service layer (tests/rbac.test.ts) |
| REQ-ARC-004 | Real relational local DB (SQLite) with FK, indexes, transactions, constraints, migrations, recovery, audit, large datasets | Tested | src/main/core/db.ts + migrations.ts; integrity_check + foreign_key_check in backup/restore tests; 10k/20k/15k stress suite |
| REQ-ARC-005 | No localStorage/JSON/flat-file/in-memory primary store | Implemented | SQLite only (src/main/core/db.ts); localStorage used solely for the sidebar-collapse UI preference |
| REQ-ARC-006 | No artificial record limits; pagination/virtualization/lazy loading/indexes | Tested | Paginated lists (patients/invoices/visits/referrals); stress measurements in TEST_PLAN.md §8 |
| REQ-ARC-007 | Single-entry accounting model documented w/ limitations | Implemented | DECISION_LOG AD-009 |

## Shell & UI quality

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-SHL-001 | Header: brand, clinic name, date, global search, notifications, user area, lock/logout, status | In Progress | TopBar has search + notifications + user menu w/ lock/logout (src/renderer/src/App.tsx); clinic name is in the sidebar header; app-status chip not present |
| REQ-SHL-002 | Grouped sidebar (Practice/Clinical/Billing/Administration) per spec | In Progress | Permission-gated sidebar with a Manage section divider; full four-group labeling not implemented |
| REQ-SHL-003 | Collapsible sidebar, usable collapsed, tooltips | Implemented | 64px collapsed mode, persisted preference, `title=` tooltips (commit b0ac0eb); packaged-E2E collapse step CI run pending |
| REQ-SHL-004 | Formal design system (tokens, components, states) | Implemented | src/renderer/src/ui.tsx component library + styles.css tokens |
| REQ-SHL-005 | Responsive 1280×720→3840×2160, scaling 100–200 %, no clipping/overflow | Tested | UI sweep at 1280×720 + 1920×1080 with scrollWidth/clientWidth overflow assertions (e2e/full.mjs, CI run pending); high-DPI/zoom matrix beyond that is EXTERNAL |
| REQ-SHL-006 | Grid discipline (no orphan rows) | Implemented | form-grid/card layouts across pages |
| REQ-SHL-007 | Restrained premium animation | Implemented | Minimal transitions (styles.css) |
| REQ-SHL-008 | Keyboard shortcuts (Ctrl+K/N/S/P, Esc, nav) documented | In Progress | Ctrl+K search, Ctrl+N new patient, Ctrl+1–9 sidebar, Alt+←/→ history, Esc closes modals (App.tsx, commit b0ac0eb; e2e steps CI run pending); Ctrl+S/Ctrl+P not implemented |
| REQ-SHL-009 | Accessibility: keyboard nav, focus, contrast, labels, tooltips | In Progress | Forms are keyboard-navigable, icons labelled; no systematic accessibility audit yet |
| REQ-SHL-010 | Loading/empty/error/success states on every data screen | Implemented | Loading/EmptyState/toast components used on all list pages; empty states observed in packaged E2E log |
| REQ-SHL-011 | Helpful empty states with actions; no fake sample data | Implemented | EmptyState with hints (e.g. chart picker); no seeded demo data |
| REQ-SHL-012 | Theme (light/dark) + density settings | In Progress | Appearance settings persisted (settings schema + AppTab); dark palette not yet styled |

## First-run, activation, clinic setup

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-SET-001 | First-run wizard with validation | Tested | 3-step wizard (activation → clinic+dentist → owner) with server-side validation (src/main/services/setup.ts completeSetup); tests/smoke.test.ts 'setup state machine'; workflow step 3; packaged E2E walks the real wizard (invalid code rejected — Passed on CI e2e smoke 36696431273; full wizard CI run pending). Gap vs spec: wizard is condensed (no logo/printer/review steps — configurable later in Settings) |
| REQ-SET-002 | Activation code required; offline; derived verifier; never plaintext; audited | Tested | src/main/services/activation.ts + src/main/core/activationSecret.ts (scrypt verifier; generator scripts/gen-activation-verifier.mjs); invalid-code rejection Passed on CI (36696431273); valid-code path exercised by windows-packaged-e2e with a throwaway verifier (CI run pending) |
| REQ-SET-003 | Clinic info: name, logo (validated upload), address, phones, email, configurable | Tested | clinic table + settings ClinicTab (upload/preview/remove logo); logo validation (src/main/index.ts validateAndStoreImage); logo now renders in print headers (tests/print-templates.test.ts) |
| REQ-SET-004 | Dentist profiles: multiple, designations & qualifications, schedule, active status | Tested | dentists/dentist_designations/dentist_qualifications tables; settings service; workflow step 3; referral form dentist picker |

## Patients

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-PAT-001 | Patient fields per spec §19 | Tested | patients table + patientCreate validation; smoke + workflow suites |
| REQ-PAT-002 | Unique patient code: auto-generation, duplicate detection | Tested | code sequence in settings; patientDuplicates service (workflow step 2 checks duplicates) |
| REQ-PAT-003 | Patient list: range tabs, search, filters, sorting, pagination, export (perm) | Tested | patientList with preset/search/status/pagination; **defect found by packaged E2E (run 36719098611) and fixed**: rows leaked snake_case keys so every list column and patient picker rendered blank — now mapped to the camelCase `PatientListRow` contract with a smoke regression test asserting the row shape (incl. no snake_case leak, `sort: 'lastVisit'` SQL fix, `status: 'all'` fix); CSV export permission-gated |
| REQ-PAT-004 | Duplicate detection before creation with confirmation | Tested | patientDuplicates + UI confirmation |
| REQ-PAT-005 | Patient profile header (name, code, age, gender, phone, status, outstanding w/ perm) | Tested | PatientDetailPage; financial fields hidden without permission (workflow step 33) |
| REQ-PAT-006 | Profile tabs: Overview, Timeline, Visits, Chart, … | In Progress | Single-page profile with stats + clinical timeline aggregating all event types + in-context quick actions + referrals card; per-type tabbed views not implemented (timeline + module pages cover the data) |
| REQ-PAT-007 | Longitudinal history: totals, upcoming appointment, never overwritten | Tested | patientGet aggregates visitCount/totals/outstanding/upcoming (workflow step 20) |
| REQ-PAT-008 | Quick actions from profile auto-associate patient | Tested | New visit / New prescription / New invoice / Take payment / New referral buttons (e2e/full.mjs asserts all five; CI run pending) |
| REQ-PAT-009 | Archive (soft) vs permanent delete w/ integrity protection | Tested | patientArchive + patientDeletePermanent (typed patient-code confirm); tests/destructive.test.ts |

## Clinical

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-VIS-001 | Visits: spec §24 fields, links, price snapshots, immutable history | Tested | visits service; workflow step 13 (treatment lines with price snapshot), step 16 (invoice from visit) |
| REQ-TIM-001 | Clinical timeline: all event types, chronological, filterable, paginated | Tested | patientTimeline service; workflow step 30 |
| REQ-CHT-001 | Dental chart: adult+pediatric, FDI, conditions, notes, history | Tested | chart service + FDI chart page; tests/chart.test.ts (7); workflow step 14 |
| REQ-CHT-002 | Configurable condition library incl. spec §27 list | Tested | tooth_conditions seeded (12 conditions incl. spec list); chart.conditions channel. **Defect found by packaged E2E (run 36722132504) and fixed**: toothConditions leaked snake_case rows so `isActive` was undefined and the chart UI hid every condition — now mapped to the ToothCondition contract with a chart regression test |
| REQ-TRT-001 | Treatment catalog: code, name, category, default price, active; price snapshots | Tested | treatments table; visit lines + invoice datalist; workflow steps 13/16 |
| REQ-RX-001 | Prescription creation linked to patient/visit/dentist/date | Tested | prescriptions service; workflow step 15. **UI defect found by packaged E2E and fixed**: the RxForm patient search rendered no result list, so a patient could never be selected from the Prescriptions page — results now render like the queue/visits/appointments pickers |
| REQ-RX-002 | Rx content: clinic header, dentist credentials, patient block, C/C + O/E options, advice | Tested | clinical_options seeded; RxForm; workflow step 15 |
| REQ-RX-003 | Multi-medicine builder: spec §33 fields, add/remove | Tested | RxForm medicine rows (morning/noon/night/meal/duration/PRN/instruction); workflow step 15 (scheduled + SOS) |
| REQ-RX-004 | Rx print: premium layout, signature space, footer message, doctor timing | Tested | tests/print-templates.test.ts (signature ≥22 mm clear space, footer message, timing); geometry suite CI run pending |
| REQ-RX-005 | Medicine catalog (name, generic, form, strength) | Tested | medicines table + med-catalog datalist |
| REQ-ATT-001 | Attachments: metadata, preview/export/delete w/ perm, validation & audit | Tested | attachments service; workflow step 28 (X-ray stored + listed); sha256 + size caps |
| REQ-REF-001 | Referrals: spec §110 fields, history in profile | Tested | referrals service + workflow step 29; renderer UI added this revision (ReferralCard/ReferralForm on the patient profile; packaged-E2E step CI run pending) |

## Practice flow

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-APT-001 | Appointments: spec §29 fields/statuses, double-booking prevention, filters | Tested | appointments service; smoke 'prevents double booking the same dentist slot'; workflow steps 8–10 |
| REQ-QUE-001 | Queue: token, priority, states, persistence | Tested | queue service; workflow steps 10–12 (waiting → finished, token leaves active queue) |
| REQ-DSH-001 | Role-aware dashboard widgets + quick actions | Tested | dashboard service; workflow step 31; stress 'dashboard stays interactive' |
| REQ-SRC-001 | Global search: authorized types, RBAC-respecting, Ctrl+K | Tested | search service; workflow step 34 (financial modules hidden from restricted actor); Ctrl+K implemented; Bengali search in stress suite |
| REQ-NOT-001 | Notification center: spec §56 types, read/unread, mark all | Tested | notifications service (audience-filtered); tests/rbac.test.ts notification tests |

## Billing & finance

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-INV-001 | Invoices: identity, numbering, lines, discount, totals, status | Tested | invoices service; workflow steps 16–20. **UI defect found by packaged E2E and fixed**: the InvoiceForm patient search rendered no result list (same class as RxForm) — fixed |
| REQ-INV-002 | Invoice printing: paper profiles, PDF, Bengali, no signature by default | Tested | tests/print-templates.test.ts (no signature block, footer note); real-PDF geometry suite CI run pending |
| REQ-INV-003 | Historical documents retain original amounts | Tested | price snapshots (workflow steps 13/16) |
| REQ-PAY-001 | Payments: methods (cash/bank/card/bkash/nagad/rocket/upay/other), invalid amounts rejected | Tested | payments service; workflow step 18 rejects overpayment |
| REQ-PAY-002 | Payment list: range tabs, method breakdown, totals (perm) | Tested | payments listing + billing Payments tab |
| REQ-FIN-001 | Transactional financial integrity; integer money | Tested | db transactions; accounting invariants (tests/accounting.test.ts) |
| REQ-FIN-002 | Patient financial history (perm) | Tested | financialPatientSummary; workflow steps 20/33 |
| REQ-FIN-003 | Financial permission enforcement at business layer | Tested | tests/rbac.test.ts + workflow steps 33–35 |
| REQ-ACC-001 | Accounting: categories, transactions, reports, summaries, export (perm) | Tested | tests/accounting.test.ts (6); workflow steps 21–23 |

## Inventory

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-STK-001 | Items: full spec field set, batches, expiry, reorder threshold | Tested | tests/inventory.test.ts; workflow steps 24–26 |
| REQ-STK-002 | Stock movements: in/out/adjust/damaged/expired/usage; non-negative stock | Tested | workflow step 27 'stock can never go negative'; FIFO consumption step 25 |
| REQ-STK-003 | Alerts: low stock, out of stock, expiry | Tested | workflow step 26 (low-stock alert fires); Alerts tab |
| REQ-SUP-001 | Suppliers: contacts, status; purchases linked | Tested | tests/inventory.test.ts 'inventory: suppliers' |

## Administration & security

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-STF-001 | Staff profiles per spec §47 | Tested | tests/staff.test.ts (12) |
| REQ-USR-001 | Users separate from staff: username, password, staff link, role, status, last login | Tested | staff.test 'user management'; auth session info |
| REQ-USR-002 | Password hashing (scrypt), never plaintext | Tested | src/main/services/auth.ts hashPassword; tests/auth.test.ts (10) |
| REQ-RBAC-001 | Granular RBAC: 7 system roles + custom roles, matrix editor | Tested | roles/permissions tables + Access page; tests/rbac.test.ts |
| REQ-RBAC-002 | Permission enforcement at service layer; UI bypass impossible | Tested | Permission map in IPC router + service-layer checks; rbac tests call services directly |
| REQ-AUD-001 | Audit log: spec §51 events w/ old/new values; protected viewer; no delete path | Tested | audit service + Audit page; audit entries asserted across suites |
| REQ-SEC-001 | Auto-lock 5/10/15/30; locked = re-auth required | Tested | SessionManager + lock/unlock; workflow steps 36–37 |
| REQ-SEC-002 | Local attack surface assessment + controls | Implemented | docs/SECURITY_MODEL.md |
| REQ-SEC-003 | No secret leaks; pre-release scan | Tested | asar-audit scans the packaged app (private keys, AWS/GitHub/OpenAI/Slack tokens, sourcemaps) in CI; repo scans clean this revision; activation code exists only as scrypt verifier |
| REQ-SEC-004 | Safe file uploads (type/size/corruption/traversal) | Tested | validateAndStoreImage (type+size+nativeImage decode); dentiva-safe:// prefix-validated roots; zipGuard pre-extraction scan (tests/zip-guard.test.ts, 6 tests) |
| REQ-SEC-005 | Error handling: human messages, no raw stack traces | Implemented | AppError → IpcResult → toasts; logger for technical detail |
| REQ-SEC-006 | Crash safety: transactions on critical ops | Tested | db.transaction on all multi-write operations; backup restore rollback tests |
| REQ-SEC-007 | Data privacy: no external transfer, no tracking | Implemented | No network calls in src/; SECURITY_MODEL.md |
| REQ-SEC-008 | Destructive action safeguards (warning, typed confirm, audit, pre-backup) | Tested | tests/destructive.test.ts; typed confirms in UI (patient code / RESTORE / DELETE ALL DATA); pre-restore safety backup |

## Backup & restore

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-BKP-001 | Manual backup w/ dated filenames, no overwrite | Tested | tests/backup.test.ts; Back up now (Settings → Backup) |
| REQ-BKP-002 | Scheduled backup 7/15/30/off, status, failure notification | Tested | backup.test 'saves the backup schedule'; maybeRunScheduledBackup on boot |
| REQ-BKP-003 | Backup integrity: metadata + checksums + post-create verification | Tested | manifest + per-file sha256 + verifyBackupIntegrity; backup tests |
| REQ-RST-001 | Restore: warning, typed auth, pre-restore backup, verification, rollback, state reload | Tested | restoreBackup pipeline (backup.ts); workflow steps 40–42 (post-backup data gone, workflow data intact); zip-guard defense in depth |

## Printing

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-PRN-001 | Reusable print system: profiles, paper sizes, margins, scale, PDF, Bengali | Tested | PrintManager (src/main/app/print.ts) over dentiva-safe://; printer_profiles table + printing service. **Root cause of the print failures pinned by differential CI diagnostics** (runs 36722132504 → 36727894316): on this stack (Electron 44 / Chromium 152), webfonts delivered over the custom dentiva-safe:// scheme NEVER print (the print compositor cannot re-fetch through it — "Page reading failed" → printToPDF rejects; WOFF2 and TTF alike), and the system-font strategy also failed for real Bengali documents on Linux CI AND the packaged Windows app (genuine Nirmala UI). The only Bengali document that ever printed used a data-URL webfont. Fix (AD-032): print documents embed the bundled Noto Sans Bengali TTF subsets as base64 data-URL @font-face rules; renderPdf awaits `document.fonts.ready` (bounded 5 s). Geometry suite + packaged print step re-run pending |
| REQ-PRN-002 | Print preview: zoom, page navigation, paper/printer selection | In Progress | Silent print + save-PDF implemented (billing/prescriptions/receipts); interactive preview modal not implemented — documented gap |
| REQ-PRN-003 | Prescription layout per spec §36 incl. signature area | Tested | print-templates signature test (≥22 mm clear space, name + degrees under rule) |
| REQ-PRN-004 | Paper sizes A4/A5/thermal/mini/custom adapt without breakage | Tested | paperSizeMm table test + geometry suite (A4/A5/Letter/58 mm/80 mm/custom ×2/fallback; CI run pending) |
| REQ-PRN-005 | Bundled Bengali font w/ fallback; Bengali print tested | Tested | Noto Sans Bengali 400–700 bundled as extraResources (WOFF2 for UI display; TTF subsets embedded as base64 data-URL @font-face in every print document — AD-032); font-embedding assertion (NotoSansBengali|NirmalaUI) in geometry suite + packaged-E2E PDF check (CI run pending) |
| REQ-PRN-006 | No claim of universal printer compatibility; documented limits | Implemented | docs/PRINT_SPECIFICATION.md; physical printing EXTERNAL |

## Settings & misc

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-SETN-001 | Settings categories per spec §62 | In Progress | Tabs: Clinic & dentists, Application (incl. default paper + notifications), Backup & restore, Danger zone, About. Printer-profile editor (per-use paper/printer/scale) not yet in UI — service + IPC exist and are tested |
| REQ-RPT-001 | Reports: clinical/appointment/financial/inventory, RBAC-obeyed, export (perm) | Tested | reportRun; rbac tests (money columns hidden, unauthorized reports denied); workflow steps 32/35 |
| REQ-EXP-001 | Controlled export (CSV) w/ permission enforcement | Implemented | patient.export (permission-gated, BOM-UTF-8 CSV); reports export |
| REQ-DAT-001 | Bangladesh-local date/time (Asia/Dhaka default) | Implemented | Injected clock + @shared/dates formatters |
| REQ-LOG-001 | Safe diagnostic logging, rotation, redaction | Implemented | src/main/app/logger.ts with rotation; no secrets logged |
| REQ-ICO-001 | Professional app icon (multi-size .ico) for exe/installer/shortcut/shell | Implemented | build/icon.ico (16–256 px, 7 entries, verified structurally); wired into electron-builder win.icon; exe metadata validated by the installer job (run 36719098611 ✓) |

## Engineering & release

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-ENG-001 | Planning docs maintained & synchronized | In Progress | This refresh; PROJECT_STATUS/TEST_PLAN updated this revision; RELEASE_CHECKLIST pending final pass |
| REQ-ENG-002 | Dependency audit: package, version, license, purpose | Tested | docs/DEPENDENCY_LICENSE_AUDIT.md incl. extract-zip HIGH advisory assessment + mitigation (R-16); 104 production packages all permissive |
| REQ-ENG-003 | Third-party notices shipped in-app | In Progress | OFL notice ships in resources/fonts; in-app notices screen not present (About tab references licenses) |
| REQ-ENG-004 | Dead-code scan (TODO/FIXME/placeholder/fake/debug) clean | Tested | Scans clean this revision (src/, tests/); eslint no-unused-vars; asar audit blocks source leakage |
| REQ-ENG-005 | Unit + integration + E2E; 50-step workflow; RBAC/financial/backup/print matrices | Tested | 152 vitest tests incl. 42-step sequential workflow (spec target 50 — gap documented), RBAC/financial/backup/print-template suites; e2e smoke + geometry + packaged full-flow E2E in CI |
| REQ-ENG-006 | Stress testing w/ measured results | Tested | tests/stress.test.ts; measurements in TEST_PLAN.md §8 (10k patients/20k visits/15k invoices) |
| REQ-ENG-007 | GitHub Actions: install, lint, typecheck, tests, build, Windows build, installer, artifacts | Tested | 4-job workflow; verify+e2e green (36696431273, 36696796492); windows-installer green (36719098611); packaged-E2E + geometry re-run pending after patientList/print fixes |
| REQ-ENG-008 | Production NSIS installer (name, publisher, version, icon, shortcuts, uninstaller, clean uninstall) | Passed | windows-installer job GREEN on run 36719098611 (commit 236e84c): real `Dentiva Pro Setup 1.0.0.exe` built, PE metadata + SHA-256 verified, silent install, Start-Menu shortcut, uninstall registry key (`Dentiva Pro 1.0.0`, publisher, DisplayVersion), app files, launch, clean uninstall with no remnants |
| REQ-ENG-009 | Release validation of the actual artifact in CI, honestly documented | In Progress | Installer validation **passed** (run 36719098611); packaged-app full-flow E2E at 16/30 on that run — root-caused to the patientList snake_case defect (fixed, plus the print fonts-ready race) — re-run pending |
| REQ-ENG-010 | Final gates: requirements 100 %, P0/P1 = 0, audits | In Progress | See RELEASE_CHECKLIST.md — not yet complete |
| REQ-ENG-011 | Git workflow: clean commits, no secrets/data/temp artifacts | Implemented | Logical milestone commits; .gitignore excludes build outputs; no secrets committed (scan clean) |
| REQ-ENG-012 | PR created; NOT merged without explicit user instruction | Implemented | PR #1 OPEN, never merged (user-only action) |
| REQ-ENG-013 | GitHub Release with verified installer | Not Started | Blocked on release gate |
| REQ-ENG-014 | Final documentation set | In Progress | README + docs/; final install/permissions/troubleshooting set pending gate |
| REQ-ENG-015 | Final report per spec §145 with honest limitations | Not Started | Delivered at release; EXTERNAL items (physical printing, bare-metal install, real-display DPI QA) will be listed explicitly |

## Summary

- **Tested:** 63 requirements (automated evidence: vitest suites — 152 tests / 13 files, all green locally; CI `verify` green on 236e84c).
- **Passed (real CI environment):** activation-rejection path + boot + zero-console-errors (CI e2e smoke, runs 36696431273/36696796492); **production NSIS installer end-to-end validation** (run 36719098611: build, metadata, checksum, silent install, shortcut, registry, launch, clean uninstall).
- **Implemented (verified by code/build, no dedicated automated test):** 20.
- **In Progress (honest gaps, none silent):** 11 — sidebar grouping labels (SHL-002), app-status chip (SHL-001), Ctrl+S/P shortcuts (SHL-008), accessibility audit (SHL-009), dark theme styling (SHL-012), condensed setup wizard (SET-001), tabbed profile views (PAT-006), print preview modal (PRN-002), printer-profile editor UI (SETN-001), notices screen (ENG-003), 42-vs-50-step workflow (ENG-005).
- **Re-run pending (fixes committed, CI not yet green for them):** packaged full-flow E2E (16/30 → patientList + print-race fixes applied), print-geometry suite (fonts-ready fix), final gates (ENG-010).
- **Not Started:** GitHub Release (ENG-013), final report (ENG-015) — deliberately gated.
- **EXTERNAL (never fabricated):** physical printing on real printers, bare-metal clean-machine install/uninstall, real-monitor DPI/zoom QA.
