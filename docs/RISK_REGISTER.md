# Dentiva Pro — Risk Register

| ID | Risk | Likelihood | Impact | Mitigation | Status |
|---|---|---|---|---|---|
| R-01 | Windows-only issues (paths, printer drivers, DPI) not caught on Linux dev box | Medium | High | CI runs full test suite + E2E + installer build on `windows-latest`; E2E boots real app on Windows | Open — CI green required at release |
| R-02 | better-sqlite3 native ABI mismatch with Electron 44 on Windows | Low | High | electron-builder `install-app-deps` rebuild on CI; prebuilds verified during CI | Open — verified at first CI run |
| R-03 | Physical printing behavior differs per printer | Certain (variance) | Medium | Chromium print pipeline delegates to Windows drivers; paper profiles; documented limitation; PDF is canonical | Accepted & documented |
| R-04 | Bengali rendering differences on customer machines | Low | Medium | Bundled Noto Sans Bengali in UI and print — machine-independent | Mitigated |
| R-05 | Offline activation bypass by reverse engineering | Medium (if attacked) | Low (business, accepted) | Derived verifier, minimized surface, audit; documented limitation per spec §54 | Accepted & documented |
| R-06 | Local DB/backup readable by OS user | Certain | Medium | OS user-profile ACLs; README guidance (restricted accounts, disk encryption); honest documentation | Accepted & documented |
| R-07 | Large dataset performance regression | Low | High | Indexed queries, pagination, stress tests with measured evidence; FTS fallback plan (AD-020) | Verified at stress test |
| R-08 | Backup corruption silently losing data | Low | High | SHA-256 manifests, post-create verification, restore-time verification, pre-restore backup, failure rollback | Mitigated by design + tests |
| R-09 | Financial rounding inconsistency | Low | High | Integer paisa arithmetic everywhere; invariant tests | Mitigated by design + tests |
| R-10 | Permission bypass through an unguarded route | Low | Critical | Router-level declarative permission map; integration tests enumerate routes×roles; no data path outside router | Mitigated by design + tests |
| R-11 | Scope overrun / unfinished features at release | Medium | Critical | Frozen 1.0.0 scope (AD-030); traceability matrix; no shipped placeholder functionality — anything incomplete is documented as not-released | Managed |
| R-12 | Electron installer size/AV false positives | Medium | Low | NSIS from official electron-builder; code-signing unavailable (documented); README note on SmartScreen | Accepted & documented |
| R-13 | Unintended data loss during restore | Low | Critical | Pre-restore backup + verification + rollback-on-failure + tests (incl. interrupted restore) | Mitigated by design + tests |
| R-14 | Session left accessible on shared clinic PC | Medium | High | Idle auto-lock (system-wide), manual lock, re-auth to unlock | Mitigated by design |
| R-15 | CI/CD unavailable at release time | Low | Medium | Verified /dist fallback per spec §122 | Contingency defined |
| R-16 | extract-zip 2.0.1 open HIGH advisory (unvalidated symlink path traversal; no upstream fix) | Low (requires planting a zip in the app-managed backups directory — same privilege as editing the DB directly) | High if exploited | `assertZipSafe` pre-extraction guard (src/main/services/zipGuard.ts): central-directory scan rejects symlink + unsafe-path entries before any extraction; yauzl itself also refuses traversal names; runs before both extract sites (verify + restore); 6 dedicated tests (tests/zip-guard.test.ts) | Mitigated (defense in depth) — monitor for upstream fix |
