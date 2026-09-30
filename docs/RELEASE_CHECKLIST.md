# Dentiva Pro — Final Release Checklist (absolute gate)

Every item requires evidence before it is checked. "CI" = GitHub Actions run on this project. Items that cannot be executed in this environment are explicitly marked **EXTERNAL** with the exact remaining step — never silently checked.

## Requirements & traceability
- [ ] REQUIREMENTS_TRACEABILITY.md 100 % mapped, no `Not Started`/`In Progress` items; `Passed` statuses cite evidence
- [ ] No silently omitted or reinterpreted requirement (ambiguities logged in DECISION_LOG)

## Code quality
- [ ] `npm run typecheck` green (local + CI)
- [ ] `npm run lint` green (local + CI)
- [ ] `npm test` green — unit + integration + 50-step workflow (local + CI windows & ubuntu)
- [ ] `npm run build` production build green (CI)
- [ ] Dead-code scan clean (no TODO/FIXME/HACK/placeholder/"Coming Soon"/fake data/debug code)
- [ ] No fake buttons / dead navigation / placeholder screens (functional audit)

## Database
- [ ] Migration runs clean on fresh DB (CI E2E boot)
- [ ] `integrity_check` + `foreign_key_check` pass on stress + backup/restore test DBs
- [ ] Financial invariant tests pass (partial payments, overpay rejection, void consistency)

## Security
- [ ] Secret scan (activation plaintext, passwords, keys, tokens) clean on repo + build artifact
- [ ] RBAC matrix integration tests green (7 roles + custom, service-layer enforcement)
- [ ] Financial leakage tests green (search/reports/dashboard/profile)
- [ ] Audit log verification green
- [ ] Destructive-action safeguard verification green
- [ ] Password hashing verification green

## Features (functional audit per module)
- [ ] Setup wizard + activation · Login/Lock/Auto-lock
- [ ] Dashboard · Patients (list/profile/history/quick actions) · Appointments · Queue
- [ ] Visits · Timeline · Dental chart (adult+pediatric) · Treatments · Prescriptions (multi-medicine) · Attachments · Referrals
- [ ] Invoices · Payments · Financial history · Accounting
- [ ] Inventory (batches, movements, alerts) · Suppliers
- [ ] Staff · Users · Roles & permissions
- [ ] Backup (manual + scheduled + verification) · Restore (pre-restore backup, rollback)
- [ ] Settings (all categories) · Notifications · Global search · Reports · About

## Printing
- [ ] Print geometry tests green (A4/A5/thermal58/thermal80/custom, MediaBox assertions)
- [ ] Bengali text rendering verified in generated PDFs
- [ ] Long-content pagination tests green (medicines, names, addresses, notes, invoice items)
- [ ] Prescription signature area adequate; invoice without signature by default
- [ ] **EXTERNAL**: physical print on clinic printers + Windows print dialog interaction (no hardware in build env)

## UX
- [ ] Every screen inspected (alignment, spacing, contrast, overflow, scroll, focus, states)
- [ ] DPI/zoom matrix verified in E2E (100–200 %)
- [ ] Keyboard shortcuts verified
- [ ] Empty/loading/error states verified

## Build & installation
- [ ] CI Windows NSIS installer build green; artifact exists; SHA-256 checksum published
- [ ] Installer contents: correct name, version, publisher, icon; no dev files/test data/source maps/secrets
- [ ] CI E2E on Windows: app launches from packaged build, activation, setup, login, patient creation, PDF generation
- [ ] **EXTERNAL**: clean bare-metal Windows install, shortcut, uninstall behavior (CI windows-latest is the substitute; bare-hardware validation remains external)

## Release
- [ ] PR opened from `arena/01a0f0fd-dentiva-pro`, **NOT merged** (user-only action)
- [ ] GitHub Release created with verified installer (or `/dist` fallback documented with artifact present)
- [ ] Release notes + final documentation set complete
- [ ] Final report per spec §145 delivered with honest EXTERNAL items

## Sign-off

Release is declared ONLY when all non-EXTERNAL items are checked with evidence. EXTERNAL items are delivered as an explicit handover list.
