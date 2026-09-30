# Dentiva Pro — Test Plan

## 1. Layers & Environments

| Layer | Tool | Where it runs | What it proves |
|---|---|---|---|
| Unit | Vitest | Linux sandbox + CI (ubuntu + windows) | money math, date logic, validators, activation verifier, permission matrices, numbering, formatters, queue/appointment state logic |
| Integration | Vitest (real SQLite in temp dirs, real filesystem) | Linux sandbox + CI (ubuntu + windows) | every service: CRUD + RBAC allow/deny at service layer, transactional financial integrity (partial payments, overpay rejection, voids), invoice/payment invariants, inventory stock math + non-negative enforcement, backup create/verify/restore incl. corrupted/invalid backups and pre-restore backup, audit trail presence, migration integrity, search RBAC filtering |
| Workflow (50-step) | Vitest integration driving the service layer end-to-end | Linux sandbox + CI | the spec §84 business flow from activation → setup → patient → appointment → queue → visit → chart → treatment → prescription → invoice → payments → financial history → inventory → accounting → attachments → referrals → timeline → backup → restore → lock/unlock → logout/login → permission verification (install/uninstall/print-hardware steps covered by CI/E2E + documented externals) |
| E2E smoke | Playwright-core driving the real Electron app | CI windows-latest (+ local headless if X available) | app boots, setup wizard works, activation works, login, patient creation, navigation, print PDF generation — on genuine Windows |
| Build/Installer | electron-builder on CI windows-latest | CI | production NSIS installer builds, artifact exists + checksum |
| Print geometry | Vitest (parse produced PDF MediaBox) | Linux + CI | A4/A5/thermal58/80/custom PDF page sizes exact; multi-page pagination; no zero-length output |
| Stress | scripted dataset generator + Vitest | Linux sandbox (measured, recorded below) | performance at 10k+ patients / 20k+ visits / 15k+ invoices / payments / attachments list & search & profile & backup timings |

## 2. RBAC Test Matrix (spec §85–86)

For each system role (Owner, Administrator, Dentist, Receptionist, Assistant, Accountant, Inventory Staff, plus a custom restricted role): representative allowed actions succeed; forbidden actions fail with `ERR_PERMISSION` **when invoked directly at the service/router layer**; forbidden data absent from global search, reports, dashboards, patient-profile financial blocks; export routes denied; invoice/payment modification and deletion denied per matrix.

## 3. Financial Security Tests (spec §86)

Unauthorized: payment view/edit/void/delete, accounting access, financial dashboard, patient financial summary, financial search results, financial exports — each asserted denied/absent for Receptionist/Assistant/Dentist/Inventory roles at the data layer.

## 4. Backup/Restore Test Matrix (spec §87)

Empty DB backup · normal · large (stress DB) · multiple · corrupted zip · tampered manifest/hash mismatch · restore happy path · pre-restore backup created · restore of invalid backup rejected without touching live data · restore failure rollback · post-restore integrity (`integrity_check`, `foreign_key_check`, schema version) · data verification after restore.

## 5. Print Test Matrix (spec §88)

A4 · A5 · thermal 80 · thermal 58 · custom paper · long medicine list (pagination) · long patient name · long Bengali text (shaping) · long address · multiple findings · many invoice items · long notes · large logo · no logo · PDF page geometry assertions · scale factor. Physical printer output & Windows print dialog interaction: **externally required** (no printer hardware / no interactive Windows session in build environment) — documented, not fabricated.

## 6. UI Visual QA (spec §89)

Every screen manually inspected in the dev sandbox at 1280×720 / 1920×1080 (light+dark, comfortable+compact) for alignment, spacing, contrast, focus, overflow, scroll reachability, empty/loading/error states. Automated supplement: E2E screenshots on Windows CI. DPI 125–200 % via Chromium zoomFactor matrix in E2E.

## 7. Honest Environment Limitations (spec §124–125, §135)

Cannot be performed in this environment and therefore **not claimed**: physical printing on real printers, real multi-monitor DPI, clean-machine installer run on bare Windows hardware (CI windows-latest is the closest substitute and is used), uninstall on end-user hardware. Each is listed in `RELEASE_CHECKLIST.md` with the exact remaining external validation step.

## 8. Stress Results (filled from actual measured runs — see `tests/stress` output recorded in TEST_REPORT section of final delivery)
