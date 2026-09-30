# Dentiva Pro — Architecture

## 1. System Overview

Dentiva Pro is a fully offline, single-user-at-a-time desktop application (multi-user accounts, one OS session) for Windows, built as an Electron 44 desktop app.

```
┌──────────────────────────────────────────────────────────────────────┐
│ MAIN PROCESS (Node.js 22, trusted)                                   │
│                                                                      │
│  ┌────────────┐   ┌──────────────────────────────────────────────┐  │
│  │ IPC Router │──▶│ Service Layer (all business rules + RBAC)     │  │
│  │ (token +   │   │  auth · activation · setup · patients ·       │  │
│  │  perm      │   │  appointments · queue · visits · chart ·      │  │
│  │  checks)   │   │  treatments · prescriptions · attachments ·   │  │
│  └────────────┘   │  referrals · invoices · payments · inventory ·│  │
│                   │  accounting · staff · users/roles · audit ·    │  │
│                   │  backup/restore · search · notifications ·     │  │
│                   │  reports · dashboard · settings · print        │  │
│                   └───────────────┬──────────────────────────────┘  │
│                                   ▼                                  │
│                   ┌──────────────────────────────────────────────┐  │
│                   │ SQLite (better-sqlite3, WAL, FK on)          │  │
│                   │ userData/dentiva.sqlite3                     │  │
│                   └──────────────────────────────────────────────┘  │
│   Filesystem: attachments/ · backups/ · logs/ · temp/ (validated)    │
│   Printing: hidden BrowserWindow → printToPDF / webContents.print    │
│   Auto-lock: powerMonitor.getSystemIdleTime()                        │
│   Secure protocol: dentiva-safe:// (app assets, temp, attachments)   │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ IPC (contextBridge, token, envelope)
┌───────────────────────────────▼──────────────────────────────────────┐
│ RENDERER (React 19 + TS, untrusted)                                  │
│  App shell · Setup wizard · Login/Lock · Dashboard · Patients ·      │
│  Appointments · Queue · Clinical (visits, chart, Rx, referrals,      │
│  attachments, timeline) · Billing (invoices, payments, inventory,    │
│  accounting) · Administration (staff, users, roles, backup,          │
│  settings, audit, notifications, about, reports) · Global search ·   │
│  Print preview (PDF iframe)                                          │
└──────────────────────────────────────────────────────────────────────┘
```

## 2. Technology Stack (pinned in `package.json` / `package-lock.json`)

| Layer | Technology | Why |
|---|---|---|
| Desktop shell | Electron 44 (Chromium + Node 22) | Printing engine, Bengali shaping, Windows integration, high-DPI |
| UI | React 19 + TypeScript 5.9 (strict) | Component quality, type safety, maintainability |
| Build | electron-vite 5 + Vite 7 | Fast, maintained Electron-aware bundling; main/preload/renderer pipelines |
| Database | SQLite via better-sqlite3 13 | Synchronous transactions, WAL, FK enforcement, mature |
| Validation | zod 3 | Shared schema validation at the service boundary |
| State | zustand 5 | Minimal, typed client state |
| Router | react-router-dom 7 (MemoryRouter) | Screen navigation |
| Icons | lucide-react | Consistent icon set, tree-shaken |
| Dates | dayjs | Small, immutable date handling |
| Backup | archiver 7 (zip write) + extract-zip 2 (extract) | Streaming zip creation; used by Electron itself |
| Tests | Vitest 5 (+ Playwright-core for Electron E2E) | In-process service tests; real app smoke tests |
| Packaging | electron-builder 26 (NSIS) | Professional Windows installer, CI-buildable |

### Alternatives evaluated (rejected)

- **Tauri 2 (Rust + system WebView):** small binaries, but printing/print-preview/PDF with Bengali shaping must be hand-built (WebView2 lacks Chromium's print pipeline access); native Rust modules add delivery risk for this team; WebView2 rendering varies by Windows version. Rejected primarily on print-fidelity risk.
- **.NET 8 WPF/WinUI:** excellent Windows integration but cannot be built or tested in the delivery pipeline used here (Linux sandbox), and Bengali shaping + print-preview quality is effort-heavy. Rejected on build/test pipeline risk.
- **Qt 6 / PySide6:** good printing, heavier packaging (PyInstaller), slower premium-UI development, weaker web-tech hiring pool for maintenance. Rejected on maintainability.
- **Local web server + browser:** violates desktop-app identity and packaging requirements.

## 3. Process & Security Model

- **Main process is the only trusted component.** It owns the database, filesystem, printing, sessions, and permission enforcement.
- **Renderer is untrusted.** It cannot open the DB, read arbitrary files, or reach Node. All calls go through `contextBridge` (`window.dentiva`), which forwards `{channel, token, payload}` to the main process.
- **Every IPC route** is registered with an explicit permission requirement (or `public`/`authed-only`), validated in the router *before* the service executes. UI hiding is cosmetic only.
- **Sessions** are in-memory in the main process: `{token, userId, permissions, lockedAt}`. Restart ⇒ re-login. Lock ⇒ all routes except `auth.unlock` return `ERR_LOCKED`.
- **Responses** use an envelope: `{ ok: true, data } | { ok: false, code, message, details? }`. Error codes are stable (`ERR_VALIDATION`, `ERR_PERMISSION`, `ERR_LOCKED`, `ERR_NOT_FOUND`, `ERR_CONFLICT`, `ERR_INTEGRITY`, `ERR_IO`, `ERR_INTERNAL`).

## 4. Service Layer

Services are plain TypeScript modules with a dependency-injected `AppContext`:

```ts
interface AppContext {
  db: Database                 // better-sqlite3 handle
  paths: AppPaths              // userData, attachments, backups, logs, temp
  clock: () => Date            // injectable time (tests)
  audit: AuditService          // audit writer
  bus: EventBus                // in-app notification generation
}
```

This makes every business rule testable in-process under Vitest without Electron (see `TEST_PLAN.md`), while the exact same code runs inside the app.

## 5. Printing Architecture (summary — full spec in `PRINT_SPECIFICATION.md`)

1. Renderer builds a **semantic print document** (clinic header, patient block, clinical/financial body, footers) as HTML+CSS with paper-profile-driven `@page` rules.
2. Main writes it to a temp file and loads it in a hidden BrowserWindow over the secure protocol.
3. `printToPDF` produces the **canonical PDF** (exact print output).
4. Preview modal shows the PDF in an iframe (Chromium PDF viewer: zoom, page navigation, search).
5. *Print* → `webContents.print()` (Windows printer dialog/driver, silent mode for profiles with a saved printer).
6. *Save as PDF* → native save dialog copies the canonical PDF.

## 6. Backup Architecture (summary)

- Manual + scheduled (7/15/30 days/off) backups.
- Consistent DB snapshot via `VACUUM INTO`, plus attachments, plus `manifest.json` (app version, schema version, timestamps, type, per-file SHA-256).
- Post-create verification (re-open, re-hash, compare) — success is only reported after verification.
- Restore: verify → typed confirmation → automatic pre-restore backup → swap files → integrity checks (`integrity_check`, `foreign_key_check`, schema version) → audit. Failure at any step rolls back to the pre-restore state.

## 7. Directory Layout

```
src/
  main/            # Electron main process
    index.ts       # app bootstrap, window, protocol, auto-lock, tray-free
    ipc/           # route registry (channel → permission → handler)
    app/           # windows, protocol, logger, paths, autolock (Electron-coupled)
    core/          # db connection, migrations, seed, errors, context
    services/      # ALL business logic (Electron-free, testable)
  preload/index.ts # contextBridge API
  shared/          # types shared by main + renderer (DTOs, permissions, errors)
  renderer/
    public/fonts/  # bundled Noto Sans Bengali (OFL)
    src/           # React app
      app/         # shell, routing, providers
      components/  # design system
      features/    # one folder per module screen
      lib/         # IPC client, formatters, hooks, stores
      styles/      # design tokens & global CSS
tests/             # Vitest unit + integration
e2e/               # Playwright-core Electron smoke
docs/              # engineering documents
build/             # icon.ico etc. (build resources)
.github/workflows/ # CI: verify (win+ubuntu), build installer, release
```

## 8. Failure Handling & Crash Safety

- All multi-step mutations run inside SQLite transactions (payments, invoices, stock, restore metadata, permission changes). A crash mid-transaction rolls back completely (WAL journal).
- Filesystem operations that cannot be transactional (attachment copy, backup write) use write-to-temp + atomic rename.
- The renderer renders explicit loading/empty/error states for every data view; no unbounded spinners (timeouts surface recoverable errors).

## 9. Performance Strategy

- Every list endpoint is paginated with count queries; no unbounded renders.
- Debounced search inputs (250 ms) with server-side bounded result windows.
- Indexed lookups for all hot paths (see `DATABASE_DESIGN.md`).
- Stress tests with generated datasets provide measured evidence (`TEST_PLAN.md` §Stress results).
