import { describe, expect, it, vi } from 'vitest'

import { openExternalHttpUrl, restoreOrCreateMainWindow } from '../../src/main/windowLifecycle'

describe('restoreOrCreateMainWindow', () => {
  it('restores, shows, and focuses an existing window', () => {
    const mainWindow = {
      focus: vi.fn(),
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      setSkipTaskbar: vi.fn(),
      show: vi.fn()
    }
    const createWindow = vi.fn()
    const BrowserWindow = {
      getAllWindows: vi.fn(() => [mainWindow])
    }

    expect(restoreOrCreateMainWindow({ BrowserWindow, createWindow })).toBe(mainWindow)
    expect(mainWindow.restore).toHaveBeenCalled()
    expect(mainWindow.setSkipTaskbar).toHaveBeenCalledWith(false)
    expect(mainWindow.show).toHaveBeenCalled()
    expect(mainWindow.focus).toHaveBeenCalled()
    expect(createWindow).not.toHaveBeenCalled()
  })

  it('creates a window only when none exists', () => {
    const createdWindow = {}
    const createWindow = vi.fn(() => createdWindow)
    const BrowserWindow = {
      getAllWindows: vi.fn(() => [])
    }

    expect(restoreOrCreateMainWindow({ BrowserWindow, createWindow })).toBe(createdWindow)
    expect(createWindow).toHaveBeenCalledTimes(1)
  })
})

describe('openExternalHttpUrl', () => {
  it('opens only http and https URLs', async () => {
    const shell = { openExternal: vi.fn(async () => {}) }

    await expect(openExternalHttpUrl({ shell, url: 'https://example.com/help' })).resolves.toBe(
      true
    )
    await expect(
      openExternalHttpUrl({ shell, url: 'file:///C:/Windows/System32/calc.exe' })
    ).resolves.toBe(false)
    await expect(openExternalHttpUrl({ shell, url: 'javascript:alert(1)' })).resolves.toBe(false)

    expect(shell.openExternal).toHaveBeenCalledTimes(1)
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/help')
  })

  it('contains external-open failures', async () => {
    const shell = { openExternal: vi.fn(async () => Promise.reject(new Error('denied'))) }

    await expect(openExternalHttpUrl({ shell, url: 'https://example.com/help' })).resolves.toBe(
      false
    )
  })
})
