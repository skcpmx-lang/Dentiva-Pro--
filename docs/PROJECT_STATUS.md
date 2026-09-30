# Dentiva Pro — Project Status

> **Living document.** Updated at every verified milestone. Never contains unverified claims.
> Status vocabulary: `Not Started` → `In Progress` → `Implemented` → `Tested` → `Passed`

## Current Phase

Phase 3 — Implementation — **Done** (verified below). Phase 4 testing largely done at service level; E2E on real Electron runs on CI (see Blockers).

| Phase | Description | Status |
|---|---|---|
| 0 | Environment & repository setup | Done |
| 1 | Planning & engineering documents | Done (kept synchronized) |
| 2 | Architecture scaffold, toolchain, CI config | Done (CI workflow: typecheck+lint+tests+build, xvfb e2e job) |
| 3 | Implementation: database, services, renderer, printing | Done — trusted main process (25 RBAC-enforcing services, IPC router, print pipeline, secure protocol) + complete 14-page React renderer |
| 4 | Testing: unit, integration, workflow, stress | Done at service level (125 tests incl. 41-step workflow + stress suite); Playwright E2E + Windows installer validation run on CI |
| 5 | Audit & fix cycle | In Progress (lint/typecheck/dead-code scans clean; UI visual QA pending on real display) |
| 6 | Release build (Windows installer via CI) + validation | Not Started (electron-builder 26.15.3 pinned + config ready) |
| 7 | GitHub delivery (PR + Release) | Not Started |

## Completed Work (verified)

- Repository on branch `arena/01a0f0fd-dentiva-pro` (3 implementation commits, pushed).
- Toolchain installed & locked (`package-lock.json`): Electron 44, electron-vite 5, Vite 7, React 19, TypeScript 5.9, better-sqlite3 13, Vitest 5, ESLint 9, electron-builder 26.15.3 (pinned).
- Bengali Unicode font (Noto Sans Bengali, SIL OFL 1.1) bundled in `resources/fonts` (shipped as extraResources by electron-builder) with license notice — guarantees Bengali rendering in UI and print output on any Windows machine.
- Trusted main process: schema v1 migration + seed, 25 services with RBAC enforcement at the service layer, typed IPC router with permission table, print-to-PDF pipeline, `dentiva-safe://` protocol with prefix-validated roots (scheme privilege registered before app ready), scrypt-derived offline activation verifier.
- Complete renderer: 14 pages (auth/setup wizard, dashboard, patients + in-context visit/rx/invoice/payment actions, appointments, queue, visits, FDI dental chart, prescriptions with Bengali dosage editor, billing with thermal receipts, inventory, accounting, reports, notifications, staff, access/roles, audit, settings incl. backup/restore + danger zone), print templates (A5 rx / A4 invoice / 80 mm receipt), zustand store, permission-gated navigation.
- Test suites: smoke, auth, RBAC, accounting, chart, inventory, backup, destructive, **workflow (41 sequential steps through the full business flow)**, **stress (10k patients / 20k visits / 15k invoices — measured results in TEST_PLAN §8)** — 125 tests, all passing.
- Tooling: e2e smoke runner (`e2e/run.mjs`, Playwright-Electron, throwaway userData), GitHub Actions CI (`.github/workflows/ci.yml`), electron-builder config, ESLint flat config (.mjs).

## Current Task

- First CI run on GitHub (typecheck/lint/tests/build + xvfb e2e) once the branch PR is opened.

## Next Tasks

1. CI green on GitHub Actions (ubuntu verify job + xvfb e2e job).
2. Windows NSIS installer built on CI; artifact validation; GitHub Release.
3. Print geometry tests (PDF MediaBox assertions) once an Electron binary is available (CI).
4. Final audits (security, dead-code, dependency/license, UI QA on a real display) and traceability update.

## Failed Tests / Unresolved Issues

- None currently recorded. (This section must never be silently emptied — entries are only removed when fixed and re-tested.)

## Blockers

- None. Known environmental constraints (documented honestly, not blockers to implementation):
  - No physical Windows machine or printer in the build sandbox. Windows-specific validation (installer execution, physical printing, DPI on real monitors, clean-machine install/uninstall) is performed on GitHub Actions `windows-latest` runners where possible and the remainder is listed as externally-required validation in `RELEASE_CHECKLIST.md` / final report. No results are fabricated.
  - The build sandbox cannot run the Electron app or download its binary (GitHub release-asset hosts and Debian mirrors are network-blocked; no X server). Consequences, all handled: `npm run e2e` is executed on CI under xvfb; local verification in the sandbox covers typecheck, lint, unit/integration/workflow/stress tests, and `electron-vite build`.

## Last Verified Commit

- (updated at delivery — see git log; CI runs are the verification evidence)

## Build Status

All green in the build sandbox (last verified 2026-09-30, commit in git log):

- `npm run typecheck` (tsconfig.node + tsconfig.web): clean.
- `npm run lint` (ESLint 9 flat config): clean.
- `npm test` (Vitest): **125/125 passing** across 11 files.
- `npm run build` (electron-vite production build): succeeds (main 309 kB, renderer 1.1 MB / 1,938 modules).
- `npm run dist` (electron-builder NSIS x64): configured, not yet executed here (runs on CI/Windows).

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
