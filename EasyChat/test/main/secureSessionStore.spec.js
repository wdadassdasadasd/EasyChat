import { beforeEach, describe, expect, it, vi } from 'vitest'

const { data, safe } = vi.hoisted(() => ({
  data: new Map(),
  safe: {
    available: true,
    backend: 'gnome_libsecret'
  }
}))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => safe.available,
    getSelectedStorageBackend: () => safe.backend,
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (value) => {
      const plain = value.toString().replace(/^encrypted:/, '')
      if (plain === value.toString()) throw new Error('invalid ciphertext')
      return plain
    }
  }
}))

vi.mock('../../src/main/store', () => ({
  default: {
    setData: (key, value) => data.set(key, value),
    getData: (key) => data.get(key),
    deleteData: (key) => data.delete(key)
  }
}))

describe('secure session store', () => {
  beforeEach(() => {
    data.clear()
    safe.available = true
    safe.backend = 'gnome_libsecret'
  })

  it('persists only encrypted session data and restores it', async () => {
    const { restoreSecureSession, saveSecureSession } = await import('../../src/main/secureSessionStore')
    expect(saveSecureSession({ userId: 'u1', token: 'secret', email: 'u1@example.com' })).toMatchObject({ success: true, persistent: true })
    expect(JSON.stringify(data.get('secureSessionV1'))).not.toContain('secret')
    expect(restoreSecureSession()).toMatchObject({ success: true, session: { userId: 'u1', token: 'secret' } })
  })

  it('does not persist when secure storage is unavailable', async () => {
    const { saveSecureSession } = await import('../../src/main/secureSessionStore')
    safe.available = false
    expect(saveSecureSession({ userId: 'u1', token: 'secret' })).toMatchObject({ success: true, persistent: false, kind: 'secure_storage_unavailable' })
    expect(data.has('secureSessionV1')).toBe(false)
  })
})
