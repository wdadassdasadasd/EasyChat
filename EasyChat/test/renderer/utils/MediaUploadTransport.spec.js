import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getTotalUploadTimeout,
  uploadMediaFile
} from '@/utils/MediaUploadTransport'

describe('mediaUploadTransport total timeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses a 30 minute minimum and a 6 hour cap', () => {
    expect(getTotalUploadTimeout(1)).toBe(30 * 60 * 1000)
    expect(getTotalUploadTimeout(10 * 1024 * 1024 * 1024)).toBe(6 * 60 * 60 * 1000)
  })

  it('aborts the active request and attempts server cancellation at total timeout', async () => {
    vi.useFakeTimers()
    const request = vi.fn((config) => {
      if (config.url === '/cancel') {
        return Promise.resolve({ success: true })
      }
      return new Promise((resolve) => {
        config.signal.addEventListener('abort', () => {
          resolve({ success: false, kind: 'canceled' })
        })
      })
    })
    const uploadPromise = uploadMediaFile({
      file: new Blob(['x']),
      fileType: 2,
      message: { messageId: 1 },
      proxy: {
        Api: { uploadFile: '/upload', uploadFileCancel: '/cancel' },
        Request: request
      }
    })

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    await expect(uploadPromise).resolves.toMatchObject({ success: false, kind: 'timeout' })
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ url: '/cancel' }))
  })

  it('returns at total timeout even when the request ignores abort', async () => {
    vi.useFakeTimers()
    const request = vi.fn((config) => {
      if (config.url === '/cancel') {
        return Promise.resolve({ success: true })
      }
      return new Promise(() => {})
    })
    const uploadPromise = uploadMediaFile({
      file: new Blob(['x']),
      fileType: 2,
      message: { messageId: 2 },
      proxy: {
        Api: { uploadFile: '/upload', uploadFileCancel: '/cancel' },
        Request: request
      }
    })

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)

    await expect(uploadPromise).resolves.toMatchObject({ success: false, kind: 'timeout' })
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ url: '/cancel' }))
  })
})
