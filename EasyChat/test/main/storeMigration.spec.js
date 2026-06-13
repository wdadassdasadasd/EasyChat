import fs from 'fs'
import os from 'os'
import path from 'path'
import Conf from 'conf'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { STORE_OBFUSCATION_KEY, migratePlaintextStore } from '../../src/main/storeMigration'

const tempDirectories = []

afterEach(() => {
  tempDirectories.splice(0).forEach((directory) => {
    fs.rmSync(directory, { recursive: true, force: true })
  })
})

describe('migratePlaintextStore', () => {
  it('rewrites a legacy JSON snapshot without dropping keys', () => {
    const snapshot = {
      u1token: 'secret-token',
      u1localReplaceRecoveryQueue: [{ localMessageId: -1 }],
      u1uploadSourceRegistry: { source: { filePath: 'D:/selected/a.txt' } }
    }
    const store = { path: 'config.json' }
    const readFileSync = vi.fn(() => JSON.stringify(snapshot))

    expect(migratePlaintextStore(store, { readFileSync })).toBe(true)
    expect(store.store).toEqual(snapshot)
  })

  it('leaves encrypted or invalid content untouched', () => {
    const store = { path: 'config.json' }
    const readFileSync = vi.fn(() => Buffer.from([1, 2, 3, 4]))

    expect(migratePlaintextStore(store, { readFileSync })).toBe(false)
    expect(store).not.toHaveProperty('store')
  })

  it('rewrites a plaintext config so credentials are no longer readable JSON', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'easychat-store-'))
    tempDirectories.push(cwd)
    const configPath = path.join(cwd, 'config.json')
    fs.writeFileSync(
      configPath,
      JSON.stringify({ u1token: 'secret-token', u1localFileFolder: 'D:/chat' })
    )
    const store = new Conf({
      configName: 'config',
      cwd,
      encryptionKey: STORE_OBFUSCATION_KEY
    })

    expect(migratePlaintextStore(store)).toBe(true)

    const raw = fs.readFileSync(configPath)
    expect(raw.toString('utf8')).not.toContain('secret-token')
    expect(store.get('u1token')).toBe('secret-token')
    expect(store.get('u1localFileFolder')).toBe('D:/chat')
  })
})
