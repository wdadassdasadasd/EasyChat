import { beforeEach, describe, expect, it, vi } from 'vitest'

const fsMocks = vi.hoisted(() => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn()
}))

vi.mock('fs', () => ({
  default: {
    promises: fsMocks
  }
}))

import {
  TEMP_VIDEO_RETENTION_MS,
  cleanupExpiredTempVideos
} from '../../src/main/tempVideoFiles'

const fileEntry = (name) => ({ name, isFile: () => true })

describe('temporary video cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes expired files and keeps recent files', async () => {
    const now = 2 * TEMP_VIDEO_RETENTION_MS
    fsMocks.readdir.mockResolvedValue([fileEntry('old.mp4'), fileEntry('recent.mp4')])
    fsMocks.stat.mockImplementation(async (filePath) => ({
      mtimeMs: filePath.endsWith('old.mp4') ? 0 : now - 1000
    }))
    fsMocks.unlink.mockResolvedValue()

    await expect(cleanupExpiredTempVideos({ tempRoot: 'D:/temp', now })).resolves.toEqual({
      deletedCount: 1,
      failedCount: 0
    })
    expect(fsMocks.unlink).toHaveBeenCalledOnce()
    expect(fsMocks.unlink.mock.calls[0][0]).toContain('old.mp4')
  })

  it('treats a missing folder as already clean', async () => {
    fsMocks.readdir.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))

    await expect(cleanupExpiredTempVideos({ tempRoot: 'D:/temp' })).resolves.toEqual({
      deletedCount: 0,
      failedCount: 0
    })
  })

  it('continues when one expired file cannot be deleted', async () => {
    fsMocks.readdir.mockResolvedValue([fileEntry('locked.mp4'), fileEntry('removable.mp4')])
    fsMocks.stat.mockResolvedValue({ mtimeMs: 0 })
    fsMocks.unlink
      .mockRejectedValueOnce(new Error('locked'))
      .mockResolvedValueOnce()

    await expect(
      cleanupExpiredTempVideos({ tempRoot: 'D:/temp', now: 2 * TEMP_VIDEO_RETENTION_MS })
    ).resolves.toEqual({
      deletedCount: 1,
      failedCount: 1
    })
    expect(fsMocks.unlink).toHaveBeenCalledTimes(2)
  })
})
