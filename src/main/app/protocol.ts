import { readFileSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { protocol } from 'electron'
import type { AppContext } from '../core/context'

/**
 * Secure asset protocol: dentiva-safe://
 *   fonts/<file>          → bundled fonts (resources/fonts)
 *   temp/<file>           → app temp dir (print documents)
 *   attach/<patient>/<file> → patient attachments (validated)
 *   logo/<file>           → clinic logos
 * Every path is prefix-validated against its root — traversal is impossible.
 */
/**
 * Must run BEFORE app 'ready' — Electron only accepts privileged scheme
 * registration during startup. protocol.handle() below runs after ready.
 */
export function registerSchemePrivilege(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'dentiva-safe',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
    }
  ])
}

export function registerSafeProtocol(ctx: AppContext, fontsDir: string): void {
  const roots: Record<string, string> = {
    fonts: resolve(fontsDir),
    temp: resolve(ctx.paths.tempDir),
    attach: resolve(ctx.paths.attachmentsDir),
    logo: resolve(ctx.paths.logosDir)
  }

  protocol.handle('dentiva-safe', (request) => {
    try {
      const url = new URL(request.url)
      const bucket = url.hostname
      const rest = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      const root = roots[bucket]
      if (!root || !rest) return new Response('Not found', { status: 404 })
      const target = resolve(join(root, rest))
      if (!target.startsWith(root + sep)) return new Response('Forbidden', { status: 403 })
      const stat = statSync(target)
      if (!stat.isFile()) return new Response('Not found', { status: 404 })
      const mime = mimeFor(target)
      // Buffer body (not a Node stream): protocol.handle only documents
      // string/Buffer/WHATWG-ReadableStream bodies, and a Node fs stream cast
      // to ReadableStream is undefined behavior — observed as intermittent
      // ERR_FAILED loads and broken subresource (font) fetches on Linux.
      // Largest served file is a 25 MB attachment, so buffering is safe.
      const body = readFileSync(target)
      const response = new Response(body, {
        headers: { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*' }
      })
      return response
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

function mimeFor(p: string): string {
  const ext = p.toLowerCase().split('.').pop()
  switch (ext) {
    case 'woff2': return 'font/woff2'
    case 'ttf': return 'font/ttf'
    case 'png': return 'image/png'
    case 'jpg': case 'jpeg': return 'image/jpeg'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    case 'bmp': return 'image/bmp'
    case 'pdf': return 'application/pdf'
    case 'html': return 'text/html'
    case 'txt': return 'text/plain'
    case 'csv': return 'text/csv'
    case 'json': return 'application/json'
    default: return 'application/octet-stream'
  }
}
