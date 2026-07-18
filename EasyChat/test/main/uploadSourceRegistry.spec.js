import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ registry: undefined }))
const safe = vi.hoisted(() => ({ available: true }))
const fileStat = vi.hoisted(() => ({
  value: { isFile: () => true, size: 12, mtimeMs: 1000 }
}))
const sourceBytes = vi.hoisted(() => ({ value: Buffer.alloc(12, 7) }))
const fileHandle = vi.hoisted(() => ({
  close: vi.fn(async () => {}),
  read: vi.fn(async (buffer, _offset, length, position) => {
    sourceBytes.value.copy(buffer, 0, position, position + length)
    return { bytesRead: length }
  })
}))

vi.mock('electron', () => ({
  safeStorage: {
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (value) => {
      const plain = value.toString().replace(/^encrypted:/, '')
      if (plain === value.toString()) throw new Error('invalid ciphertext')
      return plain
    }
  }
}))

vi.mock('../../src/main/secureSessionStore', () => ({
  getSecureStorageStatus: () => ({
    available: safe.available,
    kind: safe.available ? 'secure_storage_available' : 'secure_storage_unavailable'
  })
}))

vi.mock('../../src/main/store', () => ({
  default: {
    getUserId: vi.fn(() => 'u1'),
    getUserData: vi.fn(() => state.registry),
    getUserDataForUser: vi.fn(() => state.registry),
    setUserData: vi.fn((_key, value) => {
      state.registry = value
    }),
    setUserDataForUser: vi.fn((...args) => {
      state.registry = args[2]
    }),
    deleteUserDataForUser: vi.fn(() => {
      state.registry = undefined
    })
  }
}))

vi.mock('fs', () => ({
  default: {
    promises: {
      open: vi.fn(async () => fileHandle),
      stat: vi.fn(async () => fileStat.value)
    }
  }
}))

describe('uploadSourceRegistry', () => {
  beforeEach(() => {
    vi.resetModules()
    state.registry = undefined
    safe.available = true
    fileStat.value = { isFile: () => true, size: 12, mtimeMs: 1000 }
    sourceBytes.value = Buffer.alloc(12, 7)
    vi.clearAllMocks()
  })

  it('registers a selected source and reads only bounded chunks by source id', async () => {
    const { readUploadSourceChunk, registerUploadSource } =
      await import('../../src/main/uploadSourceRegistry')
    const registered = await registerUploadSource({
      filePath: 'D:/selected/a.txt',
      name: 'a.txt',
      size: 12,
      type: 'text/plain'
    })

    const result = await readUploadSourceChunk({
      uploadSourceId: registered.uploadSourceId,
      start: 2,
      end: 8
    })

    expect(result.success).toBe(true)
    expect(result.arrayBuffer.byteLength).toBe(6)
    expect(state.registry).toMatchObject({ version: 1, ciphertext: expect.any(String) })
    expect(JSON.stringify(state.registry)).not.toContain('D:/selected/a.txt')
  })

  it('rejects unknown ids and invalid ranges', async () => {
    const { readUploadSourceChunk, registerUploadSource } =
      await import('../../src/main/uploadSourceRegistry')
    await expect(
      readUploadSourceChunk({ uploadSourceId: 'missing', start: 0, end: 1 })
    ).rejects.toThrow('Unknown upload source')

    const registered = await registerUploadSource({
      filePath: 'D:/selected/a.txt',
      name: 'a.txt',
      size: 12
    })
    await expect(
      readUploadSourceChunk({
        uploadSourceId: registered.uploadSourceId,
        start: 0,
        end: 13
      })
    ).rejects.toThrow('Invalid upload source range')
  })

  it('rejects a same-sized source file that changed after registration', async () => {
    const { readUploadSourceChunk, registerUploadSource } =
      await import('../../src/main/uploadSourceRegistry')
    const registered = await registerUploadSource({
      filePath: 'D:/selected/a.txt',
      name: 'a.txt',
      size: 12,
      lastModified: 1000
    })
    fileStat.value = { isFile: () => true, size: 12, mtimeMs: 5000 }

    await expect(
      readUploadSourceChunk({ uploadSourceId: registered.uploadSourceId, start: 0, end: 1 })
    ).rejects.toThrow('Upload source is unavailable or has changed')
  })

  it('rejects a same-sized source whose content changes without an mtime gap', async () => {
    const { readUploadSourceChunk, registerUploadSource } =
      await import('../../src/main/uploadSourceRegistry')
    const registered = await registerUploadSource({
      filePath: 'D:/selected/a.txt',
      name: 'a.txt',
      size: 12,
      lastModified: 1000
    })
    sourceBytes.value = Buffer.alloc(12, 8)

    await expect(
      readUploadSourceChunk({ uploadSourceId: registered.uploadSourceId, start: 0, end: 1 })
    ).rejects.toThrow('Upload source is unavailable or has changed')
  })

  it('releases persisted source mappings after upload completion', async () => {
    const { registerUploadSource, releaseUploadSource } =
      await import('../../src/main/uploadSourceRegistry')
    const registered = await registerUploadSource({
      filePath: 'D:/selected/a.txt',
      name: 'a.txt',
      size: 12
    })

    expect(releaseUploadSource({ uploadSourceId: registered.uploadSourceId })).toEqual({
      success: true,
      released: true
    })
    const registry = JSON.parse(
      Buffer.from(state.registry.ciphertext, 'base64').toString().replace(/^encrypted:/, '')
    )
    expect(registry[registered.uploadSourceId]).toBeUndefined()
  })

  it('pins active sources and unpins terminal sources for the owning user', async () => {
    const { registerUploadSource, setUploadSourcePinned } =
      await import('../../src/main/uploadSourceRegistry')
    const registered = await registerUploadSource({
      filePath: 'D:/selected/a.txt',
      name: 'a.txt',
      size: 12
    })

    expect(setUploadSourcePinned({ uploadSourceId: registered.uploadSourceId, userId: 'u1', pinned: true })).toBe(true)
    let registry = JSON.parse(
      Buffer.from(state.registry.ciphertext, 'base64').toString().replace(/^encrypted:/, '')
    )
    expect(registry[registered.uploadSourceId].pinned).toBe(true)
    expect(setUploadSourcePinned({ uploadSourceId: registered.uploadSourceId, userId: 'u1', pinned: false })).toBe(true)
    registry = JSON.parse(Buffer.from(state.registry.ciphertext, 'base64').toString().replace(/^encrypted:/, ''))
    expect(registry[registered.uploadSourceId].pinned).toBe(false)
  })

  it('requires old persisted sources to be selected again before recovery', async () => {
    state.registry = {
      legacy: { filePath: 'D:/selected/legacy.txt', size: 12, sourceMtimeMs: 1000 }
    }
    const { getUploadSource } = await import('../../src/main/uploadSourceRegistry')

    await expect(getUploadSource('legacy')).rejects.toThrow(
      'Upload source must be selected again before resuming'
    )
    expect(state.registry).toMatchObject({ version: 1, ciphertext: expect.any(String) })
    expect(JSON.stringify(state.registry)).not.toContain('legacy.txt')
  })

  it('clears corrupt ciphertext instead of treating it as a usable source mapping', async () => {
    state.registry = { version: 1, ciphertext: Buffer.from('not-encrypted').toString('base64') }
    const { getUploadSource } = await import('../../src/main/uploadSourceRegistry')

    await expect(getUploadSource('missing')).rejects.toThrow('Unknown upload source')
    expect(state.registry).toBeUndefined()
  })

  it('keeps new sources only in memory when secure storage is unavailable', async () => {
    safe.available = false
    const { getUploadSource, registerUploadSource } = await import('../../src/main/uploadSourceRegistry')
    const registered = await registerUploadSource({
      filePath: 'D:/selected/memory-only.txt',
      name: 'memory-only.txt',
      size: 12
    })

    await expect(getUploadSource(registered.uploadSourceId)).resolves.toMatchObject({
      filePath: 'D:/selected/memory-only.txt'
    })
    expect(state.registry).toBeUndefined()

    vi.resetModules()
    const afterRestart = await import('../../src/main/uploadSourceRegistry')
    await expect(afterRestart.getUploadSource(registered.uploadSourceId)).rejects.toThrow(
      'Unknown upload source'
    )
  })
})
