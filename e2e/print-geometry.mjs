#!/usr/bin/env node
/**
 * print-geometry.mjs — driver for the print/PDF geometry test suite.
 *
 *   node e2e/print-geometry.mjs
 *
 * Bundles the real PrintManager + protocol + print templates with esbuild,
 * then runs them inside the real Electron binary (hidden windows, real
 * dentiva-safe:// protocol, real Chromium printToPDF) and asserts MediaBox
 * geometry, Bengali font embedding, logo embedding, pagination and the
 * input-validation/anti-abuse guards.
 *
 * Requires a display (on headless Linux: xvfb-run -a node e2e/print-geometry.mjs)
 * and the installed electron binary (present after npm ci).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

function die(msg) {
  console.error(`✘ ${msg}`)
  process.exit(1)
}

async function main() {
  // 1. Bundle the real print pipeline + templates (TS, path aliases via tsconfig).
  const esbuild = require('esbuild')
  const outfile = join(root, 'e2e', '.print-geometry-bundle.cjs')
  esbuild.buildSync({
    entryPoints: [join(root, 'e2e', 'print-geometry-entry.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    outfile,
    tsconfig: join(root, 'tsconfig.node.json'),
    logLevel: 'silent'
  })
  console.log('→ bundled print pipeline (esbuild)')

  // 2. Throwaway data dir + result file.
  const dataDir = mkdtempSync(join(root, 'e2e', '.pgdata-'))
  const resultPath = join(dataDir, 'result.json')
  const fontsDir = join(root, 'resources', 'fonts')

  let electronBin
  try {
    electronBin = require('electron')
  } catch {
    die('the electron package did not export a binary path — run npm ci first')
  }
  if (!existsSync(String(electronBin))) die(`electron binary not found at ${electronBin}`)

  // 3. Run inside Electron.
  console.log('→ running print geometry suite inside Electron…\n')
  const run = spawnSync(String(electronBin), [join(root, 'e2e', 'print-geometry-main.cjs')], {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
      PG_BUNDLE: outfile,
      PG_RESULT: resultPath,
      PG_DATA: dataDir,
      PG_FONTS: fontsDir,
      NODE_ENV: 'test',
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1'
    },
    timeout: 180_000
  })

  let result
  try {
    result = JSON.parse(readFileSync(resultPath, 'utf8'))
  } catch {
    die(`no result file produced (electron status=${run.status}, signal=${run.signal})`)
  }

  const cases = result.cases ?? []
  const failed = cases.filter((c) => !c.ok)
  for (const c of cases) console.log(`  ${c.ok ? '✔' : '✘'} ${c.name}${!c.ok && c.detail ? ` — ${c.detail}` : ''}`)

  rmSync(dataDir, { recursive: true, force: true })
  rmSync(outfile, { force: true })

  if (result.crashed) {
    console.error(`\n✘ SUITE CRASHED:\n${result.crashed}`)
    process.exit(1)
  }
  console.log(`\nPrint geometry suite: ${cases.length - failed.length}/${cases.length} passed`)
  if (failed.length > 0 || run.status !== 0) {
    process.exit(1)
  }
}

main().catch((e) => die(e instanceof Error ? e.stack : String(e)))
