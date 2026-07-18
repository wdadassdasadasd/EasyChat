import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/Request', () => ({
  getApiUrl: (url) => `/api${url}`
}))

let useFileTransfer

const createProxy = (streamUrl = '/chat/streamFile?fileId=10&downloadToken=t') => ({
  Api: {
    createDownloadToken: '/chat/createDownloadToken',
    downloadFile: '/chat/downloadFile'
  },
  Request: vi.fn(async () => ({
    data: {
      streamUrl
    }
  })),
  Message: {
    error: vi.fn(),
    success: vi.fn()
  }
})

const createFileMessage = (patch = {}) => ({
  messageId: 10,
  messageType: 5,
  fileType: 2,
  status: 1,
  fileName: 'doc.txt',
  fileSize: 100,
  ...patch
})

let progressHandler
let unsubscribeProgress
let invokeDownloadChatFile
let invokeCancelDownloadChatFile
let invokeOpenDownloadedFile

beforeEach(() => {
  progressHandler = null
  unsubscribeProgress = vi.fn()
  invokeDownloadChatFile = vi.fn(async () => ({
    success: true,
    filePath: 'D:/chat/doc.txt',
    progress: 100
  }))
  invokeCancelDownloadChatFile = vi.fn(async () => ({ success: true, canceled: true }))
  invokeOpenDownloadedFile = vi.fn(async () => ({ success: true }))
  global.window = {
    api: {
      invokeDownloadChatFile,
      invokeCancelDownloadChatFile,
      invokeOpenDownloadedFile,
      invokeShowDownloadedFileInFolder: vi.fn(async () => ({ success: true })),
      invokeReadLocalVideoFile: vi.fn(async () => ({ success: false })),
      invokeOpenLocalVideoFile: vi.fn(async () => ({ success: false })),
      invokeOpenTempVideoFile: vi.fn(async () => ({ success: true })),
      onDownloadChatFileProgress: vi.fn((handler) => {
        progressHandler = handler
        return unsubscribeProgress
      })
    }
  }
})

describe('useFileTransfer', () => {
  beforeAll(async () => {
    ;({ useFileTransfer } = await import('@/views/chat/composables/useFileTransfer'))
  })

  it('uses a signed stream url for video preview by default', async () => {
    const proxy = createProxy()
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

  it('downloads a selected file, tracks progress, and unsubscribes the progress listener', async () => {
    const proxy = createProxy()
    invokeDownloadChatFile.mockImplementationOnce(async () => {
      progressHandler?.({ messageId: 10, progress: 42 })
      return {
        success: true,
        filePath: 'D:/chat/doc.txt',
        progress: 100
      }
    })
    const transfer = useFileTransfer({ proxy })
    const message = createFileMessage()

    transfer.openFilePreviewDialog(message)
    await transfer.receiveSelectedFileMessage()

    expect(invokeDownloadChatFile).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 10,
        fileName: 'doc.txt'
      })
    )
    expect(message.downloadStatus).toBe('done')
    expect(message.downloadProgress).toBe(100)
    expect(message.downloadPath).toBe('D:/chat/doc.txt')
    expect(unsubscribeProgress).toHaveBeenCalled()
    expect(proxy.Message.success).toHaveBeenCalledWith('Download complete')
  })

  it('marks a selected file download as failed when main process download fails', async () => {
    const proxy = createProxy()
    invokeDownloadChatFile.mockResolvedValueOnce({
      success: false,
      progress: 35,
      error: 'network down'
    })
    const transfer = useFileTransfer({ proxy })
    const message = createFileMessage()

    transfer.openFilePreviewDialog(message)
    await transfer.receiveSelectedFileMessage()

    expect(message.downloadStatus).toBe('failed')
    expect(message.downloadProgress).toBe(35)
    expect(message.downloadError).toBe('network down')
    expect(proxy.Message.error).toHaveBeenCalledWith('network down')
  })

  it('reports a file-service network failure before starting the main-process download', async () => {
    const proxy = createProxy()
    proxy.Request.mockResolvedValueOnce({
      kind: 'network',
      msg: '文件服务不可达，请检查网络后重试。'
    })
    const transfer = useFileTransfer({ proxy })
    const message = createFileMessage()

    transfer.openFilePreviewDialog(message)
    await transfer.receiveSelectedFileMessage()

    expect(invokeDownloadChatFile).not.toHaveBeenCalled()
    expect(message).toMatchObject({
      downloadStatus: 'failed',
      downloadProgress: 0,
      downloadError: '文件服务不可达，请检查网络后重试。'
    })
    expect(proxy.Message.error).toHaveBeenCalledWith('文件服务不可达，请检查网络后重试。')
  })

  it('rejects oversized downloads before requesting a signed download url', async () => {
    const proxy = createProxy()
    const transfer = useFileTransfer({ proxy })
    const message = createFileMessage({ fileSize: Number.MAX_SAFE_INTEGER })

    transfer.openFilePreviewDialog(message)
    await transfer.receiveSelectedFileMessage()

    expect(proxy.Request).not.toHaveBeenCalled()
    expect(invokeDownloadChatFile).not.toHaveBeenCalled()
    expect(message.downloadStatus).toBe('failed')
  })

  it('does not invoke duplicate downloads while one is already in progress', async () => {
    const proxy = createProxy()
    let resolveDownload
    invokeDownloadChatFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDownload = resolve
        })
    )
    const transfer = useFileTransfer({ proxy })
    const message = createFileMessage()

    transfer.openFilePreviewDialog(message)
    const firstDownload = transfer.receiveSelectedFileMessage()
    const secondResult = await transfer.receiveSelectedFileMessage()
    resolveDownload({ success: true, filePath: 'D:/chat/doc.txt', progress: 100 })
    await firstDownload

    expect(secondResult).toBeUndefined()
    expect(invokeDownloadChatFile).toHaveBeenCalledTimes(1)
  })

  it('keeps the receive indicator scoped to the selected message during concurrent downloads', async () => {
    const proxy = createProxy()
    const pendingDownloads = new Map()
    invokeDownloadChatFile.mockImplementation(
      ({ messageId }) =>
        new Promise((resolve) => {
          pendingDownloads.set(String(messageId), resolve)
        })
    )
    const transfer = useFileTransfer({ proxy })
    const firstMessage = createFileMessage({ messageId: 10, fileName: 'first.txt' })
    const secondMessage = createFileMessage({ messageId: 11, fileName: 'second.txt' })

    transfer.openFilePreviewDialog(firstMessage)
    const firstDownload = transfer.receiveSelectedFileMessage()
    transfer.openFilePreviewDialog(secondMessage)
    const secondDownload = transfer.receiveSelectedFileMessage()

    await vi.waitFor(() => expect(pendingDownloads.size).toBe(2))

    transfer.openFilePreviewDialog(firstMessage)
    expect(transfer.isReceivingFile.value).toBe(true)

    pendingDownloads.get('11')({ success: true, filePath: 'D:/chat/second.txt', progress: 100 })
    await secondDownload

    expect(firstMessage.downloadStatus).toBe('downloading')
    expect(transfer.isReceivingFile.value).toBe(true)

    pendingDownloads.get('10')({ success: true, filePath: 'D:/chat/first.txt', progress: 100 })
    await firstDownload

    expect(transfer.isReceivingFile.value).toBe(false)
  })

  it('cancels an active file download and releases its progress subscription', async () => {
    const proxy = createProxy()
    const transfer = useFileTransfer({ proxy })
    const message = createFileMessage()
    let resolveDownload
    invokeDownloadChatFile.mockImplementationOnce(
      () => new Promise((resolve) => { resolveDownload = resolve })
    )

    transfer.openFilePreviewDialog(message)
    const pending = transfer.receiveSelectedFileMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await transfer.cancelSelectedFileDownload()
    resolveDownload({ success: false, kind: 'canceled', error: 'Download canceled' })
    await pending

    expect(invokeCancelDownloadChatFile).toHaveBeenCalledWith({ messageId: 10 })
    expect(unsubscribeProgress).toHaveBeenCalledTimes(1)
    expect(message.downloadStatus).toBe('canceled')
    expect(proxy.Message.error).not.toHaveBeenCalled()
  })

  it('shows an error when opening a downloaded file fails', async () => {
    const proxy = createProxy()
    invokeOpenDownloadedFile.mockResolvedValueOnce({
      success: false,
      error: 'open denied'
    })
    const transfer = useFileTransfer({ proxy })
    const message = createFileMessage()

    transfer.openFilePreviewDialog(message)
    await transfer.receiveSelectedFileMessage()
    await transfer.openDownloadedFile(message)

    expect(invokeOpenDownloadedFile).toHaveBeenCalledWith({
      filePath: 'D:/chat/doc.txt'
    })
    expect(proxy.Message.error).toHaveBeenCalledWith('open denied')
  })
})
