#!/usr/bin/env node
/**
 * print-geometry-main.cjs — Electron entry for the print geometry suite.
 * Loaded directly by the electron binary (electron e2e/print-geometry-main.cjs).
 * Requires the esbuild bundle produced by e2e/print-geometry.mjs.
 */
const { app } = require('electron')
const fs = require('node:fs')

const bundlePath = process.env.PG_BUNDLE
const resultPath = process.env.PG_RESULT
const dataDir = process.env.PG_DATA
const fontsDir = process.env.PG_FONTS

if (!bundlePath || !resultPath || !dataDir || !fontsDir) {
  console.error('PG_BUNDLE, PG_RESULT, PG_DATA and PG_FONTS must be set.')
  process.exit(2)
}

// Linux CI printing: default Chromium rendering paths work under a 24-bit
// Xvfb (llvmpipe/SwiftShader); forcing software rendering via
// app.disableHardwareAcceleration()/--disable-gpu was tried and did NOT fix
// the compositor failure, so defaults are kept. This is the test-runner
// binary only — the shipped app keeps default settings.

// Scheme privileges must be registered before app 'ready'.
let bundle
try {
  bundle = require(bundlePath)
  bundle.registerSchemePrivilege()
} catch (e) {
  fs.writeFileSync(resultPath, JSON.stringify({ cases: [], crashed: `bundle load failed: ${e && e.stack ? e.stack : e}` }))
  process.exit(1)
}

app.whenReady().then(async () => {
  let out
  try {
    out = await bundle.runPrintGeometryTests({ dataDir, fontsDir })
  } catch (e) {
    out = { cases: [], crashed: e && e.stack ? e.stack : String(e) }
  }
  try {
    fs.writeFileSync(resultPath, JSON.stringify(out, null, 2))
  } catch (e) {
    console.error('failed to write result:', e)
  }
  const failed = (out.crashed ? 1 : 0) + (out.cases ?? []).filter((c) => !c.ok).length
  app.exit(failed > 0 ? 1 : 0)
}).catch((e) => {
  try {
    fs.writeFileSync(resultPath, JSON.stringify({ cases: [], crashed: `app ready failed: ${e && e.stack ? e.stack : e}` }))
  } catch {}
  process.exit(1)
})
