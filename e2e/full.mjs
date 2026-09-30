#!/usr/bin/env node
/**
 * e2e/full.mjs — full-flow E2E against the PACKAGED app (real installer-grade
 * build, real default user-data paths, real IPC, real Chromium printToPDF).
 *
 *   node e2e/full.mjs
 *
 * Environment:
 *   DENTIVA_E2E_CODE  activation code the test build was compiled with
 *                     (scripts/gen-activation-verifier.mjs <code> run before build)
 *   DENTIVA_E2E_EXE   packaged executable (default: release/win-unpacked/Dentiva Pro.exe
 *                     or release/linux-unpacked/dentiva-pro)
 *
 * Coverage (each step must actually execute to be reported as passed):
 *   activation → first-run setup (clinic + owner) → dashboard → patient creation
 *   (Bengali) → patient profile → visit → dental chart → prescription → invoice →
 *   payment → queue lifecycle → appointment → global search → PDF generation
 *   (file + geometry + Bengali font embedding) → backup + restore → destructive
 *   safeguards (typed confirms) → logout/login → lock/unlock → full UI route sweep
 *   at 1280×720 and 1920×1080 with overflow + console-error checks.
 *
 * Printing to a physical printer is NOT tested here (no hardware in CI) — the
 * canonical PDF that printing would send is what gets validated.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { _electron as electron } from 'playwright-core'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const artifactsDir = join(root, 'e2e', 'artifacts')
mkdirSync(artifactsDir, { recursive: true })

const CODE = process.env.DENTIVA_E2E_CODE
if (!CODE) {
  console.error('DENTIVA_E2E_CODE must be set (the throwaway activation code compiled into this test build).')
  process.exit(2)
}

const OWNER = { name: 'Owner Tester', username: 'ownertest', password: 'Passw0rd123' }
const PATIENT = {
  name: 'মোঃ আব্দুল করিম',
  phone: '01712345678',
  complaint: 'দাঁতে তীব্র ব্যথা'
}

const exe =
  process.env.DENTIVA_E2E_EXE ??
  (process.platform === 'win32'
    ? join(root, 'release', 'win-unpacked', 'Dentiva Pro.exe')
    : join(root, 'release', 'linux-unpacked', 'dentiva-pro'))
if (!existsSync(exe)) {
  console.error(`Packaged executable not found: ${exe}`)
  process.exit(2)
}

/** user-data dir the packaged app really uses (app name from electron-builder productName). */
const userDataDir =
  process.platform === 'win32'
    ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Dentiva Pro')
    : join(homedir(), '.config', 'Dentiva Pro')
const tempDir = join(userDataDir, 'temp')

const results = []
let page = null
let app = null
const consoleErrors = []

const pass = (name) => { results.push({ name, ok: true }); console.log(`  ✔ ${name}`) }
const fail = (name, detail) => { results.push({ name, ok: false, detail }); console.error(`  ✘ ${name}\n    ${detail}`) }
const step = (name, fn) =>
  fn()
    .then(() => pass(name))
    .catch(async (err) => {
      fail(name, err instanceof Error ? err.message : String(err))
      try { await page?.screenshot({ path: join(artifactsDir, `full-fail-${results.length}.png`) }) } catch {}
    })

const shot = async (name) => { try { await page?.screenshot({ path: join(artifactsDir, `full-${name}.png`) }) } catch {} }

async function main() {
  console.log(`→ launching PACKAGED app: ${exe}`)
  console.log(`→ user data dir: ${userDataDir}`)
  app = await electron.launch({ executablePath: exe, env: { ...process.env } })
  page = await app.firstWindow()
  page.setDefaultTimeout(20_000)

  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))

  /* ---------------- first run: activation → setup → owner ---------------- */
  await step('activation: setup wizard shows the activation step', async () => {
    await page.locator('input[placeholder="•••• •••• •••• ••••"]').waitFor()
  })

  await step('activation: invalid code is rejected', async () => {
    await page.locator('input[placeholder="•••• •••• •••• ••••"]').fill('1111222233334444')
    await page.getByRole('button', { name: 'Activate', exact: true }).click()
    await page.waitForSelector('text=/activation code|invalid|incorrect/i', { timeout: 10_000 })
  })

  await step('activation: valid code advances to clinic setup', async () => {
    await page.locator('input[placeholder="•••• •••• •••• ••••"]').fill(CODE)
    await page.getByRole('button', { name: 'Activate', exact: true }).click()
    await page.locator('input[placeholder="e.g. Smile Dental Care"]').waitFor()
  })

  await step('setup: clinic + dentist details accepted', async () => {
    await page.locator('input[placeholder="e.g. Smile Dental Care"]').fill('স্মাইল ডেন্টাল কেয়ার')
    await page.locator('input[placeholder="House, Road, Area, City"]').fill('১২ গ্রিন রোড, ঢাকা')
    await page.locator('input[placeholder="01XXXXXXXXX"]').first().fill('01712345678')
    await page.locator('input[placeholder="e.g. Dr. Rahim Khan"]').fill('ডা. রহিম খান')
    await page.getByRole('button', { name: /Continue/ }).click()
    await page.locator('input[placeholder="Your name"]').waitFor()
  })

  await step('setup: owner account created, app reaches the dashboard', async () => {
    await page.locator('input[placeholder="Your name"]').fill(OWNER.name)
    await page.locator('input[placeholder="owner"]').fill(OWNER.username)
    await page.locator('input[type="password"]').nth(0).fill(OWNER.password)
    await page.locator('input[type="password"]').nth(1).fill(OWNER.password)
    await page.getByRole('button', { name: /Create owner/ }).click()
    await page.locator('.sidebar').waitFor()
    await page.locator('.nav-item', { hasText: 'Dashboard' }).waitFor()
  })
  await shot('dashboard')

  /* ---------------- patient creation (Bengali) ---------------- */
  await step('patients: create a Bengali patient via the form', async () => {
    await page.locator('.nav-item', { hasText: 'Patients' }).click()
    await page.getByRole('button', { name: 'New patient' }).click()
    await page.locator('input[placeholder="Patient full name (Bangla or English)"]').fill(PATIENT.name)
    await page.locator('input[placeholder="01XXXXXXXXX"]').fill(PATIENT.phone)
    await page.locator('input[placeholder="e.g. Pain in lower right molar"]').fill(PATIENT.complaint)
    await page.getByRole('button', { name: 'Create patient' }).click()
    await page.waitForSelector(`.tbl >> text=${PATIENT.name}`)
  })

  await step('patients: patient profile opens with quick actions', async () => {
    await page.locator('.tbl tbody tr', { hasText: PATIENT.name }).first().click()
    await page.waitForSelector('text=New visit')
    for (const label of ['New prescription', 'New invoice', 'Take payment']) {
      if (!(await page.getByRole('button', { name: label }).isVisible().catch(() => false))) throw new Error(`missing quick action: ${label}`)
    }
  })
  await shot('patient-detail')

  /* ---------------- visit ---------------- */
  await step('visits: record a visit with a treatment line', async () => {
    await page.getByRole('button', { name: 'New visit' }).click()
    await page.locator('input[placeholder="Search patient…"]').waitFor()
    // patient is preselected from the profile — add a treatment line
    await page.locator('input[placeholder="Treatment name"]').first().fill('Scaling & polishing')
    await page.locator('input[title="Unit price in ৳"]').first().fill('1500')
    await page.getByRole('button', { name: /Save visit/ }).click()
    await page.waitForSelector('.modal >> text=New visit', { state: 'detached', timeout: 15_000 })
    await page.waitForSelector('text=Scaling & polishing', { timeout: 10_000 })
  })

  /* ---------------- dental chart ---------------- */
  await step('chart: open patient chart, set a tooth condition with a note', async () => {
    await page.locator('.nav-item', { hasText: 'Dental Chart' }).click()
    await page.locator('input[placeholder="Search patient to open chart…"]').fill('আব্দুল')
    await page.locator('button:has(b)', { hasText: PATIENT.name }).first().click()
    await page.locator('.tooth', { hasText: '36' }).click()
    await page.locator('.card-pad', { hasText: 'Condition' }).locator('select.select').first().selectOption({ label: 'Caries' })
    await page.locator('textarea').first().fill('গহ্বরযুক্ত ক্ষয় — অস্থায়ী ফিলিং করা হয়েছে')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await page.waitForSelector('text=/saved|updated/i', { timeout: 10_000 })
  })
  await shot('chart')

  /* ---------------- prescription ---------------- */
  await step('prescriptions: issue a prescription with medicine + advice', async () => {
    await page.locator('.nav-item', { hasText: 'Prescriptions' }).click()
    await page.getByRole('button', { name: 'New prescription' }).click()
    await page.locator('input[placeholder="Search patient…"]').fill('আব্দুল')
    await page.locator('.modal button:has(b)', { hasText: PATIENT.name }).first().click()
    await page.locator('input[placeholder="Medicine name"]').first().fill('Amoxicillin 500mg')
    await page.locator('input[placeholder="Days"]').first().fill('7')
    await page.locator('textarea[placeholder="General advice printed on the prescription"]').fill('দিনে দুবার ব্রাশ করুন।')
    await page.getByRole('button', { name: /Save & print/ }).click()
    await page.waitForSelector('.modal >> text=New prescription', { state: 'detached', timeout: 20_000 })
    await page.waitForSelector('text=Amoxicillin', { timeout: 10_000 })
  })

  /* ---------------- invoice + payment ---------------- */
  await step('invoices: create an invoice with a line item', async () => {
    await page.locator('.nav-item', { hasText: 'Billing' }).click()
    await page.getByRole('button', { name: 'New invoice' }).click()
    await page.locator('input[placeholder="Search patient…"]').fill('আব্দুল')
    await page.locator('.modal button:has(b)', { hasText: PATIENT.name }).first().click()
    await page.locator('input[placeholder="Description"]').first().fill('Scaling & polishing — সম্পূর্ণ')
    await page.locator('.modal .row input[type="number"]').nth(1).fill('1500') // unit price (after qty)
    await page.getByRole('button', { name: /Create invoice/ }).click()
    await page.waitForSelector('.modal >> text=New invoice', { state: 'detached', timeout: 20_000 })
    await page.waitForSelector('text=Scaling & polishing', { timeout: 10_000 })
  })

  await step('payments: record a partial payment against the invoice', async () => {
    await page.locator('.nav-item', { hasText: 'Patients' }).click()
    await page.locator('.tbl tbody tr', { hasText: PATIENT.name }).first().click()
    await page.getByRole('button', { name: 'Take payment' }).click()
    await page.locator('.modal button', { hasText: 'Select' }).first().click()
    await page.locator('.modal input[type="number"]').first().fill('500')
    await page.getByRole('button', { name: 'Record payment' }).click()
    await page.waitForSelector('.modal >> text=Record payment', { state: 'detached', timeout: 15_000 })
    await page.waitForSelector('text=/Partially paid|partial/i', { timeout: 10_000 })
  })
  await shot('billing-after-payment')

  /* ---------------- queue lifecycle ---------------- */
  await step('queue: add patient and walk the full status lifecycle', async () => {
    await page.locator('.nav-item', { hasText: 'Queue' }).click()
    await page.getByRole('button', { name: 'Add to queue' }).click()
    await page.locator('input[placeholder="Search patient…"]').fill('আব্দুল')
    await page.locator('.modal button:has(b)', { hasText: PATIENT.name }).first().click()
    await page.getByRole('button', { name: 'Add to queue', exact: true }).click()
    await page.waitForSelector('.modal >> text=Add patient to queue', { state: 'detached', timeout: 15_000 })
    for (const label of ['Call patient', 'Start treatment', 'Move to billing', 'Finish']) {
      await page.getByRole('button', { name: label }).first().click()
      await page.waitForTimeout(600)
    }
    await page.waitForSelector('text=Completed today', { timeout: 10_000 })
  })

  /* ---------------- appointments ---------------- */
  await step('appointments: book a follow-up appointment', async () => {
    await page.locator('.nav-item', { hasText: 'Appointments' }).click()
    await page.getByRole('button', { name: 'New appointment' }).click()
    await page.locator('input[placeholder="Search patient by name or phone…"]').fill('আব্দুল')
    await page.locator('.modal button:has(b)', { hasText: PATIENT.name }).first().click()
    await page.locator('input[placeholder="e.g. RCT sitting 2"]').fill('ফলোআপ ভিজিট')
    await page.getByRole('button', { name: 'Create', exact: true }).click()
    await page.waitForSelector('.modal >> text=New appointment', { state: 'detached', timeout: 15_000 })
    await page.waitForSelector('text=ফলোআপ ভিজিট', { timeout: 10_000 })
  })

  /* ---------------- global search ---------------- */
  await step('global search finds the Bengali patient and navigates', async () => {
    await page.locator('.searchbar input').first().fill('আব্দুল')
    await page.waitForSelector('.card .nav-item', { timeout: 10_000 })
    await page.locator('.card .nav-item', { hasText: PATIENT.name }).first().click()
    await page.waitForSelector('text=New visit', { timeout: 10_000 })
  })

  /* ---------------- PDF generation from the packaged app ---------------- */
  await step('print: invoice Print button produces a real PDF (A4 geometry, Bengali font embedded)', async () => {
    const before = new Set(readdirSafe(tempDir))
    await page.locator('.nav-item', { hasText: 'Billing' }).click()
    const row = page.locator('.tbl tbody tr', { hasText: 'INV-' }).first()
    await row.locator('button').first().click() // printer icon button
    let pdf = null
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(1000)
      const now = readdirSafe(tempDir).filter((f) => f.endsWith('.pdf') && !before.has(f))
      if (now.length > 0) { pdf = join(tempDir, now[0]); break }
    }
    if (!pdf) throw new Error('no new PDF appeared in the app temp dir after clicking Print')
    const bytes = readFileSync(pdf)
    if (bytes.length < 1000) throw new Error(`PDF too small (${bytes.length} bytes)`)
    const latin = bytes.toString('latin1')
    const m = latin.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/)
    if (!m) throw new Error('no MediaBox in generated PDF')
    const w = Number(m[3]) - Number(m[1])
    const h = Number(m[4]) - Number(m[2])
    const expectW = (210 * 72) / 25.4
    const expectH = (297 * 72) / 25.4
    if (Math.abs(w - expectW) > 1 || Math.abs(h - expectH) > 1) throw new Error(`A4 geometry wrong: ${w.toFixed(1)}×${h.toFixed(1)}pt`)
    if (!latin.includes('NotoSansBengali')) throw new Error('Bengali font not embedded in the packaged-app PDF')
  })

  /* ---------------- backup + restore ---------------- */
  await step('backup: manual backup runs and is listed', async () => {
    await page.locator('.nav-item', { hasText: 'Settings' }).click()
    await page.locator('.tab', { hasText: 'Backup & restore' }).click()
    await page.getByRole('button', { name: 'Back up now' }).click()
    await page.waitForSelector('text=/backup/i', { timeout: 15_000 })
    await page.waitForSelector('button:has-text("Restore…")', { timeout: 15_000 })
  })

  await step('restore: typed confirmation gates the restore, app reloads with data intact', async () => {
    await page.locator('button:has-text("Restore…")').first().click()
    // wrong text leaves the confirm button disabled
    await page.locator('.modal input.input').fill('WRONG')
    const disabled = await page.getByRole('button', { name: 'Restore now' }).isDisabled()
    if (!disabled) throw new Error('Restore confirm not gated by typed text')
    await page.locator('.modal input.input').fill('RESTORE')
    await page.getByRole('button', { name: 'Restore now' }).click()
    // restore takes a pre-restore safety backup, restores, reloads → login screen
    await page.locator('.auth-card').waitFor({ timeout: 60_000 })
    await page.waitForTimeout(1500)
  })
  await shot('after-restore')

  /* ---------------- login again after restore (sessions invalidated) ---------------- */
  await step('auth: sign in again after restore', async () => {
    const inputs = page.locator('.auth-card input.input')
    await inputs.first().waitFor({ timeout: 20_000 })
    await inputs.nth(0).fill(OWNER.username)
    await inputs.nth(1).fill(OWNER.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.locator('.sidebar').waitFor({ timeout: 20_000 })
    await page.locator('.nav-item', { hasText: 'Patients' }).click()
    await page.locator('.tbl tbody tr', { hasText: PATIENT.name }).first().waitFor({ timeout: 20_000 })
  })

  /* ---------------- destructive safeguards ---------------- */
  await step('destructive: patient permanent delete requires the exact patient code', async () => {
    await page.locator('.tbl tbody tr', { hasText: PATIENT.name }).first().click()
    await page.waitForSelector('text=New visit')
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.locator('.modal input.input').fill('WRONG-CODE')
    const disabled = await page.getByRole('button', { name: 'Delete forever' }).isDisabled()
    if (!disabled) throw new Error('delete confirm not gated by patient code')
    await page.getByRole('button', { name: 'Cancel' }).click()
  })

  await step('destructive: invoice void requires a reason', async () => {
    await page.locator('.nav-item', { hasText: 'Billing' }).click()
    const row = page.locator('.tbl tbody tr', { hasText: 'INV-' }).first()
    await row.locator('button').nth(1).click() // void (ban icon)
    await page.locator('.modal textarea').fill('ভুল ইনভয়েস — পুনরায় ইস্যু করা হবে')
    await page.getByRole('button', { name: 'Void invoice' }).click()
    await page.waitForSelector('.modal', { state: 'detached', timeout: 15_000 })
    await page.locator('.badge', { hasText: /^void$/ }).first().waitFor({ timeout: 10_000 })
  })

  /* ---------------- lock / unlock ---------------- */
  await step('auth: lock now → unlock with password', async () => {
    await page.locator('.user-chip').click()
    await page.getByRole('button', { name: 'Lock now' }).click()
    await page.locator('.auth-card input[type="password"]').waitFor()
    await page.locator('.auth-card input[type="password"]').fill(OWNER.password)
    await page.getByRole('button', { name: 'Unlock' }).click()
    await page.locator('.sidebar').waitFor({ timeout: 20_000 })
  })

  /* ---------------- logout / login ---------------- */
  await step('auth: sign out → sign in with the owner account', async () => {
    await page.locator('.user-chip').click()
    await page.getByRole('button', { name: 'Sign out' }).click()
    await page.locator('.auth-card input.input').first().waitFor()
    const inputs = page.locator('.auth-card input.input')
    await inputs.nth(0).fill(OWNER.username)
    await inputs.nth(1).fill(OWNER.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.locator('.sidebar').waitFor({ timeout: 20_000 })
  })

  /* ---------------- full UI sweep at two resolutions ---------------- */
  const routes = [
    ['Dashboard', ''], ['Patients', 'patients'], ['Appointments', 'appointments'], ['Queue', 'queue'],
    ['Visits', 'visits'], ['Dental Chart', 'chart'], ['Prescriptions', 'prescriptions'], ['Billing', 'billing'],
    ['Inventory', 'inventory'], ['Accounting', 'accounting'], ['Reports', 'reports'], ['Notifications', 'notifications'],
    ['Staff', 'staff'], ['Users & Roles', 'access'], ['Audit Log', 'audit'], ['Settings', 'settings']
  ]
  const overflowErrors = []
  for (const [sizeLabel, w, h] of [['1280×720', 1280, 720], ['1920×1080', 1920, 1080]]) {
    await app.evaluate(({ BrowserWindow }, [ww, hh]) => {
      const win = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed())
      if (win) win.setSize(ww, hh)
    }, [w, h])
    await page.waitForTimeout(400)
    for (const [label, route] of routes) {
      const nav = page.locator('.nav-item', { hasText: label }).first()
      if (await nav.count()) await nav.click()
      else await page.evaluate((r) => { window.location.hash = `/${r}` }, route)
      await page.waitForTimeout(500)
      const over = await page.evaluate(() => {
        const de = document.documentElement
        return { sw: de.scrollWidth, cw: de.clientWidth, body: document.body ? document.body.scrollWidth : 0 }
      })
      if (over.sw > over.cw + 2) overflowErrors.push(`${label} @${sizeLabel}: scrollWidth ${over.sw} > clientWidth ${over.cw}`)
      const visible = await page.locator('.page').isVisible().catch(() => false)
      if (!visible) overflowErrors.push(`${label} @${sizeLabel}: .page not visible`)
    }
  }
  if (overflowErrors.length > 0) fail('UI sweep: no horizontal overflow, all pages render at 1280×720 and 1920×1080', overflowErrors.join('; '))
  else pass('UI sweep: no horizontal overflow, all pages render at 1280×720 and 1920×1080')
  await shot('ui-sweep-1920')

  /* ---------------- console errors ---------------- */
  const benign = [/favicon/i, /net::ERR_FILE_NOT_FOUND.*favicon/i]
  const realErrors = consoleErrors.filter((e) => !benign.some((b) => b.test(e)))
  if (realErrors.length > 0) fail('zero renderer console errors across the whole flow', `${realErrors.length} error(s): ${realErrors.slice(0, 5).join(' | ')}`)
  else pass('zero renderer console errors across the whole flow')

  /* ---------------- report ---------------- */
  const failed = results.filter((r) => !r.ok)
  console.log(`\nFull packaged E2E: ${results.length - failed.length}/${results.length} steps passed`)
  await app.close().catch(() => {})
  process.exit(failed.length > 0 ? 1 : 0)
}

function readdirSafe(dir) {
  try { return readdirSync(dir) } catch { return [] }
}

main().catch(async (e) => {
  console.error(`✘ fatal: ${e instanceof Error ? e.stack : String(e)}`)
  try { await page?.screenshot({ path: join(artifactsDir, 'full-fail-fatal.png') }) } catch {}
  try { await app?.close() } catch {}
  process.exit(1)
})
