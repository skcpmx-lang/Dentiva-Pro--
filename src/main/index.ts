import { app, BrowserWindow, dialog, ipcMain, nativeImage, powerMonitor, shell } from 'electron'
import { appendFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { extname, join } from 'node:path'
import { buildPaths } from './core/paths'
import { openDatabase, migrate } from './core/db'
import { seed } from './core/seed'
import { createLogger } from './app/logger'
import { PrintManager } from './app/print'
import { registerSafeProtocol } from './app/protocol'
import { dispatch, type PlatformBridge, type RouterDeps } from './ipc/router'
import { SessionManager } from './services/auth'
import { getSettings } from './services/settings'
import { maybeRunScheduledBackup } from './services/backup'
import { generateStartupNotifications } from './services/notifications'

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

const APP_VERSION = app.getVersion()

let mainWindow: BrowserWindow | null = null
let quitReady = false

/* ---------------- Boot ---------------- */

function fontsDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'fonts') : join(app.getAppPath(), 'resources', 'fonts')
}

function createPlatformBridge(): PlatformBridge {
  const pickOpenFile = async (filters: { name: string; extensions: string[] }[]): Promise<string | null> => {
    const r = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile'], filters })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  }
  return {
    pickOpenFile,
    pickSaveFile: async (defaultName, filters) => {
      const r = await dialog.showSaveDialog(mainWindow!, { defaultPath: defaultName, filters })
      return r.canceled || !r.filePath ? null : r.filePath
    },
    pickFolder: async () => {
      const r = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'] })
      return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
    },
    openPath: (p) => {
      void shell.openPath(p)
    },
    listPrinters: async () => {
      if (!mainWindow) return []
      const printers = await mainWindow.webContents.getPrintersAsync()
      return printers.map((p) => ({
        name: p.name,
        description: p.description,
        isDefault: (p as unknown as { isDefault?: boolean }).isDefault ?? false
      }))
    },
    saveTextFile: async (contents, defaultName) => {
      const r = await dialog.showSaveDialog(mainWindow!, { defaultPath: defaultName, filters: [{ name: 'CSV file', extensions: ['csv'] }] })
      if (r.canceled || !r.filePath) return null
      const { writeFileSync } = await import('node:fs')
      writeFileSync(r.filePath, '\uFEFF' + contents, 'utf8')
      return r.filePath
    },
    validateAndStoreImage: async (sourcePath, destDir, maxBytes) => {
      try {
        const { statSync } = await import('node:fs')
        const st = statSync(sourcePath)
        if (st.size > maxBytes) return null
        const img = nativeImage.createFromPath(sourcePath)
        if (img.isEmpty()) return null
        const ext = extname(sourcePath).toLowerCase()
        if (!['.png', '.jpg', '.jpeg', '.webp', '.bmp'].includes(ext)) return null
        mkdirSync(destDir, { recursive: true })
        const name = `logo-${randomUUID()}${ext}`
        copyFileSync(sourcePath, join(destDir, name))
        return name
      } catch {
        return null
      }
    }
  }
}

function createMainWindow(): BrowserWindow {
  const isWin = process.platform === 'win32'
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 720,
    show: false,
    backgroundColor: '#F4F6F8',
    title: 'Dentiva Pro',
    icon: join(__dirname, '../../build/icon.png'),
    autoHideMenuBar: true,
    ...(isWin ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#0C2B2C', symbolColor: '#E6F4F1', height: 40 } } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // Security: block all navigation away from the app and all new windows.
  win.webContents.on('will-navigate', (e, url) => {
    const allowed = url.startsWith('http://localhost:') || url.startsWith('file://') || url.startsWith('dentiva-safe://')
    if (!allowed) e.preventDefault()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  win.on('closed', () => {
    mainWindow = null
  })
  return win
}

/* ---------------- App lifecycle ---------------- */

void app.whenReady().then(() => {
  const dataDir = app.getPath('userData')
  const paths = buildPaths(dataDir)
  for (const dir of [paths.dataDir, paths.attachmentsDir, paths.backupsDir, paths.logsDir, paths.tempDir, paths.logosDir]) {
    mkdirSync(dir, { recursive: true })
  }
  const logger = createLogger(paths.logsDir)
  logger.info('app', `Dentiva Pro starting (v${APP_VERSION})`, { dataDir })

  const db = openDatabase(paths.dbPath)
  const version = migrate(db)
  seed(db)
  logger.info('app', `Database ready (schema v${version})`)

  const ctx = { db, paths, clock: () => new Date(), appVersion: APP_VERSION }
  const sessions = new SessionManager()
  const print = new PrintManager(ctx, 'dentiva-safe://fonts')

  registerSafeProtocol(ctx, fontsDir())

  const deps: RouterDeps = {
    ctx,
    sessions,
    platform: createPlatformBridge(),
    print,
    logger,
    reloadAfterRestore: () => {
      sessions.lockAll()
      mainWindow?.webContents.send('dentiva:event', { type: 'restored' })
      mainWindow?.webContents.reload()
    }
  }

  ipcMain.handle('dentiva:invoke', (event, channel: string, token: string | null, payload: unknown) => {
    if (event.senderFrame?.url && !isTrustedSender(event.senderFrame.url)) {
      logger.warn('security', `IPC call from untrusted sender: ${event.senderFrame.url}`)
      return { ok: false, code: 'ERR_UNAUTHORIZED' as const, message: 'Untrusted source.' }
    }
    return dispatch(deps, channel, token, payload)
  })

  // Auto-lock via system-wide idle time (AD-008).
  setInterval(() => {
    try {
      const idleSeconds = powerMonitor.getSystemIdleTime()
      const autoLockMinutes = getSettings(ctx).security.autoLockMinutes
      if (autoLockMinutes > 0 && idleSeconds >= autoLockMinutes * 60) {
        const anyUnlocked = [...(sessions as unknown as Map<string, { locked: boolean }>).values()].some((s) => !s.locked)
        if (anyUnlocked) {
          sessions.lockAll()
          mainWindow?.webContents.send('dentiva:event', { type: 'locked' })
          logger.info('security', 'Application auto-locked (idle)')
        }
      }
    } catch {
      /* powerMonitor issues must never crash the app */
    }
  }, 20_000)

  // Startup housekeeping: scheduled backups + notification sweep.
  void maybeRunScheduledBackup(ctx).catch((e) => logger.error('backup', 'Scheduled backup failed', { message: e instanceof Error ? e.message : String(e) }))
  try {
    generateStartupNotifications(ctx)
  } catch (e) {
    logger.warn('app', 'Startup notifications failed', { message: e instanceof Error ? e.message : String(e) })
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  mainWindow = createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
  })
})

function isTrustedSender(url: string): boolean {
  return url.startsWith('http://localhost:') || url.startsWith('file://') || url.startsWith('app://')
}

app.on('window-all-closed', () => {
  quitReady = true
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (quitReady) return
  quitReady = true
})

process.on('uncaughtException', (err) => {
  try {
    const logsDir = join(app.getPath('userData'), 'logs')
    mkdirSync(logsDir, { recursive: true })
    appendFileSync(join(logsDir, 'crash.log'), `${new Date().toISOString()} ${err.stack ?? err.message}\n`)
  } catch {
    /* last-resort crash log */
  }
})
