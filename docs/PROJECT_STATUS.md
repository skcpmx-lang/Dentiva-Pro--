# Dentiva Pro — Project Status

> **Living document.** Updated at every verified milestone. Never contains unverified claims.
> Status vocabulary: `Not Started` → `In Progress` → `Implemented` → `Tested` → `Passed`

## Current Phase

Phase 4/5 — testing & audit-fix cycle. Service-level suite fully green (152 tests); CI `verify` green and **windows-installer job GREEN on 236e84c (run 36719098611 — full installer end-to-end validation passed)**. Packaged full-flow E2E reached 16/30 and exposed a real product defect (patientList snake_case leak — fixed); print-geometry failure root-caused to a printToPDF/web-font race (fixed). Fixes committed locally, CI re-run pending.

| Phase | Description | Status |
|---|---|---|
| 0 | Environment & repository setup | Done |
| 1 | Planning & engineering documents | Done (kept synchronized) |
| 2 | Architecture scaffold, toolchain, CI config | Done (4-job CI workflow: verify, e2e, windows-installer, windows-packaged-e2e) |
| 3 | Implementation: database, services, renderer, printing | Done — trusted main process (25 RBAC-enforcing services, typed IPC router, print pipeline, secure protocol, zip-guard) + complete renderer incl. sidebar collapse/shortcuts, referral UI, About tab |
| 4 | Testing: unit, integration, workflow, stress, E2E | Service level done — **152 tests / 13 files** (42-step workflow, stress 10k/20k/15k, zip-guard, patientList + toothConditions row-shape regressions); CI e2e smoke green (36696431273, 36696796492); installer validation green (36719098611); packaged E2E 16/30 + geometry ✗ → both root-caused, fixes pending CI |
| 5 | Audit & fix cycle | In Progress — lint/typecheck/dead-code/secret scans clean; npm audit: 1 high (extract-zip) documented + mitigated (R-16, zipGuard, yauzl pinned); UI visual QA on real display EXTERNAL |
| 6 | Release build (Windows installer via CI) + validation | Installer validation **passed** (236e84c, run 36719098611); packaged-app E2E re-run pending |
| 7 | GitHub delivery (PR + Release) | PR #1 open (never merged — release gate not passed); GitHub Release pending |

## Completed Work (verified)

- Branch `arena/01a0f0fd-dentiva-pro`, head `236e84c` (pushed): implementation + zip-guard security hardening + CI/e2e/installer-validator fixes.
- Toolchain installed & locked: Electron 44, electron-vite 5, React 19, TypeScript 5.9, better-sqlite3 13, Vitest 5, ESLint 9, electron-builder 26.15.3 (pinned), yauzl 2.10.0 (pinned exact).
- Bengali Unicode font (Noto Sans Bengali, SIL OFL 1.1) bundled as extraResources with license notice.
- Trusted main process: schema v1 migration + seed, 25 services w/ service-layer RBAC, typed IPC router w/ permission table, print-to-PDF pipeline, `dentiva-safe://` prefix-validated protocol, scrypt activation verifier, zipGuard pre-extraction scan on both backup-restore extract sites.
- Complete renderer: 14+ pages, print templates (A5 rx / A4 invoice / 80 mm receipt), collapsible sidebar + keyboard shortcuts (Ctrl+K/N/1–9, Alt+←/→), patient referrals UI, About tab.
- Test suites: smoke 18, auth 10, rbac 9, staff 12, accounting 6, chart 8, inventory 8, backup 7, destructive 3, workflow 42 steps, stress 6, print-templates 18, zip-guard 6 = **152 tests / 13 files, all passing**.
- E2E tooling: `e2e/run.mjs` (Playwright-Electron smoke), `e2e/print-geometry.mjs` (real PDF MediaBox/geometry assertions, crash-resilient JSONL case log), `e2e/full.mjs` (28-step packaged-app flow w/ per-step page diagnostics + modal recovery), `e2e/asar-audit.mjs` (packaged secret/sourcemap scan), `.github/scripts/validate-installer.ps1` (registry/shortcut/launch/uninstall validation against real NSIS defaults).
- CI: 4 jobs; PR diagnostic comments on failure (400-line tails) since Actions blob storage is unreachable from the sandbox.

## Current Task

1. CI run 36727894316 (8691030) FALSIFIED the round-4 system-font hypothesis: system-font Bengali templates still fail (geometry 11/29, packaged 29/30 — same single print step), while that run's data-URL-webfont diagnostic page became the ONLY Bengali document ever printed on this stack. Round-5 fix committed: print documents embed fonts as base64 DATA-URL @font-face rules (AD-032) + full attribution probe matrix (P1–P11) + Windows error-toast capture in the packaged print step — push and watch the next run.

## Next Tasks

1. If packaged E2E still fails on any step: read the PR diagnostic comment (400-line tail + per-step page diagnostics), root-cause, fix, push — repeat until green.
2. Final audits (P5): remaining dead-code/secret re-scans after final fixes; UI visual QA on real display stays EXTERNAL.
3. P7 docs: RELEASE_CHECKLIST final pass, final README/docs set.
4. P8 release gate; P10 final report (honest limitations: physical printing, bare-metal install, real-display DPI all EXTERNAL).

## Failed Tests / Unresolved Issues

- **36727894316 (8691030): verify ✓, windows-installer ✓, packaged E2E 29/30, e2e geometry 11/29. Round-5 root cause + fix (not yet CI-verified):**
  - System-font strategy falsified — real templates with NO webfonts still failed on both platforms; the run's mixed-page diagnostic (data-URL webfont + system-font paragraphs) printed, the ONLY Bengali print success on this stack. Differential verdict refined: protocol-delivered webfonts never print (compositor cannot re-fetch through the custom scheme); system Bengali fonts failed too; data-URL webfonts print.
  - FIX (AD-032): PrintManager inlines the bundled Noto Sans Bengali TTF subsets as base64 data-URL @font-face rules (unicode-ranged, ~700KB under the 2MB cap). Attribution probes P1–P11 added to the geometry suite as informational cases (font-resolution canvas report, content/timing/option matrix, run-36727894316 repro). Packaged E2E print step now captures the app's error toast for a Windows-side signature.
- **36726128680 (2baf949): verify ✓, windows-installer ✓, packaged E2E 29/30, e2e geometry 10/28 (TTF did not fix webfont printing). Round-4 root cause + fix (confirmed falsified by 36727894316):**
  - TTF webfonts fail identically → the failure is webfont-per-se in Electron 44 (Chromium 152), not the format or the custom protocol. The packaged Windows app's invoice print (the only remaining packaged step failure) matches the same root cause cross-platform.
  - FIX (AD-031): print documents use SYSTEM fonts (Noto Sans Bengali → Windows' Nirmala UI → sans-serif); the UI keeps bundled WOFF2. Geometry driver installs the bundled Noto TTF as a system font on Linux CI; embedded-font assertions accept NotoSansBengali|NirmalaUI. Informational probe added for data-URL webfont printing.
- **36723879956 (c1c1bf1): verify ✓, windows-installer ✓, packaged E2E 26/30, e2e geometry 10/28. Round-3 root causes, all fixed (confirmed by 36726128680: 29/30):**
  - *Geometry differential diagnostics pinned the print failure:* a page with NO webfonts prints fine (✔ minimal case), the dentiva-safe:// font fetch returns 200 (✔ Buffer protocol fix also eliminated the SIGTRAP/ERR_FAILED crash — all 28 cases now run), but **any page that uses a WOFF2-sourced webfont fails in the print compositor** ("Page reading failed" → printToPDF rejects). The packaged Windows app's invoice-print step (no PDF in temp dir after clicking Print) is consistent with the same root cause cross-platform. FIX: print documents now reference losslessly-converted TTF builds of the same bundled Noto Sans Bengali subsets (`format('truetype')`); UI keeps WOFF2. Provenance + rationale recorded in PRINT_SPECIFICATION.md.
  - *Packaged E2E 26/30 — remaining 4 were one real print defect + three assertion mismatches (fixed):* visit treatment line is asserted on the Visits list (Treatments column); chart note field is an input with a placeholder (not a textarea); prescriptions list shows "1 item" not medicine names (assert the RX row instead). invoices ✓ payments ✓ invoice-void ✓ queue ✓ referrals ✓ appointments ✓ restore ✓ destructive ✓ all pass.
- **36722132504 (32a43ca): verify ✓, windows-installer ✓, packaged E2E 23/30, e2e geometry ✗ (same signature). Round-2 root causes, all fixed (confirmed by 36723879956):**
  - *packaged E2E 23/30.* The patientList fix unblocked queue/referrals/appointments/restore/global-search/destructive steps. Remaining failures root-caused to three REAL defects + one test bug, all fixed:
    1. `toothConditions` leaked snake_case rows (`is_active` etc.) — the chart UI filters on `isActive`, so the condition dropdown showed only "Sound / clear". Mapped to the ToothCondition contract + chart regression test.
    2. **RxForm and InvoiceForm patient pickers rendered NO result list** — the search input existed but results were never rendered, so prescriptions/invoices could not be created from those pages at all. Both now render result buttons (same pattern as the working queue/visits/appointments pickers).
    3. Test bug: the visit form starts with zero treatment lines — the step now clicks "Add treatment" first.
    (payments/print/invoice-void steps were cascade failures — no invoice existed.)
  - *e2e geometry:* same "CompositePages: Page reading failed" on the A4 case plus A5 loadURL ERR_FAILED and SIGTRAP; the fonts-ready wait did not change it. New hardening + differential diagnostics: (a) `dentiva-safe://` handler now returns documented Buffer bodies instead of a Node fs stream cast to ReadableStream (undefined behavior — plausible cause of the intermittent ERR_FAILED load and broken font subresource fetches); (b) harness: `--disable-gpu`/disableHardwareAcceleration removed (both prior runs were software-rendered and still failed; defaults kept), `--disable-dev-shm-usage` added (Linux print-compositor shm defense); (c) two diagnostic cases run FIRST — a minimal no-webfont print and a font-pipeline diagnostics case (fetch status, FontFace load results, then printToPDF of the same page) — so the next log pinpoints environment vs content regardless of outcome.
- **36719098611 (236e84c) — round-1 root causes (all fixed in 32a43ca):**
  - *windows-packaged-e2e: 16/30.* Dominant cause: `patientList` returned raw snake_case rows (`full_name`, `patient_code`) while the UI renders camelCase — every patients-list column and every patient-picker button rendered **blank**, so all name-based lookups timed out (create→profile navigation and the preselected-patient visit form were secondary test bugs). FIXED: service maps rows to the `PatientListRow` contract (+ regression tests: row shape, no snake_case leak, `sort: 'lastVisit'` SQL crash, `status: 'all'`); test steps now follow the app's real post-create navigation and preselected visit form. This was a REAL product defect found by E2E, not a test artifact.
  - *e2e (ubuntu): smoke ✓; geometry ✗.* `printToPDF` rejected with "Printing failed" (`print_compositor_impl.cc:405 CompositePages: Page reading failed`), then a follow-on load ERR_FAILED and SIGTRAP. Root cause: printToPDF raced the eight async `@font-face` loads over `dentiva-safe://fonts` — did-finish-load does not wait for web fonts, and printing mid-font-load breaks the compositor's Skia deserialization (Puppeteer fixed the identical race by awaiting `document.fonts.ready` before Page.printToPDF). FIXED: `PrintManager.renderPdf` awaits `document.fonts.ready` (bounded 5 s). The earlier 24-bit-xvfb theory was insufficient — the depth/GPU flags stay (correct for readback) but were not the root cause.
- **windows-installer job: PASSED on 236e84c and again on 32a43ca** — the DisplayName validator fix is confirmed (registry "Dentiva Pro 1.0.0", shortcut, launch, uninstall all validated).
- Resolved earlier (history): 36702956138 — installer DisplayName validator bug; packaged-E2E modal cascade (9/30); geometry "needs 24-bit xvfb" (partially right, insufficient).

## Blockers

- None beyond the open failure above. Known environmental constraints (documented, not fabricated):
  - No physical Windows machine/printer in the sandbox; Windows validation runs on `windows-latest` CI runners; physical printing, bare-metal clean-machine install, and real-monitor DPI QA are EXTERNAL items listed in RELEASE_CHECKLIST.md.
  - Sandbox cannot run Electron or reach Actions log/blob storage; failure logs are posted to PR #1 as comments by the workflow.

## Last Verified Commit

- `8691030` (pushed): verify ✓, windows-installer ✓, packaged-E2E 29/30, geometry 11/29 (system-font strategy falsified; data-URL diagnostic printed). Round-5 fix (data-URL embedded fonts, AD-032 + probe matrix) sits locally on top, pending push + CI.
- Local gate on the round-5 fix: typecheck ✓ lint ✓ **152/152 tests** ✓ build ✓ geometry bundle esbuild ✓.
- Previous full green: `ff258bd` / run 36696431273 (verify + e2e smoke, before Windows jobs existed).

## Build Status

Sandbox-local gate on 236e84c (all green, verified 2026-09-30):

- `npm run typecheck`: clean. `npm run lint`: clean.
- `npm test`: **152/152 across 13 files**.
- `npm run build`: succeeds.
- `npm run dist`: not runnable in sandbox (no Windows/electron-builder targets here); performed on CI `windows-installer` job.
- GitHub Actions: 36719098611 → 36727894316 (five runs): verify ✓ and windows-installer ✓ every time; packaged E2E 16/30 → 23/30 → 26/30 → 29/30 → **29/30**; e2e geometry 16→10→10→11/29 — the print pipeline defect is differentially attributed (protocol webfonts never print; system Bengali fonts failed; data-URL webfonts print) and the AD-032 fix is pending CI. Next run must confirm all four green.

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
