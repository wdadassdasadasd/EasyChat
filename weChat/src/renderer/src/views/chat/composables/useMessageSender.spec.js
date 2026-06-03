import { describe, expect, it, vi, beforeEach, afterEach, beforeAll } from 'vitest'
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

const createHarness = ({ requestResults = [] } = {}) => {
  const messageList = ref([])
  const currentChatSession = ref({
    contactId: 'u2',
    contactType: 0,
    sessionId: 's1',
    contactName: 'User Two'
  })
  const currentUserId = ref('u1')
  const request = vi.fn(async () => requestResults.shift() ?? null)
  const invoke = vi.fn(async () => ({ success: true, session: currentChatSession.value }))
  const patchChatSessions = vi.fn()
  const proxy = {
    Api: {
      sendMessage: '/chat/sendMessage',
      uploadFile: '/chat/uploadFile'
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
    ipcRenderer: {
      invoke
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
    ;({ useChatMessageSender } = await import('./useMessageSender'))
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
})
