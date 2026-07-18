import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createMediaUploadAckController } from '@/views/chat/composables/outbound/mediaUploadAckController'

const createHarness = () => {
  const unsubscribe = vi.fn()
  global.window = {
    api: {
      invokeReleaseUploadSource: vi.fn(async () => ({ success: true })),
      onUploadTaskProgress: vi.fn(() => unsubscribe)
    }
  }
  const message = {
    messageId: 1,
    status: 2,
    uploading: true,
    uploadSourceId: 'source-1'
  }
  const coordinator = {
    deleteController: vi.fn(),
    getController: vi.fn(),
    scheduleRetry: vi.fn()
  }
  const lifecycle = {
    markMessageFailed: vi.fn(async () => {}),
    persistMessageStatus: vi.fn(async () => {})
  }
  const controller = createMediaUploadAckController({
    coordinator,
    lifecycle,
    messageList: ref([message]),
    proxy: { Message: { error: vi.fn() } },
    updateMessageById: vi.fn()
  })
  return { controller, lifecycle, message, unsubscribe }
}

describe('createMediaUploadAckController', () => {
  it('keeps a confirmed ACK authoritative over later progress and releases its source once', async () => {
    const { controller, message } = createHarness()

    await controller.handleFileUploadDone({ messageId: 1, status: 1 })
    controller.subscribe()
    const progressHandler = window.api.onUploadTaskProgress.mock.calls[0][0]
    progressHandler({ messageId: 1, state: 'running', progress: 20 })

    expect(message).toMatchObject({ status: 1, uploadAckReceived: true, uploadProgress: 100 })
    expect(window.api.invokeReleaseUploadSource).toHaveBeenCalledTimes(1)
  })

  it('releases the IPC listener on cleanup', () => {
    const { controller, unsubscribe } = createHarness()
    controller.subscribe()
    controller.cleanup()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('freezes confirmed progress while the file service is unavailable', () => {
    const { controller, message } = createHarness()
    controller.subscribe()
    const progressHandler = window.api.onUploadTaskProgress.mock.calls[0][0]

    progressHandler({ messageId: 1, state: 'waiting_network', progress: 42 })

    expect(message).toMatchObject({
      status: 2,
      uploading: false,
      uploadProgress: 42,
      uploadWaitingNetwork: true,
      uploadError: '文件服务不可达，等待网络恢复。'
    })
  })
})
