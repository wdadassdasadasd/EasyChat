import { afterEach, describe, expect, it, vi } from 'vitest'

import { getTotalUploadTimeout, uploadMediaFile } from '@/utils/MediaUploadTransport'
import {
  UPLOAD_CHUNK_SIZE,
  getUploadChunkTimeout,
  getUploadCompleteTimeout
} from '../../../src/shared/uploadConstants.js'

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

  it('does not treat a browser upload-progress event as confirmed progress after a network failure', async () => {
    const onProgress = vi.fn()
    const request = vi.fn((config) => {
      config.uploadProgressCallback?.({ loaded: 80, total: 100 })
      return Promise.resolve({ success: false, kind: 'network', msg: 'Network unavailable' })
    })

    const result = await uploadMediaFile({
      file: new Blob(['offline']),
      fileType: 2,
      message: { messageId: 21 },
      onProgress,
      proxy: {
        Api: { uploadFile: '/upload', uploadFileCancel: '/cancel' },
        Request: request
      }
    })

    expect(result).toMatchObject({ success: false, kind: 'network' })
    expect(onProgress).not.toHaveBeenCalled()
  })

  it('rejects an init response whose uploaded chunks are outside the configured range', async () => {
    const request = vi.fn(async () => ({
      data: { uploadId: 'upload-1', uploadedChunks: [2] }
    }))

    const result = await uploadMediaFile({
      file: new Blob([new Uint8Array(8 * 1024 * 1024)]),
      fileType: 2,
      message: { messageId: 3 },
      proxy: {
        Api: {
          uploadFile: '/upload',
          uploadFileInit: '/init',
          uploadFileChunk: '/chunk',
          uploadFileComplete: '/complete',
          uploadFileCancel: '/cancel'
        },
        Request: request
      }
    })

    expect(result).toMatchObject({ success: false, kind: 'protocol_error' })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('uses the shared chunk and complete timeout budgets', async () => {
    const file = {
      name: 'large.bin',
      size: 8 * 1024 * 1024,
      type: 'application/octet-stream',
      slice: (start, end) => new Blob([new Uint8Array(end - start)])
    }
    const request = vi.fn(async (config) => {
      if (config.url === '/init') return { data: { uploadId: 'upload-1', uploadedChunks: [] } }
      return { data: {} }
    })

    await uploadMediaFile({
      file,
      fileType: 2,
      message: { messageId: 4 },
      proxy: {
        Api: {
          uploadFileInit: '/init',
          uploadFileChunk: '/chunk',
          uploadFileComplete: '/complete',
          uploadFileCancel: '/cancel'
        },
        Request: request
      }
    })

    const chunkRequest = request.mock.calls.find(([config]) => config.url === '/chunk')[0]
    const completeRequest = request.mock.calls.find(([config]) => config.url === '/complete')[0]
    expect(chunkRequest.timeout).toBe(getUploadChunkTimeout(UPLOAD_CHUNK_SIZE))
    expect(completeRequest.timeout).toBe(getUploadCompleteTimeout(file.size))
  })
})
