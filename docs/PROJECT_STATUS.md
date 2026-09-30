# Dentiva Pro — Project Status

> **Living document.** Updated at every verified milestone. Never contains unverified claims.
> Status vocabulary: `Not Started` → `In Progress` → `Implemented` → `Tested` → `Passed`

## Current Phase

Phase 4/5 — testing & audit-fix cycle. Service-level suite fully green (151 tests); CI `verify` green and **windows-installer job GREEN on 236e84c (run 36719098611 — full installer end-to-end validation passed)**. Packaged full-flow E2E reached 16/30 and exposed a real product defect (patientList snake_case leak — fixed); print-geometry failure root-caused to a printToPDF/web-font race (fixed). Fixes committed locally, CI re-run pending.

| Phase | Description | Status |
|---|---|---|
| 0 | Environment & repository setup | Done |
| 1 | Planning & engineering documents | Done (kept synchronized) |
| 2 | Architecture scaffold, toolchain, CI config | Done (4-job CI workflow: verify, e2e, windows-installer, windows-packaged-e2e) |
| 3 | Implementation: database, services, renderer, printing | Done — trusted main process (25 RBAC-enforcing services, typed IPC router, print pipeline, secure protocol, zip-guard) + complete renderer incl. sidebar collapse/shortcuts, referral UI, About tab |
| 4 | Testing: unit, integration, workflow, stress, E2E | Service level done — **151 tests / 13 files** (42-step workflow, stress 10k/20k/15k, zip-guard, patientList row-shape regression); CI e2e smoke green (36696431273, 36696796492); installer validation green (36719098611); packaged E2E 16/30 + geometry ✗ → both root-caused, fixes pending CI |
| 5 | Audit & fix cycle | In Progress — lint/typecheck/dead-code/secret scans clean; npm audit: 1 high (extract-zip) documented + mitigated (R-16, zipGuard, yauzl pinned); UI visual QA on real display EXTERNAL |
| 6 | Release build (Windows installer via CI) + validation | Installer validation **passed** (236e84c, run 36719098611); packaged-app E2E re-run pending |
| 7 | GitHub delivery (PR + Release) | PR #1 open (never merged — release gate not passed); GitHub Release pending |

## Completed Work (verified)

- Branch `arena/01a0f0fd-dentiva-pro`, head `236e84c` (pushed): implementation + zip-guard security hardening + CI/e2e/installer-validator fixes.
- Toolchain installed & locked: Electron 44, electron-vite 5, React 19, TypeScript 5.9, better-sqlite3 13, Vitest 5, ESLint 9, electron-builder 26.15.3 (pinned), yauzl 2.10.0 (pinned exact).
- Bengali Unicode font (Noto Sans Bengali, SIL OFL 1.1) bundled as extraResources with license notice.
- Trusted main process: schema v1 migration + seed, 25 services w/ service-layer RBAC, typed IPC router w/ permission table, print-to-PDF pipeline, `dentiva-safe://` prefix-validated protocol, scrypt activation verifier, zipGuard pre-extraction scan on both backup-restore extract sites.
- Complete renderer: 14+ pages, print templates (A5 rx / A4 invoice / 80 mm receipt), collapsible sidebar + keyboard shortcuts (Ctrl+K/N/1–9, Alt+←/→), patient referrals UI, About tab.
- Test suites: smoke 18, auth 10, rbac 9, staff 12, accounting 6, chart 7, inventory 8, backup 7, destructive 3, workflow 42 steps, stress 6, print-templates 18, zip-guard 6 = **151 tests / 13 files, all passing**.
- E2E tooling: `e2e/run.mjs` (Playwright-Electron smoke), `e2e/print-geometry.mjs` (real PDF MediaBox/geometry assertions, crash-resilient JSONL case log), `e2e/full.mjs` (28-step packaged-app flow w/ per-step page diagnostics + modal recovery), `e2e/asar-audit.mjs` (packaged secret/sourcemap scan), `.github/scripts/validate-installer.ps1` (registry/shortcut/launch/uninstall validation against real NSIS defaults).
- CI: 4 jobs; PR diagnostic comments on failure (400-line tails) since Actions blob storage is unreachable from the sandbox.

## Current Task

1. Push the patientList + print-fonts fixes; watch the next CI run (verify + e2e geometry + windows-packaged-e2e must all go green).

## Next Tasks

1. If packaged E2E still fails on any step: read the PR diagnostic comment (400-line tail + per-step page diagnostics), root-cause, fix, push — repeat until green.
2. Final audits (P5): remaining dead-code/secret re-scans after final fixes; UI visual QA on real display stays EXTERNAL.
3. P7 docs: RELEASE_CHECKLIST final pass, final README/docs set.
4. P8 release gate; P10 final report (honest limitations: physical printing, bare-metal install, real-display DPI all EXTERNAL).

## Failed Tests / Unresolved Issues

- **36719098611 (236e84c) — two jobs failed; both root-caused and fixed (fixes not yet CI-verified):**
  - *windows-packaged-e2e: 16/30.* Dominant cause: `patientList` returned raw snake_case rows (`full_name`, `patient_code`) while the UI renders camelCase — every patients-list column and every patient-picker button rendered **blank**, so all name-based lookups timed out (create→profile navigation and the preselected-patient visit form were secondary test bugs). FIXED: service maps rows to the `PatientListRow` contract (+ regression tests: row shape, no snake_case leak, `sort: 'lastVisit'` SQL crash, `status: 'all'`); test steps now follow the app's real post-create navigation and preselected visit form. This was a REAL product defect found by E2E, not a test artifact.
  - *e2e (ubuntu): smoke ✓; geometry ✗.* `printToPDF` rejected with "Printing failed" (`print_compositor_impl.cc:405 CompositePages: Page reading failed`), then a follow-on load ERR_FAILED and SIGTRAP. Root cause: printToPDF raced the eight async `@font-face` loads over `dentiva-safe://fonts` — did-finish-load does not wait for web fonts, and printing mid-font-load breaks the compositor's Skia deserialization (Puppeteer fixed the identical race by awaiting `document.fonts.ready` before Page.printToPDF). FIXED: `PrintManager.renderPdf` awaits `document.fonts.ready` (bounded 5 s). The earlier 24-bit-xvfb theory was insufficient — the depth/GPU flags stay (correct for readback) but were not the root cause.
- **windows-installer job: PASSED on 236e84c** — the DisplayName validator fix is confirmed (registry "Dentiva Pro 1.0.0", shortcut, launch, uninstall all validated).
- Resolved earlier (history): 36702956138 — installer DisplayName validator bug; packaged-E2E modal cascade (9/30); geometry "needs 24-bit xvfb" (partially right, insufficient).

## Blockers

- None beyond the open failure above. Known environmental constraints (documented, not fabricated):
  - No physical Windows machine/printer in the sandbox; Windows validation runs on `windows-latest` CI runners; physical printing, bare-metal clean-machine install, and real-monitor DPI QA are EXTERNAL items listed in RELEASE_CHECKLIST.md.
  - Sandbox cannot run Electron or reach Actions log/blob storage; failure logs are posted to PR #1 as comments by the workflow.

## Last Verified Commit

- `236e84c` (pushed): verify ✓, windows-installer ✓ (full installer validation), packaged-E2E 16/30, e2e geometry ✗ — all failures root-caused; fixes for the two failures sit locally on top of 236e84c (patientList mapping + regression tests, print fonts-ready wait, full.mjs create/visit steps), pending push + CI.
- Local gate on the pending fixes: typecheck ✓ lint ✓ **151/151 tests** ✓ build ✓ full.mjs `node --check` ✓.
- Previous full green: `ff258bd` / run 36696431273 (verify + e2e smoke, before Windows jobs existed).

## Build Status

Sandbox-local gate on 236e84c (all green, verified 2026-09-30):

- `npm run typecheck`: clean. `npm run lint`: clean.
- `npm test`: **151/151 across 13 files**.
- `npm run build`: succeeds.
- `npm run dist`: not runnable in sandbox (no Windows/electron-builder targets here); performed on CI `windows-installer` job.
- GitHub Actions (run 36719098611, commit 236e84c): verify ✓, windows-installer ✓, e2e ✗ (geometry — fonts race, fixed locally), windows-packaged-e2e ✗ (16/30 — patientList defect, fixed locally). Next run must confirm all four green.

## Release Status

- **Not released.** Release gate (RELEASE_CHECKLIST.md) not passed; extract-zip HIGH advisory remains documented-and-mitigated (R-16), not upgradeable (no upstream fix).

## Document Index

| Document | Purpose |
|---|---|
| `docs/REQUIREMENTS_TRACEABILITY.md` | Every requirement → implementation → verification status (refreshed at 236e84c) |
| `docs/ARCHITECTURE.md` | System architecture & stack decision |
| `docs/DATABASE_DESIGN.md` | ER design, integrity rules, money/timestamp strategy |
| `docs/UI_UX_SPECIFICATION.md` | Design system & screen inventory |
| `docs/SECURITY_MODEL.md` | Threat model & controls |
| `docs/RBAC_MATRIX.md` | Permissions, default roles, enforcement points |
| `docs/PRINT_SPECIFICATION.md` | Print pipeline, paper profiles, document layouts |
| `docs/TEST_PLAN.md` | Test layers & matrices, environment limits |
| `docs/RELEASE_CHECKLIST.md` | Final release gate |
| `docs/DECISION_LOG.md` | Architecture & product decisions with rationale |
| `docs/RISK_REGISTER.md` | Risks & mitigations (incl. R-16 extract-zip) |
| `docs/DEPENDENCY_LICENSE_AUDIT.md` | Third-party license audit incl. advisory assessment |
