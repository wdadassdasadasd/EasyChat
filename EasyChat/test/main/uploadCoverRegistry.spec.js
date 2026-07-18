import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  files: new Map(), registry: {}, userId: 'alice', secureStorageAvailable: true, lockedPaths: new Set()
}))

vi.mock('fs', () => ({
  default: {
    promises: {
      mkdir: vi.fn(async () => {}),
      writeFile: vi.fn(async (filePath, buffer) => state.files.set(path.resolve(filePath), {
        buffer: Buffer.from(buffer), mtimeMs: Date.now()
      })),
      stat: vi.fn(async (filePath) => {
        const file = state.files.get(path.resolve(filePath))
        if (!file) {
          const error = new Error('not found')
          error.code = 'ENOENT'
          throw error
        }
        return { isFile: () => true, size: file.buffer.byteLength, mtimeMs: file.mtimeMs }
      }),
      readFile: vi.fn(async (filePath) => state.files.get(path.resolve(filePath))?.buffer),
      unlink: vi.fn(async (filePath) => {
        const resolved = path.resolve(filePath)
        if (state.lockedPaths.has(resolved)) throw new Error('locked')
        state.files.delete(resolved)
      }),
      readdir: vi.fn(async (folder) => [...state.files.keys()]
        .filter((filePath) => path.dirname(filePath) === path.resolve(folder))
        .map((filePath) => ({ name: path.basename(filePath), isFile: () => true })))
    }
  }
}))

vi.mock('electron', () => ({
  safeStorage: {
    encryptString: vi.fn((value) => Buffer.from(value)),
    decryptString: vi.fn((value) => Buffer.from(value).toString())
  }
}))

vi.mock('../../src/main/secureSessionStore.js', () => ({
  getSecureStorageStatus: () => ({ available: state.secureStorageAvailable })
}))

vi.mock('../../src/main/store', () => ({
  default: {
    getUserId: () => state.userId,
    getUserDataForUser: vi.fn(() => state.registry),
    setUserDataForUser: vi.fn((_userId, _key, registry) => {
      state.registry = registry
    }),
    deleteUserDataForUser: vi.fn(() => { state.registry = {} })
  }
}))

vi.mock('../../src/main/appPaths.js', () => ({
  getEasyChatPaths: () => ({ rootDir: 'D:/easychat' })
}))

describe('uploadCoverRegistry', () => {
  beforeEach(() => {
    state.files.clear()
    state.registry = {}
    state.userId = 'alice'
    state.secureStorageAvailable = true
    state.lockedPaths.clear()
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('encrypts metadata, isolates the cover folder, reads, and releases a bounded cover', async () => {
    const { getCoverFolder, readUploadCover, registerUploadCover, releaseUploadCover } =
      await import('../../src/main/uploadCoverRegistry.js')
    const input = new Uint8Array([1, 2, 3]).buffer

    const registered = await registerUploadCover({ arrayBuffer: input, type: 'image/jpeg' })
    const read = await readUploadCover({ coverSourceId: registered.coverSourceId })
    const released = await releaseUploadCover({ coverSourceId: registered.coverSourceId })

    expect(read.cover.type).toBe('image/jpeg')
    expect([...read.buffer]).toEqual([1, 2, 3])
    expect(state.registry).toMatchObject({ version: 1, ciphertext: expect.any(String) })
    expect(read.cover.filePath).toContain(path.basename(getCoverFolder('alice')))
    expect(released).toMatchObject({ success: true, released: true })
    expect(state.registry).toMatchObject({ version: 1, ciphertext: expect.any(String) })
    expect(state.files.size).toBe(0)
  })

  it('migrates a valid legacy plaintext record to encrypted metadata', async () => {
    const coverSourceId = '11111111-1111-4111-8111-111111111111'
    const legacyPath = path.resolve('D:/easychat/upload-covers', `${coverSourceId}.cover`)
    state.files.set(legacyPath, { buffer: Buffer.from([1]), mtimeMs: Date.now() })
    state.registry = {
      [coverSourceId]: { filePath: legacyPath, type: 'image/jpeg', size: 1, createdAt: Date.now() }
    }
    const { readUploadCover } = await import('../../src/main/uploadCoverRegistry.js')

    await expect(readUploadCover({ coverSourceId })).resolves.toMatchObject({ cover: { filePath: legacyPath } })
    expect(state.registry).toMatchObject({ version: 1, ciphertext: expect.any(String) })
  })

  it('keeps metadata only in memory when secure storage is unavailable', async () => {
    state.secureStorageAvailable = false
    const { readUploadCover, registerUploadCover } = await import('../../src/main/uploadCoverRegistry.js')
    const registered = await registerUploadCover({ arrayBuffer: new Uint8Array([1]).buffer })

    await expect(readUploadCover({ coverSourceId: registered.coverSourceId })).resolves.toBeTruthy()
    expect(state.registry).toEqual({})
  })

  it('cleans expired unreferenced covers while retaining task-protected covers', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const { cleanupUploadCovers, getCoverFolder, registerUploadCover } =
      await import('../../src/main/uploadCoverRegistry.js')
    const protectedCover = await registerUploadCover({ arrayBuffer: new Uint8Array([1]).buffer })
    const orphanCover = await registerUploadCover({ arrayBuffer: new Uint8Array([2]).buffer })
    const orphanPath = path.resolve(getCoverFolder('alice'), 'unregistered.cover')
    state.files.set(orphanPath, { buffer: Buffer.from([3]), mtimeMs: Date.now() - 11 * 60 * 1000 })

    const result = await cleanupUploadCovers({
      protectedCoverIds: [protectedCover.coverSourceId],
      now: Date.now() + 11 * 60 * 1000
    })

    expect(result).toMatchObject({ deletedCount: 2, failedCount: 0 })
    expect(state.files.size).toBe(1)
    expect([...state.files.keys()][0]).toContain(protectedCover.coverSourceId)
    expect([...state.files.keys()][0]).not.toContain(orphanCover.coverSourceId)
    vi.useRealTimers()
  })
})
