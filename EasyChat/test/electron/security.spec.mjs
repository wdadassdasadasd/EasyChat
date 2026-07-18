import { test, expect } from '@playwright/test'
import { launchEasyChat, normalizePath } from './electronHarness.mjs'

test('Electron shell preserves the preload boundary and blocks untrusted navigation', async ({}, testInfo) => {
  const harness = await launchEasyChat({ testInfo })
  const { electronApp, page } = harness

  try {
    expect(normalizePath(harness.actualUserDataDir)).toBe(normalizePath(harness.userDataDir))
    const windowSecurity = await electronApp.evaluate(({ BrowserWindow }) => {
      const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
      return {
        sandbox: preferences.sandbox,
        contextIsolation: preferences.contextIsolation
      }
    })
    expect(windowSecurity).toEqual({ sandbox: true, contextIsolation: true })
    const boundary = await page.evaluate(() => ({
      api: typeof window.api,
      genericIpc: typeof window.ipcRenderer,
      nodeRequire: typeof window.require,
      nodeProcess: typeof window.process
    }))
    expect(boundary).toEqual({ api: 'object', genericIpc: 'undefined', nodeRequire: 'undefined', nodeProcess: 'undefined' })

    const diagnostics = await page.evaluate(() => window.api.invokeGetRuntimeDiagnostics())
    expect(diagnostics.success).toBe(true)
    expect(JSON.stringify(diagnostics)).not.toMatch(/token|userId|filePath|messageContent|https?:\/\//i)

    await electronApp.evaluate(({ shell }) => {
      globalThis.__easyChatExternalUrl = ''
      shell.openExternal = async (url) => {
        globalThis.__easyChatExternalUrl = url
      }
    })
    await page.evaluate(() => window.open('https://example.com/'))
    await expect.poll(() => electronApp.evaluate(() => globalThis.__easyChatExternalUrl)).toBe('https://example.com/')
    expect((await electronApp.windows()).length).toBe(1)

    await page.evaluate(() => {
      window.location.href = 'https://example.org/'
    })
    await expect.poll(() => page.url()).toContain('index.html')
  } finally {
    await harness.close()
  }
})
