import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/Request', () => ({
  getApiUrl: (url) => `/api${url}`
}))

let useFileTransfer

describe('useFileTransfer', () => {
  beforeAll(async () => {
    ;({ useFileTransfer } = await import('@/views/chat/composables/useFileTransfer'))
  })

  it('uses a signed stream url for video preview by default', async () => {
    const proxy = {
      Api: {
        createDownloadToken: '/chat/createDownloadToken',
        downloadFile: '/chat/downloadFile'
      },
      Request: vi.fn(async () => ({
        data: {
          streamUrl: '/chat/streamFile?fileId=10&downloadToken=t'
        }
      })),
      Message: {
        error: vi.fn(),
        success: vi.fn()
      }
    }
    const transfer = useFileTransfer({ proxy })

    await transfer.openVideoPreviewDialog({
      messageId: 10,
      messageType: 5,
      fileType: 1,
      status: 1,
      fileName: 'clip.mp4'
    })

    expect(proxy.Request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/chat/createDownloadToken'
      })
    )
    expect(transfer.videoPreviewUrl.value).toBe('/api/chat/streamFile?fileId=10&downloadToken=t')
  })
})
