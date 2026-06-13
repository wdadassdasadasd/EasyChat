import { describe, expect, it, vi } from 'vitest'

import { restoreOrCreateMainWindow } from '../../src/main/windowLifecycle'

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
