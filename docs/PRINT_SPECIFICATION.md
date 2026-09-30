# Dentiva Pro — Print Specification

## 1. Pipeline

1. **Document composition (renderer):** semantic HTML + print CSS from the shared print library (`printCss(profile, opts)` + per-document builders). All clinic/dentist/patient data injected; Bengali-safe.
2. **Render (main):** HTML written to a temp file, loaded in a hidden BrowserWindow over the secure `dentiva-safe://` protocol (fonts, clinic logo, no external requests).
3. **Canonical PDF:** `webContents.printToPDF({ printBackground: true, preferCSSPageSize: true })` — page geometry comes from `@page` CSS, guaranteeing preview == output.
4. **Preview modal (in-app):** the canonical PDF displayed in an iframe (Chromium PDF viewer: zoom, page navigation, search). Buttons: Print, Save as PDF, paper profile selector, printer selector, cancel.
5. **Print:** `webContents.print({ printBackground: true, silent: profile.printer ? true : false, deviceName? })` — silent to a saved printer or the standard Windows print dialog (lists every Windows-accessible printer).
6. **Save as PDF:** native save dialog → copies the canonical PDF (identical to what prints).

## 2. Paper Profiles

| Profile | Page (mm) | Default margins (mm) | Notes |
|---|---|---|---|
| A4 | 210 × 297 | 12 | full layouts |
| A5 | 148 × 210 | 8 | compact variant |
| Letter | 216 × 279.4 | 12 | |
| Thermal 80 mm | 80 × 297* | 3 | *PDF preview uses fixed 297 mm length; direct printing delegates length to the driver (continuous stock) — documented limitation |
| Thermal 58 mm | 58 × 297* | 2 | same note |
| Custom | user-defined W×H | user-defined | validated 30–350 mm |

Printer profiles (DB) store: name, Windows device name (optional), paper, margins, scale %, use-for document type, default flags.

## 3. Documents & Layouts

### 3.1 Prescription (spec §36 wireframe, elevated design)
- **Header band:** clinic logo (left), clinic name + address + phones (center/right), dentist name + designations + qualifications line; thin rule.
- **Patient strip:** Name · Patient code · Age/Sex · Date · Rx no.
- **Body, two columns (A4/A5):** LEFT = C/C (chips list), O/E (chips list), R/E / Advice text. RIGHT = ℞ medicines table (name+strength, dose form, M/N/E timing icons, before/after meal, duration, quantity, instructions, PRN badge). Thermal/full-width variants stack columns.
- **Additional advice** block (free text, Bengali-safe).
- **Signature area:** right-aligned rule with ≥ 22 mm clear vertical space above it for a handwritten signature, dentist name + degrees under the line. Intentionally generous (spec §35).
- **Footer:** configurable clinic message/quote + doctor timing line.
- Pagination: medicines continue on following pages with a compact repeated header ("℞ continued — {patient}, {date}").
- Prescription header repeats clinic identity consistently with invoice (shared header partial), but the signature area appears **only** on prescriptions (spec §39).

### 3.2 Invoice
- Header: same clinic identity band (no signature area unless clinic enables it).
- Meta: invoice no, date, patient name/code, dentist (optional).
- Items table: # · Treatment/Service · Tooth (if any) · Qty · Unit (৳) · Line total (৳). Totals block: Subtotal, Discount, **Total**, Paid, **Due**, status badge (UNPAID / PARTIALLY PAID / PAID / VOID).
- Footer: configurable invoice footer note (default: thank-you line). No signature block by default.

### 3.3 Payment receipt
- Compact: clinic header, receipt no/date, patient, amount (words optional), method, reference, received by, balance after payment. Auto-offer after recording a payment.

### 3.4 Reports
- Header + filter summary + table/grid + footer with generated-by/by-user + timestamp. Same paper system.

## 4. Fonts & Unicode

- Bundled **Noto Sans Bengali** (400/500/600/700, Bengali + Latin subsets, SIL OFL) loaded via `@font-face` from app assets over the secure protocol — identical rendering on every Windows machine; fallback chain `Noto Sans Bengali → Nirmala UI → sans-serif`. **Two formats, deliberately:** the app UI uses the smaller WOFF2 builds; **print documents reference the TTF builds** (`format('truetype')`). Differential CI diagnostics (print-geometry suite, runs 36722132504/36723879956) showed that pages whose only webfonts are WOFF2-sourced fail inside Chromium's print compositor (`print_compositor_impl.cc: CompositePages: Page reading failed` → `printToPDF` rejects with "Printing failed") — on Linux CI, and the packaged Windows app's invoice print produced no PDF the same way. TTF is the battle-tested format for print embedding. `PrintManager.renderPdf` also awaits `document.fonts.ready` (bounded 5 s) before printing — did-finish-load does not wait for web fonts. The TTF files are lossless WOFF2→TrueType conversions of the same bundled subsets (`wawoff2`, no metric or glyph changes); the OFL notice covers both formats.
- All print CSS uses `font-family` stack with the bundled font first for Bengali text; Latin defaults to the same family for visual consistency.
- Line wrapping: `word-break: break-word` + `overflow-wrap: anywhere` for long medicine names/notes — no clipped or overflowing columns (validated in print tests).

## 5. Quality Gates (validated in tests, see TEST_PLAN.md)

- Long medicine lists paginate; long patient names, Bengali text, and long addresses wrap without overflow.
- PDF page geometry matches the selected paper profile exactly (asserted by parsing the produced PDF MediaBox).
- Multi-page documents get correct page breaks and repeated headers.
- Logo rendering: max-height constraints, no distortion; `no logo` layout verified.
- High-DPI: PDF is vector text (resolution-independent); `scale` profile factor multiplies font size for mini-printers.
- Physical-printer matrix beyond print-to-PDF/CI is documented as externally-required validation (no printer hardware in build environment — honest limitation, spec §125).
