import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ registry: undefined }))
const fileStat = vi.hoisted(() => ({
  value: { isFile: () => true, size: 12, mtimeMs: 1000 }
}))
const fileHandle = vi.hoisted(() => ({
  close: vi.fn(async () => {}),
  read: vi.fn(async (buffer, _offset, length) => {
    buffer.fill(7)
    return { bytesRead: length }
  })
}))

vi.mock('../../src/main/store', () => ({
  default: {
    getUserId: vi.fn(() => 'u1'),
    getUserData: vi.fn(() => state.registry),
    getUserDataForUser: vi.fn((_userId, _key) => state.registry),
    setUserData: vi.fn((_key, value) => {
      state.registry = value
    }),
    setUserDataForUser: vi.fn((_userId, _key, value) => {
      state.registry = value
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
    state.registry = undefined
    fileStat.value = { isFile: () => true, size: 12, mtimeMs: 1000 }
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
    expect(state.registry[registered.uploadSourceId].filePath).toBe('D:/selected/a.txt')
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
    expect(state.registry[registered.uploadSourceId]).toBeUndefined()
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
    expect(state.registry[registered.uploadSourceId].pinned).toBe(true)
    expect(setUploadSourcePinned({ uploadSourceId: registered.uploadSourceId, userId: 'u1', pinned: false })).toBe(true)
    expect(state.registry[registered.uploadSourceId].pinned).toBe(false)
  })
})
