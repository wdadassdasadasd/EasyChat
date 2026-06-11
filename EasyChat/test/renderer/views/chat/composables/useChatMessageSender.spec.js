import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

vi.mock('element-plus', () => ({
  ElMessage: {
    warning: vi.fn()
  }
}))

vi.mock('@/utils/Utils', () => ({
  default: {
    formatFileSize: (size = 0) => `${size} B`
  }
}))

let useChatMessageSender

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const createHarness = ({ requestResults = [], invokeResults = [] } = {}) => {
  const messageList = ref([])
  const currentChatSession = ref({
    contactId: 'u2',
    contactType: 0,
    sessionId: 's1',
    contactName: 'User Two'
  })
  const currentUserId = ref('u1')
  const request = vi.fn(async (config) => {
    const next = requestResults.shift()
    if (typeof next === 'function') {
      return await next(config)
    }
    return next ?? null
  })
  const invoke = vi.fn(async () => {
    return invokeResults.shift() ?? { success: true, session: currentChatSession.value }
  })
  const patchChatSessions = vi.fn()
  const proxy = {
    Api: {
      sendMessage: '/chat/sendMessage',
      uploadFile: '/chat/uploadFile',
      uploadFileInit: '/chat/uploadFile/init',
      uploadFileChunk: '/chat/uploadFile/chunk',
      uploadFileComplete: '/chat/uploadFile/complete',
      uploadFileCancel: '/chat/uploadFile/cancel'
    },
    Request: request,
    Message: {
      error: vi.fn(),
      warning: vi.fn()
    }
  }

  global.window = {
    api: {
      getPathForFile: (file) => file.path || ''
    },
    electron: {
      ipcRenderer: {
        invoke
      }
    }
  }
  global.URL.createObjectURL = vi.fn(() => 'blob://preview')
  global.URL.revokeObjectURL = vi.fn()

  const appendMessageIfMissing = (message) => {
    if (messageList.value.some((item) => String(item.messageId) === String(message.messageId))) {
      return false
    }
    messageList.value.push(message)
    return true
  }
  const replaceMessageById = (messageId, nextMessage) => {
    const index = messageList.value.findIndex(
      (item) => String(item.messageId) === String(messageId)
    )
    if (index === -1) return false
    messageList.value[index] = nextMessage
    return true
  }
  const updateMessageById = (messageId, patch) => {
    const index = messageList.value.findIndex(
      (item) => String(item.messageId) === String(messageId)
    )
    if (index === -1) return false
    messageList.value[index] = { ...messageList.value[index], ...patch }
    return true
  }

  const sender = useChatMessageSender({
    appendMessageIfMissing,
    currentChatSession,
    currentUserId,
    isNearMessageBottom: () => true,
    messageList,
    patchChatSessions,
    proxy,
    replaceMessageById,
    scrollMessageToBottom: vi.fn(),
    updateMessageById
  })

  return {
    currentChatSession,
    invoke,
    messageList,
    patchChatSessions,
    proxy,
    request,
    sender
  }
}

describe('useChatMessageSender', () => {
  beforeAll(async () => {
    ;({ useChatMessageSender } = await import('@/views/chat/composables/useChatMessageSender'))
  })

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    delete global.window
  })

  it('saves a pending text message and replaces it after server success', async () => {
    const { invoke, messageList, request, sender } = createHarness({
      requestResults: [
        {
          data: {
            messageId: 101,
            sessionId: 's1',
            contactId: 'u2',
            contactType: 0,
            messageType: 2,
            messageContent: 'hello',
            sendUserId: 'u1',
            sendTime: 1000
          }
        }
      ]
    })

    sender.onSendChatMessage({ contactId: 'u2', contactType: 0, messageContent: 'hello' })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    await flush()

    expect(messageList.value).toHaveLength(1)
    expect(messageList.value[0].messageId).toBe(101)
    expect(messageList.value[0].status).toBe(1)
    expect(invoke.mock.calls.map((call) => call[1].mode)).toEqual(['pending', 'replace'])
    expect(invoke.mock.calls[0][1].message.status).toBe(2)
  })

  it('keeps a failed text message in the list for retry', async () => {
    const { invoke, messageList, proxy, request, sender } = createHarness({
      requestResults: [null]
    })

    sender.onSendChatMessage({ contactId: 'u2', contactType: 0, messageContent: 'hello' })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    await flush()

    expect(messageList.value).toHaveLength(1)
    expect(Number(messageList.value[0].messageId)).toBeLessThan(0)
    expect(messageList.value[0].status).toBe(0)
    expect(proxy.Message.error).toHaveBeenCalled()
    expect(invoke.mock.calls.map((call) => call[1].mode)).toEqual(['pending', 'status'])
  })

  it('marks text message as localSyncFailed when server send succeeds but local replace fails', async () => {
    const { invoke, messageList, proxy, request, sender } = createHarness({
      invokeResults: [
        { success: true },
        { success: false, error: 'replace failed' }
      ],
      requestResults: [
        {
          data: {
            messageId: 111,
            sessionId: 's1',
            contactId: 'u2',
            contactType: 0,
            messageType: 2,
            messageContent: 'server ok',
            sendUserId: 'u1',
            sendTime: 1110
          }
        }
      ]
    })

    sender.onSendChatMessage({ contactId: 'u2', contactType: 0, messageContent: 'server ok' })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    await flush()

    expect(invoke.mock.calls.map((call) => call[1].mode)).toEqual(['pending', 'replace'])
    expect(messageList.value).toHaveLength(1)
    expect(messageList.value[0]).toMatchObject({
      messageId: 111,
      status: 0,
      localSyncFailed: true
    })
    expect(proxy.Message.error).toHaveBeenCalledWith(
      '消息已发出，但本地记录保存失败，请稍后重新打开会话同步。'
    )
  })

  it('does not send HTTP when pending save fails', async () => {
    const { invoke, messageList, proxy, request, sender } = createHarness({
      invokeResults: [{ success: false, error: 'db unavailable' }],
      requestResults: [
        {
          data: {
            messageId: 909,
            sessionId: 's1',
            contactId: 'u2',
            contactType: 0,
            messageType: 2,
            messageContent: 'hello',
            sendUserId: 'u1',
            sendTime: 9000
          }
        }
      ]
    })

    sender.onSendChatMessage({ contactId: 'u2', contactType: 0, messageContent: 'hello' })
    await flush()

    expect(request).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke.mock.calls.map((call) => call[1].mode)).toEqual(['pending', 'status'])
    expect(messageList.value).toHaveLength(1)
    expect(messageList.value[0].status).toBe(0)
    expect(proxy.Message.error).toHaveBeenCalledWith(
      'Message could not be saved locally. Retry later.'
    )
  })

  it('retries a failed text message and replaces the temporary id', async () => {
    const { messageList, request, sender } = createHarness({
      requestResults: [
        {
          data: {
            messageId: 202,
            sessionId: 's1',
            contactId: 'u2',
            contactType: 0,
            messageType: 2,
            messageContent: 'retry me',
            sendUserId: 'u1',
            sendTime: 2000
          }
        }
      ]
    })
    const failedMessage = {
      messageId: -1,
      sessionId: 's1',
      contactId: 'u2',
      contactType: 0,
      messageType: 2,
      messageContent: 'retry me',
      status: 0
    }
    messageList.value.push(failedMessage)

    sender.retryFailedMessage(failedMessage)
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    await flush()

    expect(messageList.value).toHaveLength(1)
    expect(messageList.value[0].messageId).toBe(202)
    expect(messageList.value[0].status).toBe(1)
  })

  it('marks a media message failed when upload fails after server creation', async () => {
    const { messageList, request, sender } = createHarness({
      requestResults: [
        {
          data: {
            messageId: 303,
            sessionId: 's1',
            contactId: 'u2',
            contactType: 0,
            messageType: 5,
            messageContent: 'a.txt',
            fileName: 'a.txt',
            fileType: 2,
            sendUserId: 'u1',
            sendTime: 3000
          }
        },
        null
      ]
    })

    sender.onSendFileMessage({
      contactId: 'u2',
      contactType: 0,
      file: { name: 'a.txt', size: 12, path: 'D:/tmp/a.txt' },
      cover: { name: 'cover.png' }
    })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    await flush()

    expect(messageList.value).toHaveLength(1)
    expect(messageList.value[0].messageId).toBe(303)
    expect(messageList.value[0].status).toBe(0)
    expect(messageList.value[0].uploading).toBe(false)
  })

  it('does not upload media when server message replace fails locally', async () => {
    const { messageList, proxy, request, sender } = createHarness({
      invokeResults: [
        { success: true },
        { success: false, error: 'replace failed' }
      ],
      requestResults: [
        {
          data: {
            messageId: 313,
            sessionId: 's1',
            contactId: 'u2',
            contactType: 0,
            messageType: 5,
            messageContent: 'no-upload.txt',
            fileName: 'no-upload.txt',
            fileType: 2,
            sendUserId: 'u1',
            sendTime: 3130
          }
        },
        { data: null }
      ]
    })

    sender.onSendFileMessage({
      contactId: 'u2',
      contactType: 0,
      file: { name: 'no-upload.txt', size: 12, path: 'D:/tmp/no-upload.txt' },
      cover: { name: 'cover.png' }
    })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    await flush()

    expect(messageList.value).toHaveLength(1)
    expect(messageList.value[0]).toMatchObject({
      messageId: 313,
      status: 0,
      localSyncFailed: true,
      uploading: false
    })
    expect(proxy.Message.error).toHaveBeenCalledWith(
      '消息已发出，但本地记录保存失败，请稍后重新打开会话同步。'
    )
  })

  it('keeps a media message successful when file ack arrives before upload failure', async () => {
    let resolveUpload
    const uploadPromise = new Promise((resolve) => {
      resolveUpload = resolve
    })
    const { invoke, messageList, proxy, request, sender } = createHarness({
      requestResults: [
        {
          data: {
            messageId: 404,
            sessionId: 's1',
            contactId: 'u2',
            contactType: 0,
            messageType: 5,
            messageContent: 'ack-first.txt',
            fileName: 'ack-first.txt',
            fileType: 2,
            sendUserId: 'u1',
            sendTime: 4000
          }
        },
        uploadPromise
      ]
    })

    sender.onSendFileMessage({
      contactId: 'u2',
      contactType: 0,
      file: { name: 'ack-first.txt', size: 12, path: 'D:/tmp/ack-first.txt' },
      cover: { name: 'cover.png' }
    })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))

    sender.handleFileUploadDone({
      messageId: 404,
      messageType: 6,
      status: 1
    })
    resolveUpload(null)
    await flush()

    expect(messageList.value).toHaveLength(1)
    expect(messageList.value[0].messageId).toBe(404)
    expect(messageList.value[0].status).toBe(1)
    expect(messageList.value[0].uploading).toBe(false)
    expect(messageList.value[0].uploadAcked).toBe(true)
    expect(proxy.Message.error).not.toHaveBeenCalled()
    expect(invoke.mock.calls.map((call) => call[1].mode)).toEqual(['pending', 'replace'])
  })

  it('updates upload progress while uploading a media message', async () => {
    const { messageList, request, sender } = createHarness({
      requestResults: [
        {
          data: {
            messageId: 505,
            sessionId: 's1',
            contactId: 'u2',
            contactType: 0,
            messageType: 5,
            messageContent: 'progress.txt',
            fileName: 'progress.txt',
            fileType: 2,
            sendUserId: 'u1',
            sendTime: 5000
          }
        },
        (config) => {
          config.uploadProgressCallback?.({ loaded: 50, total: 100 })
          return { data: null }
        }
      ]
    })

    sender.onSendFileMessage({
      contactId: 'u2',
      contactType: 0,
      file: { name: 'progress.txt', size: 100, path: 'D:/tmp/progress.txt' },
      cover: { name: 'cover.png' }
    })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    await flush()

    expect(messageList.value[0].uploadProgress).toBe(100)
    expect(messageList.value[0].uploading).toBe(false)
    expect(messageList.value[0].status).toBe(1)
  })

  it('blocks oversized media before creating a message', async () => {
    const { messageList, proxy, request, sender } = createHarness()

    sender.onSendImageMessage({
      contactId: 'u2',
      contactType: 0,
      file: {
        name: 'huge.png',
        size: 21 * 1024 * 1024,
        type: 'image/png',
        path: 'D:/tmp/huge.png'
      },
      cover: { name: 'cover.png' }
    })
    await flush()

    expect(request).not.toHaveBeenCalled()
    expect(messageList.value).toHaveLength(0)
    expect(proxy.Message.warning).toHaveBeenCalled()
  })

  it('falls back to legacy upload when chunk init is unavailable', async () => {
    const { request, sender } = createHarness({
      requestResults: [
        {
          data: {
            messageId: 606,
            sessionId: 's1',
            contactId: 'u2',
            contactType: 0,
            messageType: 5,
            messageContent: 'large.mp4',
            fileName: 'large.mp4',
            fileType: 1,
            sendUserId: 'u1',
            sendTime: 6000
          }
        },
        null,
        { data: null }
      ]
    })

    sender.onSendVideoMessage({
      contactId: 'u2',
      contactType: 0,
      file: {
        name: 'large.mp4',
        size: 9 * 1024 * 1024,
        type: 'video/mp4',
        path: 'D:/tmp/large.mp4'
      },
      cover: { name: 'cover.png' }
    })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3))

    const configs = request.mock.calls.map((call) => call[0]).filter(Boolean)
    const initConfig = configs.find((config) => config.url === '/chat/uploadFile/init')
    const legacyUploadConfig = configs.find((config) => config.url === '/chat/uploadFile')

    expect(initConfig).toBeTruthy()
    expect(initConfig.showError).toBe(false)
    expect(legacyUploadConfig).toBeTruthy()
  })
})
