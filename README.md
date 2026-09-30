# Dentiva Pro

Premium **offline-first dental clinic management software for Bangladesh** — a single Windows desktop app that a clinic can install, activate with a one-time code, and run forever without an internet connection. Bengali is a first-class language in both the UI and printed documents.

## What it does

| Module | Highlights |
|---|---|
| Patients | Registration with duplicate detection, auto codes, full profile, timeline, attachments, archive/permanent delete |
| Appointments & Queue | Day view, double-booking prevention, status flow, daily token queue with urgent priority |
| Clinical | Visits with treatment lines (price snapshots), FDI adult + pediatric dental chart with per-tooth history, prescriptions with structured Bengali dosage editor (সকাল / দুপুর / রাত), referrals |
| Billing | Invoices with discounts, partial/full payments (cash, card, bKash, Nagad, Rocket…), void cascades, auto accounting posts, thermal receipts |
| Inventory | Suppliers, FIFO batches, stock movements (usage/damaged/expired/adjust), low-stock & expiry alerts |
| Accounting | Auto income from payments + manual expenses, categories, summaries |
| Reports | Period reports with print + CSV export |
| Administration | Users, roles with a 69-permission matrix, full audit log, backups (create/verify/restore/schedule), offline one-time activation |

## Security model (summary)

- Every IPC channel is permission-checked **server-side** in the main process before data is touched; the renderer's `can()` gating is convenience only.
- Passwords: scrypt with per-user salts, lockout after failed attempts, forced change-at-next-login support.
- Activation: one-time offline code verified against a **scrypt-derived verifier** — the code itself is never stored, logged, or shipped.
- Assets served through the prefix-validated `dentiva-safe://` protocol; SQLite opened with `trusted_schema=OFF`.
- Money is stored as integer paisa; all financial mutations are transactional and invariant-checked.

Full details in [`docs/SECURITY_MODEL.md`](docs/SECURITY_MODEL.md).

## Tech stack

Electron 44 · React 19 + TypeScript 5.9 · electron-vite 5 · better-sqlite 3 (WAL) · Zod validation at every service boundary · zustand · Vitest · Playwright (e2e) · electron-builder (NSIS)

## Development

```bash
npm install          # install toolchain
npm run rebuild:native  # rebuild better-sqlite3 for Electron's ABI (required before dev/e2e)
npm run dev          # electron-vite dev (app + hot reload)
npm run typecheck    # tsc for main + renderer
npm run lint         # ESLint 9 flat config
npm test             # 125 tests: unit, integration, 41-step workflow, stress
npm run build        # production build to out/
npm run e2e          # Playwright smoke against the real app (xvfb-run on headless Linux)
npm run dist         # Windows NSIS installer (electron-builder)
```

The Bengali font (Noto Sans Bengali, SIL OFL 1.1) is bundled in `resources/fonts`, so printing works identically on any machine.

## Activation (vendor workflow)

The activation code is intentionally not in this repository. To derive a new verifier for a customer code:

```bash
node scripts/gen-activation-verifier.mjs <code>   # writes src/main/core/activationSecret.ts
```

See `docs/SECURITY_MODEL.md` §6.

## Documentation

| Doc | Purpose |
|---|---|
| [PROJECT_STATUS](docs/PROJECT_STATUS.md) | Living status — verified milestones only |
| [REQUIREMENTS_TRACEABILITY](docs/REQUIREMENTS_TRACEABILITY.md) | Requirement → implementation → verification |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | System architecture & stack decisions |
| [DATABASE_DESIGN](docs/DATABASE_DESIGN.md) | ER design, money/timestamp strategy |
| [UI_UX_SPECIFICATION](docs/UI_UX_SPECIFICATION.md) | Design system & screen inventory |
| [RBAC_MATRIX](docs/RBAC_MATRIX.md) | 69 permissions, default roles |
| [PRINT_SPECIFICATION](docs/PRINT_SPECIFICATION.md) | Print pipeline & paper profiles |
| [TEST_PLAN](docs/TEST_PLAN.md) | Test layers, matrices, measured stress results |
| [RELEASE_CHECKLIST](docs/RELEASE_CHECKLIST.md) | Release gate |

## License

UNLICENSED — proprietary. Third-party licenses: MIT (Electron deps, React, …), ISC (lucide), SIL OFL 1.1 (Noto Sans Bengali) — see [`docs/DEPENDENCY_LICENSE_AUDIT.md`](docs/DEPENDENCY_LICENSE_AUDIT.md).
