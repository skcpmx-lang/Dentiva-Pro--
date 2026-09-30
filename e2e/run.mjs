#!/usr/bin/env node
/**
 * End-to-end smoke test for Dentiva Pro.
 *
 *   node e2e/run.mjs            # launches the built app against a throwaway data dir
 *   node e2e/run.mjs --build    # force a fresh `npm run build` first
 *
 * Requires: `npm run build` output in out/ (auto-built when missing) and a display
 * (on headless Linux run under `xvfb-run -a npm run e2e`).
 *
 * The real activation code is intentionally not part of this repo, so the flow
 * under test is everything up to and including activation rejection:
 *   1. the app boots and shows a window
 *   2. the renderer loads and reaches the offline-activation step
 *   3. the IPC router answers and surfaces a validation error for a bad code
 * This exercises main boot, preload bridge, router, error pipeline and the UI.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const artifactsDir = join(root, 'e2e', 'artifacts')

let failed = 0
const step = (name, fn) =>
  fn()
    .then(() => console.log(`  ✔ ${name}`))
    .catch((err) => {
      failed++
      console.error(`  ✘ ${name}\n    ${err instanceof Error ? err.message : String(err)}`)
    })

async function main() {
  const mainBundle = join(root, 'out', 'main', 'index.js')
  const forceBuild = process.argv.includes('--build')
  if (forceBuild || !existsSync(mainBundle)) {
    console.log(forceBuild ? '→ rebuilding app…' : '→ no build output found, building…')
    const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
    if (build.status !== 0) {
      console.error('Build failed — cannot run e2e.')
      process.exit(1)
    }
  }

  const userData = mkdtempSync(join(root, 'e2e', '.userdata-'))
  mkdirSync(artifactsDir, { recursive: true })
  console.log(`→ launching Dentiva Pro (throwaway data dir)`)

  const app = await electron.launch({
    executablePath: require('electron'), // the electron package exports the binary path when required from plain Node
    args: [root],
    env: { ...process.env, DENTIVA_TEST_USERDATA: userData, NODE_ENV: 'test' }
  })

  const consoleErrors = []
  // Surface main-process output (native module failures, boot crashes) in the log.
  app.process().stdout?.on('data', (d) => process.stdout.write(`[electron] ${d}`))
  app.process().stderr?.on('data', (d) => process.stderr.write(`[electron-err] ${d}`))
  try {
    const window = await app.firstWindow()
    // Attach before load finishes so boot-time errors are captured.
    window.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    window.on('pageerror', (err) => consoleErrors.push(`Uncaught: ${err.message}`))
    await window.waitForLoadState('domcontentloaded')

    await step('app opens a window', async () => {
      if (!(await window.isVisible())) throw new Error('window is not visible')
    })

    await step('renderer reaches the activation step', async () => {
      await window.getByText('Offline activation').waitFor({ timeout: 15000 })
    })

    await step('invalid activation code is rejected with a clear error', async () => {
      await window.getByPlaceholder('•••• •••• •••• ••••').fill('0000000000000000')
      await window.getByRole('button', { name: 'Activate', exact: true }).click()
      await window.getByText('Invalid activation code').waitFor({ timeout: 10000 })
    })

    await step('no renderer console errors during boot', async () => {
      await window.waitForTimeout(1500)
      if (consoleErrors.length > 0) throw new Error(consoleErrors.slice(0, 3).join(' | '))
    })

    await window.screenshot({ path: join(artifactsDir, 'final-state.png') })
  } finally {
    await app.close().catch(() => undefined)
    rmSync(userData, { recursive: true, force: true })
  }

  if (failed > 0) {
    console.error(`\n✘ ${failed} e2e step(s) failed. Screenshot: e2e/artifacts/final-state.png`)
    process.exit(1)
  }
  console.log('\n✔ e2e smoke passed.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
