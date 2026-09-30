# Dentiva Pro — Dependency & License Audit

Runtime and development dependencies with purpose, license, and commercial compatibility. Exact versions are pinned in `package-lock.json` (reproducible builds). Re-audited before release (see RELEASE_CHECKLIST).

## Runtime dependencies (shipped in the application)

| Package | Version (major) | License | Purpose | Commercial use | Attribution |
|---|---|---|---|---|---|
| better-sqlite3 | 13 | MIT | Embedded SQLite driver (WAL, transactions) | ✅ | Notice file |
| zod | 3 | MIT | Schema validation at every service boundary | ✅ | Notice file |
| archiver | 7 | MIT | Streaming ZIP creation (backups) | ✅ | Notice file |
| extract-zip | 2 | MIT | Backup extraction (restore) | ✅ | Notice file |
| react / react-dom | 19 | MIT | UI runtime | ✅ | Notice file |
| react-router-dom | 7 | MIT | Screen routing | ✅ | Notice file |
| zustand | 5 | MIT | Client state management | ✅ | Notice file |
| lucide-react | 1 | ISC | Icon set (tree-shaken) | ✅ | Notice file |
| dayjs | 1 | MIT | Date handling/formatting | ✅ | Notice file |
| clsx | 2 | MIT | Class name composition | ✅ | Notice file |
| **Noto Sans Bengali** (font files) | 5.x (fontsource build) | **SIL OFL 1.1** | Bundled Bengali font (UI + print fidelity) | ✅ (bundling allowed; OFL is not a software copyleft) | License file shipped in `resources/fonts` + About notices |

## Development dependencies (not shipped)

electron (MIT), electron-vite (MIT), vite (MIT), @vitejs/plugin-react (MIT), electron-builder (MIT), typescript (Apache-2.0), @types/* (MIT), eslint + plugins (MIT), vitest (MIT), playwright-core (Apache-2.0).

## Notes & Controls

- No copyleft (GPL/AGPL/SSPL) dependencies. No dependency requires source disclosure of Dentiva Pro. No paid APIs or services.
- Zero network calls at runtime: the shipped app performs no outbound requests (verified in security audit).
- `npm audit` runs in CI; high/critical advisories block the release gate.
- Dependency count intentionally minimal (10 runtime packages + fonts); each is justified above. No unused dependencies (dead-dependency scan in release checklist).
- Third-Party Notices are shipped inside the application (Settings → About → Third-Party Notices) and in the installer.
