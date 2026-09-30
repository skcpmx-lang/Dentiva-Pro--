# Dentiva Pro — UI/UX Specification

## 1. Experience Principles

Premium clinical: calm, information-dense, trustworthy, fast. No childish dental motifs, no decorative gradients/glows, restrained motion (120–200 ms, ease-out, feedback only), consistent spacing, predictable grids (3+3 for 6 cards, never accidental orphans).

## 2. Design Tokens (CSS variables, light + dark themes)

- **Brand palette:** primary teal `#0F766E` (600) / `#115E59` (700) / `#134E4A` (800); sidebar deep teal-slate `#0C2B2C`→`#0F3A38` (subtle, not gradient-heavy).
- **Semantic:** success `#059669`, warning `#D97706`, danger `#DC2626`, info `#0284C7`; payment-method accents neutral.
- **Surfaces (light):** canvas `#F4F6F8`, surface `#FFFFFF`, border `#E2E8F0`, text `#0F172A`/muted `#64748B`. Dark theme mirrors with slate surfaces.
- **Typography:** UI stack `"Segoe UI", "Noto Sans Bengali", system-ui, sans-serif`; print stack `"Noto Sans Bengali", "Nirmala UI", sans-serif`. Scale: 12 / 13 / 14 (body) / 16 / 18 / 20 / 24 / 30 px; tabular numerals for money.
- **Spacing scale:** 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 px. **Radii:** 6 / 8 / 12 / 16 px. **Shadows:** 2 subtle levels + focus ring `0 0 0 3px rgba(15,118,110,.25)`.
- **Iconography:** lucide, 16/18/20 px, 1.75 stroke.

## 3. Shell Layout

- **Title bar:** native window controls (titleBarOverlay), in-app drag region.
- **Header (56 px):** Dentiva Pro wordmark (icon+name), clinic name + current date (Asia/Dhaka), global search (Ctrl+K), notification bell (unread badge), app status (DB ok / locked), user chip (role, avatar initial) → menu (profile/lock/logout), lock + logout buttons.
- **Sidebar (240 px expanded / 64 px collapsed, persisting preference, tooltips when collapsed):** PRACTICE (Dashboard, Patients, Appointments, Queue) · CLINICAL (Treatments, Prescriptions, Dental Chart→patient picker, Referrals) · BILLING (Invoices, Payments, Inventory, Accounting) · ADMINISTRATION (Staff & Users, Backup & Restore, Settings, Audit Log, About). Items render only when the user holds the relevant view permission.
- **Content:** page header (title, count, description, primary actions) + body; scroll container with sticky headers; min window 1200×720; tested 1280×720 → 3840×2160 at 100–200 % scaling.

## 4. Component Inventory (states: default/hover/focus/active/selected/disabled/loading/error/success as applicable)

Button (primary/secondary/ghost/danger/subtle; sizes; icon; loading spinner), IconButton, Input (with prefix/suffix, invalid), Textarea, Select (searchable), MultiSelect chips, Checkbox/Switch, Radio, DatePicker (text + calendar popover), TimeInput, MoneyInput (৳, 2 decimals), PatientPicker (searchable modal), DentistPicker, Badge/StatusPill (semantic), Tag, Card, StatCard, Tabs, DataTable (sortable columns, pagination, empty/loading/error rows, sticky header, row actions), Modal (sizes, Esc/backdrop close, focus trap), Drawer (right), ConfirmDialog (danger variant with typed confirmation), Toast system, Tooltip, Dropdown/Menu, EmptyState (icon, message, action), Loading skeletons + spinner, ErrorState (retry), NotificationPopover, CommandPalette (global search), PageHeader, KeyValueList, TimelineList, SegmentedControl, Stat rows, PrintPreviewModal, WizardShell (setup).

## 5. Screen Inventory

**Onboarding:** Setup wizard (Welcome → Activation → Clinic info+logo → Address/phones → Dentist(s)+designations+qualifications → Admin account → Security (auto-lock) → Backup location → Printer setup → Preferences → Review → Finish, per-step validation); Login; Lock screen.
**Practice:** Dashboard (role-aware widget grid + quick actions); Patients (date-range tabs Today/7d/30d/90d/1y/All/Custom, search, filters, sortable paginated table, export); Patient profile (header w/ alerts + quick actions; tabs Overview, Timeline, Visits, Dental Chart, Treatments, Prescriptions, Appointments, Invoices, Payments, Financial, Referrals, Attachments, Notes/Audit); Patient form (create/edit, duplicate detection).
**Scheduling:** Appointments (date navigation, dentist/status filters, status lifecycle actions, reschedule, cancel w/ reason, no-show, check-in→queue); Queue (live board, tokens, waiting-time, state actions, priority).
**Clinical:** Treatments catalog; Prescriptions (list + full builder: C/C chips, O/E chips, advice, multi-medicine table add/remove/reorder, follow-up); Dental chart (adult/pediatric, FDI, multi-select, conditions, per-tooth notes + history, visit linking); Referrals; Attachments (upload/preview/open/export/delete, metadata).
**Billing:** Invoices (list, builder with lines/discount/live totals, preview/print, void); Payments (range tabs default Today, method dashboard, record payment, receipt print, void); Inventory (items, batches/purchases, stock movements, low/out/expiry alerts, suppliers); Accounting (income/expense ledger, categories, summaries + charts, export, print).
**Administration:** Staff; Users; Roles & permission matrix editor; Backup & Restore; Settings (Practice, Dentists, Clinical options, Prescription, Invoice, Printing, Backup, Notifications, Appearance, Data Management, Advanced, About); Audit log; Notifications center; Reports; About.

## 6. Interaction Rules

- Keyboard: Ctrl+K search palette · Ctrl+N new (context-aware: patient) · Ctrl+S save (forms) · Ctrl+P print (preview contexts) · Esc closes topmost modal/popover · Alt+←/→ history · Ctrl+1…9 sidebar jumps. Full list shipped in README + Settings → About.
- Focus: visible ring everywhere; modals trap focus and restore it on close; tables support arrow-key row navigation.
- Empty states always explain + offer the primary action ("No patients have been added yet." + Add Patient). Never blank, never "Nothing", never fake sample data.
- Loading: skeletons for tables/cards, inline spinners for buttons; every async surface has an error state with retry.
- Forms: inline field validation with clear messages; unsaved-changes guard on wizards/forms; duplicate-patient confirmation before creation.
- Money always rendered `৳ 1,234.56` (en-IN grouping), tabular numerals; dates `DD MMM YYYY` (e.g., 30 Sep 2026); times 12-hour with AM/PM.
- Density (comfortable/compact) and theme (light/dark) in Appearance settings.

## 7. Responsive / DPI Rules

No fixed viewport assumptions; fluid content area with min-width guards; grids use `repeat(auto-fill, minmax(Xpx, 1fr))` with intentional breakpoints so card counts wrap 2/3/4-per-row without orphans; tables get horizontal scroll only as last resort; modals max-height with internal scroll; all controls reachable ≥ 1280×720. Chromium per-monitor DPI handles 100–200 % scaling; verified via window-size + zoomFactor test matrix in CI and manual checklist.
