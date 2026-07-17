import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ files: new Map(), registry: {} }))

vi.mock('fs', () => ({
  default: {
    promises: {
      mkdir: vi.fn(async () => {}),
      writeFile: vi.fn(async (filePath, buffer) => state.files.set(filePath, Buffer.from(buffer))),
      stat: vi.fn(async (filePath) => {
        const buffer = state.files.get(filePath)
        if (!buffer) {
          const error = new Error('not found')
          error.code = 'ENOENT'
          throw error
        }
        return { isFile: () => true, size: buffer.byteLength }
      }),
      readFile: vi.fn(async (filePath) => state.files.get(filePath)),
      unlink: vi.fn(async (filePath) => state.files.delete(filePath))
    }
  }
}))

vi.mock('../../src/main/store', () => ({
  default: {
    getUserId: () => 'alice',
    getUserDataForUser: vi.fn(() => state.registry),
    setUserDataForUser: vi.fn((_userId, _key, registry) => {
      state.registry = registry
    })
  }
}))

vi.mock('../../src/main/appPaths.js', () => ({
  getEasyChatPaths: () => ({ rootDir: 'D:/easychat' })
}))

describe('uploadCoverRegistry', () => {
  beforeEach(() => {
    state.files.clear()
    state.registry = {}
    vi.clearAllMocks()
  })

  it('persists, reads, and releases a bounded cover for its current user', async () => {
    const { readUploadCover, registerUploadCover, releaseUploadCover } =
      await import('../../src/main/uploadCoverRegistry.js')
    const input = new Uint8Array([1, 2, 3]).buffer

    const registered = await registerUploadCover({ arrayBuffer: input, type: 'image/jpeg' })
    const read = await readUploadCover({ coverSourceId: registered.coverSourceId })
    const released = await releaseUploadCover({ coverSourceId: registered.coverSourceId })

    expect(read.cover.type).toBe('image/jpeg')
    expect([...read.buffer]).toEqual([1, 2, 3])
    expect(released).toMatchObject({ success: true, released: true })
    expect(state.registry).toEqual({})
    expect(state.files.size).toBe(0)
  })
})
