import path from 'path'
import { describe, expect, it, vi } from 'vitest'
import {
  configureAppIdentity,
  hasExplicitUserDataDirectory,
  resolveAppUserDataPath
} from '../../src/main/appIdentity.js'

describe('EasyChat application identity', () => {
  it('uses an independent EasyChat user-data directory', () => {
    const appDataDir = path.join('C:', 'Users', 'alice', 'AppData', 'Roaming')
    expect(resolveAppUserDataPath({ appDataDir, argv: [] })).toBe(
      path.join(appDataDir, 'EasyChat')
    )

    const app = {
      setName: vi.fn(),
      getPath: vi.fn(() => appDataDir),
      setPath: vi.fn()
    }
    expect(configureAppIdentity({ app, argv: [] })).toBe(path.join(appDataDir, 'EasyChat'))
    expect(app.setName).toHaveBeenCalledWith('EasyChat')
    expect(app.setPath).toHaveBeenCalledWith('userData', path.join(appDataDir, 'EasyChat'))
  })

  it('preserves an explicit isolated user-data directory used by tests and demos', () => {
    expect(hasExplicitUserDataDirectory(['--user-data-dir=D:/isolated'])).toBe(true)
    expect(resolveAppUserDataPath({
      appDataDir: 'D:/AppData',
      argv: ['--user-data-dir', 'D:/isolated']
    })).toBeNull()

    const app = {
      setName: vi.fn(),
      getPath: vi.fn(() => 'D:/AppData'),
      setPath: vi.fn()
    }
    configureAppIdentity({ app, argv: ['--user-data-dir=D:/isolated'] })
    expect(app.setName).toHaveBeenCalledWith('EasyChat')
    expect(app.setPath).not.toHaveBeenCalled()
  })
})
