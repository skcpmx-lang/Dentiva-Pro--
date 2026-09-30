# Dentiva Pro — Security Model

## 1. Assets

1. Patient clinical data (visits, charts, prescriptions, attachments)
2. Financial data (invoices, payments, accounting)
3. Credentials & role assignments
4. Audit trail
5. Backups (contain 1–4)
6. Activation state & the activation verifier
7. Application binary

## 2. Adversaries & Trust Boundaries (offline desktop reality)

| Adversary | Capability | Honest assessment |
|---|---|---|
| Curious/unauthorized **staff member** using the app | Full UI access, can attempt any action through supported flows | **Primary threat — fully mitigated** by service-layer RBAC, audit, lock screens. UI hiding is never the control. |
| Staff member with OS file access on the clinic PC | Can read `AppData` files incl. SQLite DB | **Partially mitigated** (see §5 Local File Reality). OS-level account separation/EFS is recommended in README; true confidentiality against the OS user is impossible in an offline desktop app without enterprise key management — documented honestly. |
| Malware on the clinic PC | Same as above plus keylogging | Out of scope for any local app; documented in README (antivirus/OS hygiene). |
| Reverse engineer with the binary | Static analysis of shipped code | Activation & license secrets are derived (scrypt) — plaintext absent — but a determined attacker can patch the binary. This is an accepted, documented limitation of offline fixed-code activation (spec §54 acknowledges it). No online verification exists by product requirement. |
| External network attacker | None — the app makes **zero outbound network calls** and listens on nothing. | No attack surface. |

## 3. Authentication

- Username (case-insensitive unique) + password.
- **scrypt** (N=16384, r=8, p=1, 64-byte key, 16-byte salt; parameters serialized with hash). No plaintext or reversible storage, ever (incl. logs/backups — the DB stores only the hash).
- Strength policy at creation/change: ≥ 8 chars, letter + digit minimum.
- Lockout: 5 consecutive failures → account locked 15 minutes (audited, surfaced to user).
- Sessions: opaque 256-bit random tokens, main-process memory only. Restart ⇒ re-login. Inactive-user login rejected.
- **Auto-lock** (`powerMonitor` system idle): 5/10/15/30 min or Never. While locked, every IPC call except `auth.unlock` returns `ERR_LOCKED`; unlock requires the password again. Locking also hides app content behind the lock screen (no data visible underneath).

## 4. Authorization (full detail in `RBAC_MATRIX.md`)

- Granular permissions (`patient.view`, `payment.create`, `accounting.view`, …) grouped in roles; custom roles supported; matrix editable by `role.manage` holders.
- **Enforcement point: the IPC router + service layer in the trusted main process**, before any data access. Every route declares its permission.
- Financial data (payments summary, accounting, patient financials, financial dashboards, financial exports) is additionally filtered out of global search, reports, notifications, and patient profiles for users without `financial.view` — enforced server-side per query, not by hiding UI.
- Destructive operations (`business.delete`, restore, permanent patient delete, user/role changes) require confirmation payloads (typed confirmation strings) validated server-side, and are audited.

## 5. Local File Reality (honest statement)

- The SQLite database and backups live in the user profile (`%APPDATA%/DentivaPro`). Any OS user with access to that profile can read them. This is inherent to offline desktop software without external key custody.
- Mitigations shipped: OS file permissions default to the user profile ACLs; backups are integrity-protected (SHA-256 manifests) though not encrypted — **documented limitation**; recommendation in README to restrict Windows accounts and use full-disk encryption for patient-data confidentiality. No false claims of unbreakable local encryption are made.

## 6. Activation (spec §54)

- One-time offline activation during first-run setup with the vendor-provided 16-digit code.
- Verification: normalized input → scrypt(key) comparison against a **derived verifier constant** embedded in source. Constant-time compare. The plaintext code exists **nowhere** in source, config, bundles, seeds, logs, docs, or DB.
- State: `activation_state` row; activation events audited (without the code). No IPC route can flip `is_activated` except successful verification.
- Accepted limitation (per spec): a purely local, offline, fixed-code mechanism cannot resist a determined reverse engineer who patches the binary; we minimize attack surface and never claim otherwise.

## 7. Input & File Handling

- **All** external input validated with zod at the service boundary (types, ranges, enums, dates, lengths).
- File uploads (logo, attachments, photos): main-process `dialog` selection only (no renderer-supplied paths); extension + MIME sniff + size limits; images decoded to detect corruption; stored under server-generated UUID names in per-patient folders (path traversal impossible); SHA-256 recorded.
- SQL: 100% parameterized statements via better-sqlite3. No string interpolation of user input into SQL, ever.
- Paths: all file access resolved & prefix-checked (`path.resolve` + allowlist roots) before I/O — no traversal from any parameter.
- No shell invocation with user-controlled strings anywhere. `shell.openPath` only on attachment files the app itself wrote.
- No deserialization of untrusted serialized objects; backup manifests are JSON parsed with strict schema validation and hash verification before use.

## 8. Logging & Privacy

- Rotating local logs (`logs/main.log`, 5 MB × 5) with a redaction layer: passwords, tokens, activation input, and patient payload contents never logged; log lines carry entity IDs, not patient data.
- Zero telemetry, zero outbound connections, no tracking, no crash-reporter uploads. Verified: no `net.fetch/XHR/WebSocket` in shipped renderer; main process performs no network I/O.

## 9. Backup Security

- Backups include the DB + attachments + SHA-256 manifest; restore verifies every hash and aborts on mismatch.
- Pre-restore backup is mandatory and automatic.
- Backups are **not encrypted** (documented limitation + README recommendation to store backups on access-controlled media).

## 10. Secret Scan (release gate item)

Pre-release scan of the repo and build output for: the activation plaintext, passwords, API keys, tokens, private keys, development credentials. Scripted in CI (`scripts/secret-scan.mjs`) with an explicit allowlist; failure blocks release.

## 11. Threat → Control Matrix (summary)

| Threat | Control |
|---|---|
| Staff performing unauthorized actions via UI | Service-layer RBAC (primary), UI affordances (secondary) |
| Staff invoking protected actions via any other route | All routes go through the permission-checking router; no alternate data path exists |
| Financial leakage via search/reports/notifications | Server-side per-query permission filtering |
| Credential theft from storage | scrypt hashes; no plaintext anywhere |
| Session hijack on a locked workstation | Idle auto-lock + password re-auth; token useless while locked |
| Path traversal via attachments/filenames | Server-side names + root prefix validation |
| Malicious/corrupt uploads | MIME sniff, image decode check, size caps, hash |
| SQL injection | Parameterized statements only |
| Tampered backup restore | Manifest hash verification + integrity checks + pre-restore backup |
| Destructive actions by mistake | Typed confirmations, pre-operation backups, audit, Owner-only permission |
| Secret leakage in repo/bundle | Derived activation verifier + CI secret scan |
