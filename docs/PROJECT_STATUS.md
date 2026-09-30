# Dentiva Pro — Project Status

> **Living document.** Updated at every verified milestone. Never contains unverified claims.
> Status vocabulary: `Not Started` → `In Progress` → `Implemented` → `Tested` → `Passed`

## Current Phase

Phase 3 — Implementation — **Done**. Phase 4 testing: service level + CI E2E smoke **green** (PR #1, Actions run 36696431273); print-geometry and Windows-installer validation still pending (see Blockers / Next Tasks).

| Phase | Description | Status |
|---|---|---|
| 0 | Environment & repository setup | Done |
| 1 | Planning & engineering documents | Done (kept synchronized) |
| 2 | Architecture scaffold, toolchain, CI config | Done (CI workflow: typecheck+lint+tests+build, xvfb e2e job) |
| 3 | Implementation: database, services, renderer, printing | Done — trusted main process (25 RBAC-enforcing services, IPC router, print pipeline, secure protocol) + complete 14-page React renderer |
| 4 | Testing: unit, integration, workflow, stress | Service level done (125 tests incl. 41-step workflow + stress suite); **Playwright E2E smoke passed on CI** (real Electron 44 under xvfb: boot → activation step → bad code rejected → zero console errors); print-geometry + Windows installer validation pending |
| 5 | Audit & fix cycle | In Progress (lint/typecheck/dead-code scans clean; UI visual QA pending on real display) |
| 6 | Release build (Windows installer via CI) + validation | Not Started (electron-builder 26.15.3 pinned + config ready) |
| 7 | GitHub delivery (PR + Release) | PR #1 open (not merged — release gate not passed); GitHub Release pending |

## Completed Work (verified)

- Repository on branch `arena/01a0f0fd-dentiva-pro` (3 implementation commits, pushed).
- Toolchain installed & locked (`package-lock.json`): Electron 44, electron-vite 5, Vite 7, React 19, TypeScript 5.9, better-sqlite3 13, Vitest 5, ESLint 9, electron-builder 26.15.3 (pinned).
- Bengali Unicode font (Noto Sans Bengali, SIL OFL 1.1) bundled in `resources/fonts` (shipped as extraResources by electron-builder) with license notice — guarantees Bengali rendering in UI and print output on any Windows machine.
- Trusted main process: schema v1 migration + seed, 25 services with RBAC enforcement at the service layer, typed IPC router with permission table, print-to-PDF pipeline, `dentiva-safe://` protocol with prefix-validated roots (scheme privilege registered before app ready), scrypt-derived offline activation verifier.
- Complete renderer: 14 pages (auth/setup wizard, dashboard, patients + in-context visit/rx/invoice/payment actions, appointments, queue, visits, FDI dental chart, prescriptions with Bengali dosage editor, billing with thermal receipts, inventory, accounting, reports, notifications, staff, access/roles, audit, settings incl. backup/restore + danger zone), print templates (A5 rx / A4 invoice / 80 mm receipt), zustand store, permission-gated navigation.
- Test suites: smoke, auth, RBAC, accounting, chart, inventory, backup, destructive, **workflow (41 sequential steps through the full business flow)**, **stress (10k patients / 20k visits / 15k invoices — measured results in TEST_PLAN §8)** — 125 tests, all passing.
- Tooling: e2e smoke runner (`e2e/run.mjs`, Playwright-Electron, throwaway userData), GitHub Actions CI (`.github/workflows/ci.yml`), electron-builder config, ESLint flat config (.mjs).

## Current Task

- Windows NSIS installer job on CI (`npm run dist`, electron-builder) + artifact validation.

## Next Tasks

1. Windows NSIS installer built on CI; artifact validation; GitHub Release.
2. Print geometry tests (PDF MediaBox assertions for A4/A5/thermal-80) — runnable on CI where the Electron binary exists.
3. Final audits (security, dead-code, dependency/license, UI QA on a real display) and traceability update (REQUIREMENTS_TRACEABILITY.md per-row statuses are still pre-implementation).

## Failed Tests / Unresolved Issues

- None currently recorded. (This section must never be silently emptied — entries are only removed when fixed and re-tested.)

## Blockers

- None. Known environmental constraints (documented honestly, not blockers to implementation):
  - No physical Windows machine or printer in the build sandbox. Windows-specific validation (installer execution, physical printing, DPI on real monitors, clean-machine install/uninstall) is performed on GitHub Actions `windows-latest` runners where possible and the remainder is listed as externally-required validation in `RELEASE_CHECKLIST.md` / final report. No results are fabricated.
  - The build sandbox cannot run the Electron app or download its binary (GitHub release-asset hosts and Debian mirrors are network-blocked; no X server; Actions log/blob storage also unreachable, so the CI workflow posts e2e failure logs to the PR as comments). Consequences, all handled: `npm run e2e` runs on CI under xvfb — **first real run passed** (run 36696431273, two e2e-script bugs found and fixed on the branch: see commits `67b445f`, `ff258bd`); sandbox-local verification covers typecheck, lint, unit/integration/workflow/stress tests, and `electron-vite build`.

## Last Verified Commit

- `ff258bd` — PR #1, Actions run [36696431273](https://github.com/skcpmx-lang/Dentiva-Pro--/actions/runs/36696431273): both CI jobs green (verify: typecheck/lint/125 tests/build; e2e: real Electron under xvfb).

## Build Status

All green in the build sandbox (last verified 2026-09-30, commit in git log):

- `npm run typecheck` (tsconfig.node + tsconfig.web): clean.
- `npm run lint` (ESLint 9 flat config): clean.
- `npm test` (Vitest): **125/125 passing** across 11 files.
- `npm run build` (electron-vite production build): succeeds (main 309 kB, renderer 1.1 MB / 1,938 modules).
- `npm run dist` (electron-builder NSIS x64): configured, not yet executed (no Windows packaging job yet).
- GitHub Actions CI (PR #1): both jobs green on `ff258bd` (run 36696431273).

## Release Status

- **Not released.** Release gate (`RELEASE_CHECKLIST.md`) has not been passed yet.

## Document Index

| Document | Purpose |
|---|---|
| `docs/REQUIREMENTS_TRACEABILITY.md` | Every requirement → implementation → verification status |
| `docs/ARCHITECTURE.md` | System architecture & stack decision |
| `docs/DATABASE_DESIGN.md` | ER design, integrity rules, money/timestamp strategy |
| `docs/UI_UX_SPECIFICATION.md` | Design system & screen inventory |
| `docs/SECURITY_MODEL.md` | Threat model & controls |
| `docs/RBAC_MATRIX.md` | Permissions, default roles, enforcement points |
| `docs/PRINT_SPECIFICATION.md` | Print pipeline, paper profiles, document layouts |
| `docs/TEST_PLAN.md` | Test layers & matrices, environment limits |
| `docs/RELEASE_CHECKLIST.md` | Final release gate |
| `docs/DECISION_LOG.md` | Architecture & product decisions with rationale |
| `docs/RISK_REGISTER.md` | Risks & mitigations |
| `docs/DEPENDENCY_LICENSE_AUDIT.md` | Third-party license audit |
