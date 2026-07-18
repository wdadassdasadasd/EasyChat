import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVideoPreviewController } from '@/views/chat/composables/fileTransfer/videoPreviewController'

const videoMessage = (messageId, patch = {}) => ({
  messageId,
  messageType: 5,
  fileType: 1,
  fileName: `${messageId}.mp4`,
  status: 1,
  ...patch
})

afterEach(() => {
  delete global.window
  vi.restoreAllMocks()
})

describe('createVideoPreviewController', () => {
  it('uses the signed stream URL without allocating a Blob URL', async () => {
    const createDownloadUrl = vi.fn(async () => 'https://example.test/video')
    const preview = createVideoPreviewController({
      fileAccess: { createDownloadUrl, getDownloadState: () => ({}) },
      proxy: { Message: { error: vi.fn() }, Request: vi.fn() }
    })

    await preview.openVideoPreviewDialog(videoMessage(1))

    expect(preview.videoPreviewUrl.value).toBe('https://example.test/video')
    expect(createDownloadUrl).toHaveBeenCalledWith(
      videoMessage(1),
      expect.objectContaining({ download: false, signal: expect.any(AbortSignal) })
    )
  })

  it('does not apply a stale stream result after another video was selected', async () => {
    let resolveFirst
    const createDownloadUrl = vi.fn((message) =>
      message.messageId === 1
        ? new Promise((resolve) => {
            resolveFirst = resolve
          })
        : Promise.resolve('https://example.test/second')
    )
    const preview = createVideoPreviewController({
      fileAccess: { createDownloadUrl, getDownloadState: () => ({}) },
      proxy: { Message: { error: vi.fn() }, Request: vi.fn() }
    })

    const first = preview.openVideoPreviewDialog(videoMessage(1))
    await preview.openVideoPreviewDialog(videoMessage(2))
    resolveFirst('https://example.test/first')
    await first

    expect(preview.selectedVideoMessage.value.messageId).toBe(2)
    expect(preview.videoPreviewUrl.value).toBe('https://example.test/second')
  })

  it('aborts the Blob fallback when the dialog closes', async () => {
    let signal
    const preview = createVideoPreviewController({
      fileAccess: { createDownloadUrl: vi.fn(async () => ''), getDownloadState: () => ({}) },
      proxy: {
        Api: { downloadFile: '/chat/downloadFile' },
        Message: { error: vi.fn() },
        Request: vi.fn(({ signal: requestSignal }) => {
          signal = requestSignal
          return new Promise((resolve) => signal.addEventListener('abort', () => resolve(null)))
        })
      }
    })

    const pending = preview.openVideoPreviewDialog(videoMessage(1))
    await Promise.resolve()
    preview.closeVideoPreviewDialog()
    await pending

    expect(signal.aborted).toBe(true)
  })

  it('rejects oversized Blob fallback before requesting the file body', async () => {
    const request = vi.fn()
    const preview = createVideoPreviewController({
      fileAccess: { createDownloadUrl: vi.fn(async () => ''), getDownloadState: () => ({}) },
      proxy: { Api: { downloadFile: '/chat/downloadFile' }, Message: { error: vi.fn() }, Request: request }
    })

    await preview.openVideoPreviewDialog(videoMessage(1, { fileSize: 129 * 1024 * 1024 }))

    expect(request).not.toHaveBeenCalled()
    expect(preview.videoPlaybackError.value).toContain('视频过大')
  })
})
