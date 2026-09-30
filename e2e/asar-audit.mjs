#!/usr/bin/env node
/**
 * asar-audit.mjs — audits the packaged application contents produced by
 * electron-builder (release/<platform>-unpacked) for release hygiene:
 *
 *   1. No development / test / documentation / source files inside app.asar.
 *   2. No dev-only npm packages, no .bin scripts, no node_modules/.package-lock.
 *   3. No sourcemap references (sourceMappingURL) in shipped JS.
 *   4. No secret-shaped strings (private keys, AWS keys, GitHub/npm/OpenAI/
 *      Slack tokens) anywhere in shipped text files.
 *   5. The better-sqlite3 native prebuild is present OUTSIDE the asar
 *      (asarUnpack) for the packaging platform.
 *
 * Usage: node e2e/asar-audit.mjs [release-dir]   (default: release/win-unpacked)
 * Exit code 0 = clean, 1 = findings.
 */
import { existsSync, statSync, readdirSync, rmSync, readFileSync } from 'node:fs'
import { join, relative, basename, extname } from 'node:path'
import { tmpdir } from 'node:os'
import asar from '@electron/asar'

const releaseDir = process.argv[2] ?? 'release/win-unpacked'
const resourcesDir = join(releaseDir, 'resources')
const asarPath = join(resourcesDir, 'app.asar')
const unpackedDir = asarPath + '.unpacked'

if (!existsSync(asarPath)) {
  console.error(`FATAL: ${asarPath} not found — run electron-builder first.`)
  process.exit(1)
}

const failures = []
const notes = []
const fail = (msg) => failures.push(msg)

// ---------------------------------------------------------------- 1. listing
// asar entries use backslashes on Windows and may carry a leading slash —
// normalize to forward-slash relative paths for all checks below.
const entries = asar
  .listPackage(asarPath)
  .map((e) => String(e).replace(/\\/g, '/').replace(/^\//, ''))
console.log(`Archive: ${asarPath}`)
console.log(`Total entries: ${entries.length}`)

const topLevel = new Set(entries.map((e) => e.split('/')[0]))
console.log(`Top-level: ${[...topLevel].sort().join(', ')}`)

const FORBIDDEN_PREFIXES = [
  'tests/', 'e2e/', 'docs/', 'scripts/', '.github/', 'src/', 'coverage/',
  'node_modules/.bin/', 'node_modules/.cache/', 'node_modules/.package-lock.json'
]
const FORBIDDEN_SUFFIXES = ['.ts', '.map', '.env', '.log', '.snap', '.test.js', '.spec.js', '.test.cjs', '.spec.cjs', '.test.mjs', '.spec.mjs']
const FORBIDDEN_DIR_SEGMENTS = ['__tests__', 'test', 'tests']
const FORBIDDEN_EXACT = ['.editorconfig', '.eslintrc.cjs', '.gitignore', 'electron-builder.yml', 'vitest.config.ts', 'tsconfig.json', 'tsconfig.node.json', 'tsconfig.web.json']

for (const e of entries) {
  if (FORBIDDEN_PREFIXES.some((p) => e === p.slice(0, -1) || e.startsWith(p))) fail(`forbidden path in asar: ${e}`)
  if (FORBIDDEN_SUFFIXES.some((s) => e.endsWith(s))) fail(`forbidden file type in asar: ${e}`)
  if (FORBIDDEN_EXACT.includes(basename(e)) && !e.includes('/')) fail(`repo file leaked into asar root: ${e}`)
  // test directories anywhere (e.g. node_modules/<pkg>/tests/)
  if (e.startsWith('node_modules/')) {
    const segs = e.split('/')
    if (segs.slice(2, -1).some((s) => FORBIDDEN_DIR_SEGMENTS.includes(s))) fail(`test directory packaged inside node_modules: ${e}`)
  }
}

// ------------------------------------------------------- 2. dev-only packages
const DEV_PACKAGES = [
  'electron', 'electron-vite', 'electron-builder', 'app-builder-lib', 'builder-util',
  'vitest', '@vitest', 'eslint', 'playwright', '@playwright', 'typescript', '@types',
  '@electron/asar', 'vite', 'rollup', 'esbuild', 'dmg-builder', 'sudo-prompt',
  '@electron/notarize', '@electron/osx-sign', '@electron/universal'
]
for (const e of entries) {
  if (e.startsWith('node_modules/')) {
    const seg = e.split('/').slice(1)
    const pkg = seg[0].startsWith('@') ? seg.slice(0, 2).join('/') : seg[0]
    if (DEV_PACKAGES.includes(pkg)) fail(`dev-only package packaged: ${pkg} (${e})`)
  }
}

const expectedProd = ['better-sqlite3', 'archiver', 'extract-zip', 'zod']
const packaged = new Set(entries.filter((e) => e.startsWith('node_modules/')).map((e) => {
  const seg = e.split('/').slice(1)
  return seg[0].startsWith('@') ? seg.slice(0, 2).join('/') : seg[0]
}))
console.log(`Production packages in asar: ${[...packaged].sort().join(', ')}`)
for (const p of expectedProd) if (!packaged.has(p)) fail(`expected production package missing from asar: ${p}`)

// ------------------------------------------------------------ 3+4. extraction
const extractDir = join(tmpdir(), `dentiva-asar-audit-${Date.now()}`)
asar.extractAll(asarPath, extractDir)

const SECRET_PATTERNS = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/, 'private key material'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key id'],
  [/gh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/sk-(?:proj-)?[A-Za-z0-9_-]{20,}/, 'OpenAI-style API key'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token']
]
// Sourcemap references are only release-blocking in OUR bundles (out/**):
// third-party libs ship dangling references to .map files that are excluded
// from the package — no source is disclosed. Those are reported as notes.
const SOURCEMAP_PATTERN = [/sourceMappingURL=/, 'sourcemap reference']

const TEXT_EXTS = ['.js', '.json', '.html', '.css', '.txt', '.md']
let thirdPartySourcemapRefs = 0
const scanFile = (abs) => {
  if (statSync(abs).size > 12 * 1024 * 1024) return // skip anything absurdly large
  let content
  try { content = readFileSync(abs, 'utf8') } catch { return }
  const rel = relative(extractDir, abs).split('\\').join('/')
  const isOurBundle = rel.startsWith('out/')
  for (const [re, label] of SECRET_PATTERNS) {
    const m = content.match(re)
    if (m) fail(`${label} found in ${rel} (near ${JSON.stringify(m[0].slice(0, 40))})`)
  }
  if (SOURCEMAP_PATTERN[0].test(content)) {
    if (isOurBundle) fail(`${SOURCEMAP_PATTERN[1]} found in our bundle ${rel} (sourcemaps must not ship)`)
    else thirdPartySourcemapRefs++
  }
}
const walk = (dir) => {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, f.name)
    if (f.isDirectory()) walk(abs)
    else if (TEXT_EXTS.includes(extname(f.name)) || f.name === 'package.json') scanFile(abs)
  }
}
walk(extractDir)
rmSync(extractDir, { recursive: true, force: true })

// --------------------------------------------------- 5. native prebuild unpacked
if (!existsSync(unpackedDir)) {
  fail('app.asar.unpacked directory missing — native module would not load')
} else {
  const prebuildsDir = join(unpackedDir, 'node_modules', 'better-sqlite3', 'prebuilds')
  const found = existsSync(prebuildsDir) ? readdirSync(prebuildsDir).filter((f) => f.endsWith('.node')) : []
  if (found.length === 0) fail('no better-sqlite3 .node prebuild in app.asar.unpacked')
  else console.log(`Native prebuilds (outside asar): ${found.join(', ')}`)
}

// ------------------------------------------------------------------- fonts
// extraResources puts fonts at resources/fonts — verify the Bengali font ships.
const fontsDir = join(resourcesDir, 'fonts')
const fonts = existsSync(fontsDir) ? readdirSync(fontsDir) : []
console.log(`Bundled fonts (resources/fonts): ${fonts.join(', ') || '(none)'}`)
if (!fonts.some((f) => /bengali/i.test(f))) notes.push('Bengali font not found in resources/fonts — print/pdf Bengali rendering would fall back to system fonts')

// ------------------------------------------------------------------ summary
console.log('')
if (thirdPartySourcemapRefs > 0) notes.push(`${thirdPartySourcemapRefs} dangling sourceMappingURL comment(s) in bundled third-party libs (their .map files are excluded from the package — no source disclosed)`)
if (notes.length) { console.log('Notes:'); for (const n of notes) console.log(`  - ${n}`) }
if (failures.length) {
  console.error(`ASAR AUDIT FAILED — ${failures.length} finding(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('ASAR AUDIT PASSED — no dev/test/source-map/secret content in the packaged app.')
