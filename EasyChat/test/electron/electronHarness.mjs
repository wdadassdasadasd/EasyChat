import { _electron as electron } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { shouldRetryRendererStartup } from './startupPolicy.mjs'

const STARTUP_STEP_TIMEOUT = 8000
const MAX_STARTUP_ATTEMPTS = 2
const DIAGNOSTIC_LIMIT = 6000

const electronExecutable = path.join(
  process.cwd(),
  'node_modules',
  'electron',
  'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron'
)

const testOnlyChromiumArgs = process.platform === 'win32' ? ['--no-sandbox'] : []

const normalizePath = (value) => {
  const normalized = path.normalize(String(value || ''))
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

const sanitizeDiagnosticText = (value, paths = []) => {
  let output = String(value || '')
  paths.filter(Boolean).forEach((targetPath) => {
    output = output.replaceAll(String(targetPath), '<isolated-path>')
  })
  output = output.replace(/(token|authorization)=\S+/gi, '$1=<redacted>')
  return output.slice(-DIAGNOSTIC_LIMIT)
}

const withTimeout = async (operation, label, timeout = STARTUP_STEP_TIMEOUT) => {
  let timer = null
  const timeoutError = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeout}ms`)), timeout)
  })

  try {
    return await Promise.race([operation, timeoutError])
  } finally {
    clearTimeout(timer)
  }
}

const installStartupDiagnostics = async (electronApp) => {
  await electronApp.evaluate(({ app }) => {
    globalThis.__easyChatE2eStartupEvents = []
    app.on('render-process-gone', (_event, webContents, details) => {
      globalThis.__easyChatE2eStartupEvents.push({
        type: 'render-process-gone',
        reason: details?.reason || '',
        exitCode: Number(details?.exitCode || 0)
      })
    })
    app.on('child-process-gone', (_event, details) => {
      globalThis.__easyChatE2eStartupEvents.push({
        type: 'child-process-gone',
        processType: details?.type || '',
        reason: details?.reason || '',
        exitCode: Number(details?.exitCode || 0)
      })
    })
  })
}

const readStartupEvents = async (electronApp) => {
  return await electronApp.evaluate(() => globalThis.__easyChatE2eStartupEvents || [])
}

const readRendererState = async (electronApp) => {
  return await electronApp.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows().map((window) => ({
      crashed: window.webContents.isCrashed(),
      destroyed: window.webContents.isDestroyed(),
      loading: window.webContents.isLoading()
    }))
  })
}

const readPageState = async (page) => {
  if (!page) return null
  return await withTimeout(
    page.evaluate(() => ({ readyState: document.readyState, hasPreloadApi: typeof window.api === 'object' })),
    'Electron renderer state read',
    1000
  ).catch(() => null)
}

const closeElectron = async (electronApp, label) => {
  if (!electronApp) return
  const childProcess = electronApp.process()
  await withTimeout(electronApp.close(), label, 2000).catch(() => {})
  if (childProcess?.exitCode === null && !childProcess.killed) {
    childProcess.kill()
  }
  if (childProcess?.exitCode === null) {
    await withTimeout(
      new Promise((resolve) => childProcess.once('exit', resolve)),
      `${label} process exit`,
      2000
    ).catch(() => {})
  }
}

const removeIsolationRoot = (rootDir) => {
  try {
    fs.rmSync(rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  } catch {
    // Windows may retain a Chromium cache lock after a failed renderer launch.
    // Do not hide the original startup diagnostics with a best-effort cleanup error.
  }
}

const closeAndRemove = async (electronApp, rootDir) => {
  await closeElectron(electronApp, 'Electron shutdown')
  removeIsolationRoot(rootDir)
}

const attachStartupDiagnostics = async (testInfo, diagnostics) => {
  if (!testInfo?.attach) return
  await testInfo.attach('electron-startup-diagnostics', {
    body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
    contentType: 'application/json'
  })
}

const launchEasyChat = async ({ testInfo } = {}) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easychat-electron-'))
  const userDataDir = path.join(rootDir, 'chromium-profile')
  const cacheDir = path.join(rootDir, 'chromium-cache')
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.mkdirSync(cacheDir, { recursive: true })
  const failedAttempts = []

  for (let attempt = 0; attempt < MAX_STARTUP_ATTEMPTS; attempt += 1) {
    let electronApp = null
    let page = null
    const stderr = []
    const rendererLogs = []
    try {
      electronApp = await electron.launch({
        executablePath: electronExecutable,
        args: [
          'out/main/index.js',
          `--user-data-dir=${userDataDir}`,
          `--disk-cache-dir=${cacheDir}`,
          '--disable-gpu',
          '--noerrdialogs',
          // Some managed Windows hosts terminate Chromium's OS sandbox with
          // STATUS_BREAKPOINT before preload can run. This is test-only: the
          // BrowserWindow production configuration remains sandboxed.
          ...testOnlyChromiumArgs
        ],
        cwd: process.cwd(),
        env: { ...process.env, NODE_ENV: 'test', EASYCHAT_DATA_ROOT: rootDir }
      })
      electronApp.process().stderr?.on('data', (data) => stderr.push(String(data)))
      await withTimeout(installStartupDiagnostics(electronApp), 'Electron main-process diagnostics setup')

      page = await withTimeout(electronApp.firstWindow(), 'Electron first window')
      page.on('console', (message) => rendererLogs.push(`${message.type()}: ${message.text()}`))
      page.on('pageerror', (error) => rendererLogs.push(`pageerror: ${error.message}`))
      await page.waitForFunction(
        () => typeof window.api === 'object',
        undefined,
        { timeout: STARTUP_STEP_TIMEOUT }
      )
      const actualUserDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
      return {
        electronApp,
        page,
        rootDir,
        userDataDir,
        cacheDir,
        actualUserDataDir,
        attempts: attempt + 1,
        close: async () => closeAndRemove(electronApp, rootDir)
      }
    } catch (error) {
      const events = electronApp
        ? await withTimeout(readStartupEvents(electronApp), 'Electron startup diagnostics read', 1000).catch(() => [])
        : []
      const rendererState = electronApp
        ? await withTimeout(readRendererState(electronApp), 'Electron renderer state read', 1000).catch(() => [])
        : []
      const diagnostics = {
        attempt: attempt + 1,
        error: sanitizeDiagnosticText(error?.message || error, [rootDir, userDataDir, cacheDir]),
        events,
        rendererState,
        pageState: await readPageState(page),
        stderr: sanitizeDiagnosticText(stderr.join(''), [rootDir, userDataDir, cacheDir]),
        rendererLogs: sanitizeDiagnosticText(rendererLogs.join('\n'), [rootDir, userDataDir, cacheDir])
      }
      failedAttempts.push(diagnostics)
      const retry = shouldRetryRendererStartup({ attempt, events, rendererState })
      await closeElectron(electronApp, 'Electron failed-startup shutdown')
      if (retry) continue

      await attachStartupDiagnostics(testInfo, failedAttempts)
      removeIsolationRoot(rootDir)
      throw new Error(`Electron renderer startup failed: ${JSON.stringify(diagnostics)}`)
    }
  }

  await attachStartupDiagnostics(testInfo, failedAttempts)
  removeIsolationRoot(rootDir)
  throw new Error('Electron renderer startup failed after one recovery attempt')
}

export { launchEasyChat, normalizePath, sanitizeDiagnosticText }
