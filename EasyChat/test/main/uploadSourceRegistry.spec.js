import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ registry: undefined }))
const fileHandle = vi.hoisted(() => ({
  close: vi.fn(async () => {}),
  read: vi.fn(async (buffer, _offset, length) => {
    buffer.fill(7)
    return { bytesRead: length }
  })
}))

vi.mock('../../src/main/store', () => ({
  default: {
    getUserData: vi.fn(() => state.registry),
    setUserData: vi.fn((_key, value) => {
      state.registry = value
    })
  }
}))

vi.mock('fs', () => ({
  default: {
    promises: {
      open: vi.fn(async () => fileHandle),
      stat: vi.fn(async () => ({ isFile: () => true, size: 12 }))
    }
  }
}))

describe('uploadSourceRegistry', () => {
  beforeEach(() => {
    state.registry = undefined
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
})
