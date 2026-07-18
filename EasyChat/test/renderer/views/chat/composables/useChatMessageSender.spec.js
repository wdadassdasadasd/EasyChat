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

const createDeferred = () => {
  let resolve
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

const createServerMediaMessage = (messageId, fileName) => ({
  messageId,
  sessionId: 's1',
  contactId: 'u2',
  contactType: 0,
  messageType: 5,
  messageContent: fileName,
  fileName,
  fileType: 2,
  sendUserId: 'u1',
  sendTime: messageId * 10
})

const createHarness = ({ requestResults = [], invokeResults = [] } = {}) => {
  let uploadTaskProgressListener
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
  const invokeSaveSendMessage = vi.fn(async () => {
    const next = invokeResults.shift()
    if (typeof next === 'function') {
      return await next()
    }
    return next ?? { success: true, session: currentChatSession.value }
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
      getPathForFile: (file) => file.path || '',
      invokeSaveSendMessage,
      registerUploadSource: vi.fn(async (file) => ({
        success: true,
        uploadSourceId: `source-${file.name}`
      })),
      invokeReadUploadSourceChunk: vi.fn(async ({ start, end }) => ({
        success: true,
        arrayBuffer: new ArrayBuffer(end - start)
      })),
      invokeReleaseUploadSource: vi.fn(async () => ({ success: true })),
      invokeGenerateUploadSourceThumbnail: vi.fn(async () => ({ success: false })),
      onUploadTaskProgress: vi.fn((listener) => {
        uploadTaskProgressListener = listener
        return vi.fn()
      })
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
    invokeSaveSendMessage,
    messageList,
    patchChatSessions,
    proxy,
    request,
    sender,
    emitUploadTaskProgress: (payload) => uploadTaskProgressListener?.(payload)
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
    vi.clearAllTimers()
    vi.useRealTimers()
    delete global.window
  })

  it('saves a pending text message and replaces it after server success', async () => {
    const { invokeSaveSendMessage, messageList, request, sender } = createHarness({
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
    expect(invokeSaveSendMessage.mock.calls.map((call) => call[0].mode)).toEqual([
      'pending',
      'replace'
    ])
    expect(invokeSaveSendMessage.mock.calls[0][0].message.status).toBe(2)
  })

  it('allows a text message at the 500 character limit', async () => {
    const messageContent = 'x'.repeat(500)
    const { messageList, request, sender } = createHarness({
      requestResults: [
        {
          data: {
            messageId: 102,
            sessionId: 's1',
            contactId: 'u2',
            contactType: 0,
            messageType: 2,
            messageContent,
            sendUserId: 'u1',
            sendTime: 1000
          }
        }
      ]
    })

    sender.onSendChatMessage({ contactId: 'u2', contactType: 0, messageContent })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    await flush()

    expect(messageList.value[0].messageContent).toBe(messageContent)
  })

  it('rejects empty and oversized text before local persistence or HTTP', async () => {
    const { invokeSaveSendMessage, messageList, proxy, request, sender } = createHarness()

    await sender.onSendChatMessage({
      contactId: 'u2',
      contactType: 0,
      messageContent: '   '
    })
    await sender.onSendChatMessage({
      contactId: 'u2',
      contactType: 0,
      messageContent: 'x'.repeat(501)
    })

    expect(invokeSaveSendMessage).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
    expect(messageList.value).toHaveLength(0)
    expect(proxy.Message.warning).toHaveBeenCalledTimes(2)
  })

  it('rejects an oversized retry without changing persisted state', async () => {
    const { invokeSaveSendMessage, proxy, request, sender } = createHarness()

    const result = sender.retryFailedMessage({
      messageId: -1,
      sessionId: 's1',
      contactId: 'u2',
      contactType: 0,
      messageType: 2,
      messageContent: 'x'.repeat(501),
      status: 0
    })
    await result

    expect(invokeSaveSendMessage).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
    expect(proxy.Message.warning).toHaveBeenCalledWith('消息内容不能超过 500 个字符。')
  })

  it('caps the send queue and releases a rejected media source', async () => {
    let resolveFirstRequest
    const firstRequest = () =>
      new Promise((resolve) => {
        resolveFirstRequest = resolve
      })
    const { proxy, sender } = createHarness({
      requestResults: [firstRequest]
    })

    let lastQueuedTask
    for (let index = 0; index < 100; index += 1) {
      lastQueuedTask = sender.onSendChatMessage({
        contactId: 'u2',
        contactType: 0,
        messageContent: `queued-${index}`
      })
    }

    const rejected = sender.onSendFileMessage({
      contactId: 'u2',
      contactType: 0,
      file: { name: 'rejected.txt', size: 12, path: 'D:/tmp/rejected.txt' },
      uploadSourceId: 'source-rejected'
    })

    expect(rejected).toBe(false)
    expect(proxy.Message.warning).toHaveBeenCalledWith(
      '发送任务过多，请等待当前消息处理完成后再试。'
    )
    expect(window.api.invokeReleaseUploadSource).toHaveBeenCalledWith({
      uploadSourceId: 'source-rejected'
    })

    await vi.waitFor(() => expect(resolveFirstRequest).toBeTypeOf('function'))
    resolveFirstRequest(null)
    await lastQueuedTask
  })

  it('keeps a failed text message in the list for retry', async () => {
    const { invokeSaveSendMessage, messageList, proxy, request, sender } = createHarness({
      requestResults: [null]
    })

    sender.onSendChatMessage({ contactId: 'u2', contactType: 0, messageContent: 'hello' })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    await flush()

    expect(messageList.value).toHaveLength(1)
    expect(Number(messageList.value[0].messageId)).toBeLessThan(0)
    expect(messageList.value[0].status).toBe(0)
    expect(proxy.Message.error).toHaveBeenCalled()
    expect(invokeSaveSendMessage.mock.calls.map((call) => call[0].mode)).toEqual([
      'pending',
      'status'
    ])
    expect(request.mock.calls[0][0].returnError).toBe(true)
  })

  it('shows timeout message when structured text send error times out', async () => {
    const { messageList, proxy, request, sender } = createHarness({
      requestResults: [
        {
          success: false,
          kind: 'timeout',
          code: 'ECONNABORTED',
          msg: '请求超时'
        }
      ]
    })

    sender.onSendChatMessage({ contactId: 'u2', contactType: 0, messageContent: 'hello' })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    await flush()

    expect(messageList.value[0].status).toBe(0)
    expect(proxy.Message.error).toHaveBeenCalledWith('消息发送超时，请检查网络后重试。')
  })

  it('marks text message as localSyncFailed when server send succeeds but local replace fails', async () => {
    const { invokeSaveSendMessage, messageList, proxy, request, sender } = createHarness({
      invokeResults: [{ success: true }, { success: false, error: 'replace failed' }],
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

    expect(invokeSaveSendMessage.mock.calls.map((call) => call[0].mode)).toEqual([
      'pending',
      'replace'
    ])
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
    const { invokeSaveSendMessage, messageList, proxy, request, sender } = createHarness({
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
    expect(invokeSaveSendMessage).toHaveBeenCalledTimes(2)
    expect(invokeSaveSendMessage.mock.calls.map((call) => call[0].mode)).toEqual([
      'pending',
      'status'
    ])
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
    expect(request.mock.calls[0][0].returnError).toBe(true)
    expect(request.mock.calls[1][0].returnError).toBe(true)
  })

  it('marks media upload failed with timeout message when upload times out', async () => {
    const { messageList, proxy, request, sender } = createHarness({
      requestResults: [
        {
          data: {
            messageId: 323,
            sessionId: 's1',
            contactId: 'u2',
            contactType: 0,
            messageType: 5,
            messageContent: 'timeout.txt',
            fileName: 'timeout.txt',
            fileType: 2,
            sendUserId: 'u1',
            sendTime: 3230
          }
        },
        {
          success: false,
          kind: 'timeout',
          msg: '请求超时'
        }
      ]
    })

    sender.onSendFileMessage({
      contactId: 'u2',
      contactType: 0,
      file: { name: 'timeout.txt', size: 12, path: 'D:/tmp/timeout.txt' },
      cover: { name: 'cover.png' }
    })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    await flush()

    expect(messageList.value[0].status).toBe(0)
    expect(messageList.value[0].uploading).toBe(false)
    expect(proxy.Message.error).toHaveBeenCalledWith('文件上传超时，请检查网络后重试。')
  })

  it('does not show generic network failure when upload is canceled', async () => {
    const { messageList, proxy, request, sender } = createHarness({
      requestResults: [
        {
          data: {
            messageId: 324,
            sessionId: 's1',
            contactId: 'u2',
            contactType: 0,
            messageType: 5,
            messageContent: 'cancel.txt',
            fileName: 'cancel.txt',
            fileType: 2,
            sendUserId: 'u1',
            sendTime: 3240
          }
        },
        {
          success: false,
          kind: 'canceled',
          msg: '请求已取消'
        }
      ]
    })

    sender.onSendFileMessage({
      contactId: 'u2',
      contactType: 0,
      file: { name: 'cancel.txt', size: 12, path: 'D:/tmp/cancel.txt' },
      cover: { name: 'cover.png' }
    })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    await flush()

    expect(messageList.value[0].status).toBe(0)
    expect(proxy.Message.error).toHaveBeenCalledWith('文件上传已取消。')
    expect(proxy.Message.error).not.toHaveBeenCalledWith('文件上传失败，请检查网络后重试。')
  })

  it('continues media upload after local replace retry succeeds', async () => {
    vi.useFakeTimers()
    const { invokeSaveSendMessage, messageList, proxy, request, sender } = createHarness({
      invokeResults: [
        { success: true },
        { success: false, error: 'replace failed' },
        { success: true },
        { success: true }
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
    await vi.advanceTimersByTimeAsync(0)

    expect(request).toHaveBeenCalledTimes(1)
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
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(0)

    expect(request).toHaveBeenCalledTimes(2)
    expect(invokeSaveSendMessage.mock.calls.map((call) => call[0].mode)).toEqual([
      'pending',
      'replace',
      'replace',
      'status'
    ])
    expect(messageList.value[0]).toMatchObject({
      messageId: 313,
      status: 1,
      localSyncFailed: false,
      uploading: false
    })
  })

  it('keeps a media message successful when file ack arrives before upload failure', async () => {
    let resolveUpload
    const uploadPromise = new Promise((resolve) => {
      resolveUpload = resolve
    })
    const { invokeSaveSendMessage, messageList, proxy, request, sender } = createHarness({
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

    await sender.handleFileUploadDone({
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
    expect(messageList.value[0].uploadAckReceived).toBe(true)
    expect(messageList.value[0].uploadAckStatus).toBe(1)
    expect(proxy.Message.error).not.toHaveBeenCalled()
    expect(invokeSaveSendMessage.mock.calls.map((call) => call[0].mode)).toEqual([
      'pending',
      'replace',
      'status'
    ])
    const ackStatusPayload = invokeSaveSendMessage.mock.calls.at(-1)[0]
    expect(ackStatusPayload.message.uploadAckReceived).toBeUndefined()
    expect(ackStatusPayload.message.uploadAckRevision).toBeUndefined()
    expect(ackStatusPayload.message.uploadAckStatus).toBeUndefined()
    expect(ackStatusPayload.message.uploadSourceReleased).toBeUndefined()
  })

  it('allows a successful ack to recover a temporary HTTP upload failure', async () => {
    const { invokeSaveSendMessage, messageList, request, sender } = createHarness({
      requestResults: [
        { data: createServerMediaMessage(405, 'http-failed.txt') },
        { success: false, kind: 'timeout', msg: 'timeout' }
      ]
    })

    sender.onSendFileMessage({
      contactId: 'u2',
      contactType: 0,
      file: { name: 'http-failed.txt', size: 12, path: 'D:/tmp/http-failed.txt' }
    })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    await flush()

    expect(messageList.value[0].status).toBe(0)

    await sender.handleFileUploadDone({
      messageId: 405,
      messageType: 6,
      status: 1
    })

    expect(messageList.value[0]).toMatchObject({
      status: 1,
      uploading: false,
      uploadProgress: 100,
      uploadAckReceived: true,
      uploadAckStatus: 1
    })
    expect(window.api.invokeReleaseUploadSource).toHaveBeenCalledWith({
      uploadSourceId: 'source-http-failed.txt'
    })
    expect(
      invokeSaveSendMessage.mock.calls
        .map((call) => call[0])
        .filter((payload) => payload.mode === 'status')
        .map((payload) => payload.status)
    ).toEqual([0, 1])
  })

  it('suppresses a stale HTTP failure message when ack succeeds during local status save', async () => {
    const statusSave = createDeferred()
    const { messageList, proxy, request, sender, invokeSaveSendMessage } = createHarness({
      invokeResults: [
        { success: true },
        { success: true },
        () => statusSave.promise,
        { success: true }
      ],
      requestResults: [
        { data: createServerMediaMessage(409, 'racing-failure.txt') },
        { success: false, kind: 'timeout', msg: 'timeout' }
      ]
    })

    sender.onSendFileMessage({
      contactId: 'u2',
      contactType: 0,
      file: { name: 'racing-failure.txt', size: 12, path: 'D:/tmp/racing-failure.txt' }
    })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(invokeSaveSendMessage).toHaveBeenCalledTimes(3))

    await sender.handleFileUploadDone({
      messageId: 409,
      messageType: 6,
      status: 1
    })
    statusSave.resolve({ success: true })
    await flush()

    expect(messageList.value[0]).toMatchObject({
      status: 1,
      uploadAckReceived: true,
      uploadAckStatus: 1
    })
    expect(proxy.Message.error).not.toHaveBeenCalled()
  })

  it('lets an ack failure override an earlier HTTP upload success', async () => {
    const { invokeSaveSendMessage, messageList, proxy, request, sender } = createHarness({
      requestResults: [{ data: createServerMediaMessage(406, 'ack-failed.txt') }, { data: null }]
    })

    sender.onSendFileMessage({
      contactId: 'u2',
      contactType: 0,
      file: { name: 'ack-failed.txt', size: 12, path: 'D:/tmp/ack-failed.txt' }
    })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    await flush()

    expect(messageList.value[0].status).toBe(1)
    expect(window.api.invokeReleaseUploadSource).not.toHaveBeenCalled()

    await sender.handleFileUploadDone({
      messageId: 406,
      messageType: 6,
      status: 0,
      msg: 'server processing failed'
    })

    expect(messageList.value[0]).toMatchObject({
      status: 0,
      uploading: false,
      uploadError: 'server processing failed',
      uploadAckReceived: true,
      uploadAckStatus: 0
    })
    expect(proxy.Message.error).toHaveBeenCalledWith('server processing failed')
    expect(window.api.invokeReleaseUploadSource).not.toHaveBeenCalled()
    expect(
      invokeSaveSendMessage.mock.calls
        .map((call) => call[0])
        .filter((payload) => payload.mode === 'status')
        .map((payload) => payload.status)
    ).toEqual([1, 0])
  })

  it('ignores a late HTTP success after an ack failure', async () => {
    const upload = createDeferred()
    const { invokeSaveSendMessage, messageList, request, sender } = createHarness({
      requestResults: [
        { data: createServerMediaMessage(407, 'ack-first-failure.txt') },
        upload.promise
      ]
    })

    sender.onSendFileMessage({
      contactId: 'u2',
      contactType: 0,
      file: { name: 'ack-first-failure.txt', size: 12, path: 'D:/tmp/ack-first-failure.txt' }
    })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))

    await sender.handleFileUploadDone({
      messageId: 407,
      messageType: 6,
      status: 0
    })
    upload.resolve({ data: null })
    await flush()

    expect(messageList.value[0]).toMatchObject({
      status: 0,
      uploading: false,
      uploadAckReceived: true,
      uploadAckStatus: 0
    })
    expect(window.api.invokeReleaseUploadSource).not.toHaveBeenCalled()
    expect(
      invokeSaveSendMessage.mock.calls
        .map((call) => call[0])
        .filter((payload) => payload.mode === 'status')
        .map((payload) => payload.status)
    ).toEqual([0])
  })

  it('allows a later ack to correct an earlier ack and deduplicates repeated side effects', async () => {
    const upload = createDeferred()
    const { invokeSaveSendMessage, messageList, proxy, request, sender } = createHarness({
      requestResults: [{ data: createServerMediaMessage(408, 'ack-corrected.txt') }, upload.promise]
    })

    sender.onSendFileMessage({
      contactId: 'u2',
      contactType: 0,
      file: { name: 'ack-corrected.txt', size: 12, path: 'D:/tmp/ack-corrected.txt' }
    })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))

    await sender.handleFileUploadDone({
      messageId: 408,
      messageType: 6,
      status: 0,
      msg: 'temporary server failure'
    })
    await sender.handleFileUploadDone({
      messageId: 408,
      messageType: 6,
      status: 0,
      msg: 'temporary server failure'
    })
    await sender.handleFileUploadDone({
      messageId: 408,
      messageType: 6,
      status: 1
    })
    upload.resolve(null)
    await flush()

    expect(messageList.value[0]).toMatchObject({
      status: 1,
      uploading: false,
      uploadProgress: 100,
      uploadAckReceived: true,
      uploadAckStatus: 1
    })
    expect(proxy.Message.error).toHaveBeenCalledTimes(1)
    expect(window.api.invokeReleaseUploadSource).toHaveBeenCalledTimes(1)
    expect(
      invokeSaveSendMessage.mock.calls
        .map((call) => call[0])
        .filter((payload) => payload.mode === 'status')
        .map((payload) => payload.status)
    ).toEqual([0, 0, 1])
  })

  it('keeps a later failed ack authoritative while an earlier successful ack is persisting', async () => {
    const firstAckSave = createDeferred()
    const { invokeSaveSendMessage, messageList, request, sender } = createHarness({
      invokeResults: [
        { success: true },
        { success: true },
        () => firstAckSave.promise,
        { success: true }
      ],
      requestResults: [
        { data: createServerMediaMessage(410, 'ack-race.txt') },
        createDeferred().promise
      ]
    })

    sender.onSendFileMessage({
      contactId: 'u2',
      contactType: 0,
      file: { name: 'ack-race.txt', size: 12, path: 'D:/tmp/ack-race.txt' }
    })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))

    const successfulAck = sender.handleFileUploadDone({
      messageId: 410,
      messageType: 6,
      status: 1
    })
    await vi.waitFor(() => expect(invokeSaveSendMessage).toHaveBeenCalledTimes(3))

    await sender.handleFileUploadDone({
      messageId: 410,
      messageType: 6,
      status: 0,
      msg: 'final server failure'
    })
    firstAckSave.resolve({ success: true })
    await successfulAck

    expect(messageList.value[0]).toMatchObject({
      status: 0,
      uploadError: 'final server failure',
      uploadAckReceived: true,
      uploadAckStatus: 0
    })
    expect(window.api.invokeReleaseUploadSource).not.toHaveBeenCalled()
    expect(
      invokeSaveSendMessage.mock.calls
        .map((call) => call[0])
        .filter((payload) => payload.mode === 'status')
        .map((payload) => payload.status)
    ).toEqual([1, 0])
  })

  it('ignores the previous HTTP upload result after an ack failure starts a retry', async () => {
    const previousUpload = createDeferred()
    const retryUpload = createDeferred()
    const { messageList, request, sender } = createHarness({
      requestResults: [
        { data: createServerMediaMessage(411, 'retry-race.txt') },
        previousUpload.promise,
        retryUpload.promise
      ]
    })

    sender.onSendFileMessage({
      contactId: 'u2',
      contactType: 0,
      file: { name: 'retry-race.txt', size: 12, path: 'D:/tmp/retry-race.txt' }
    })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))

    await sender.handleFileUploadDone({
      messageId: 411,
      messageType: 6,
      status: 0
    })
    sender.retryFailedMessage(messageList.value[0])
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3))

    previousUpload.resolve({ data: null })
    await flush()

    expect(messageList.value[0]).toMatchObject({
      status: 2,
      uploading: true,
      uploadAckReceived: false
    })

    retryUpload.resolve({ data: null })
    await flush()

    expect(messageList.value[0]).toMatchObject({
      status: 1,
      uploading: false,
      uploadProgress: 100
    })
  })

  it('retries upload source release after a successful ack release failure', async () => {
    const upload = createDeferred()
    const { messageList, request, sender } = createHarness({
      requestResults: [{ data: createServerMediaMessage(412, 'release-retry.txt') }, upload.promise]
    })
    window.api.invokeReleaseUploadSource
      .mockRejectedValueOnce(new Error('release failed'))
      .mockResolvedValueOnce({ success: true })

    sender.onSendFileMessage({
      contactId: 'u2',
      contactType: 0,
      file: { name: 'release-retry.txt', size: 12, path: 'D:/tmp/release-retry.txt' }
    })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))

    await sender.handleFileUploadDone({
      messageId: 412,
      messageType: 6,
      status: 1
    })
    expect(messageList.value[0].uploadSourceReleased).not.toBe(true)

    await sender.handleFileUploadDone({
      messageId: 412,
      messageType: 6,
      status: 1
    })

    expect(window.api.invokeReleaseUploadSource).toHaveBeenCalledTimes(2)
    expect(messageList.value[0].uploadSourceReleased).toBe(true)
  })

  it('retries a successful ack source release without requiring a duplicate ack', async () => {
    vi.useFakeTimers()
    const upload = createDeferred()
    const { messageList, request, sender } = createHarness({
      requestResults: [
        { data: createServerMediaMessage(413, 'release-auto-retry.txt') },
        upload.promise
      ]
    })
    window.api.invokeReleaseUploadSource
      .mockRejectedValueOnce(new Error('release failed'))
      .mockResolvedValueOnce({ success: true })

    sender.onSendFileMessage({
      contactId: 'u2',
      contactType: 0,
      file: { name: 'release-auto-retry.txt', size: 12, path: 'D:/tmp/release-auto-retry.txt' }
    })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))

    await sender.handleFileUploadDone({
      messageId: 413,
      messageType: 6,
      status: 1
    })
    await vi.advanceTimersByTimeAsync(1000)

    expect(window.api.invokeReleaseUploadSource).toHaveBeenCalledTimes(2)
    expect(messageList.value[0].uploadSourceReleased).toBe(true)
    vi.useRealTimers()
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

  it('releases a pre-registered upload source when validation rejects the file', async () => {
    const { sender } = createHarness()

    sender.onSendImageMessage({
      contactId: 'u2',
      contactType: 0,
      file: {
        name: 'huge.png',
        size: 21 * 1024 * 1024,
        type: 'image/png'
      },
      uploadSourceId: 'source-huge'
    })
    await flush()

    expect(window.api.invokeReleaseUploadSource).toHaveBeenCalledWith({
      uploadSourceId: 'source-huge'
    })
  })

  it('does not fall back to whole-file upload when a large-file chunk init is unavailable', async () => {
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
        null
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
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))

    const configs = request.mock.calls.map((call) => call[0]).filter(Boolean)
    const initConfig = configs.find((config) => config.url === '/chat/uploadFile/init')

    expect(initConfig).toBeTruthy()
    expect(initConfig.showError).toBe(false)
    expect(configs.find((config) => config.url === '/chat/uploadFile')).toBeUndefined()
  })

  it('persists a cover and hands its reference to the main-process upload task', async () => {
    const { request, sender } = createHarness({
      requestResults: [{ data: createServerMediaMessage(701, 'video.mp4') }]
    })
    const cover = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })
    window.api.registerUploadCover = vi.fn(async () => ({
      success: true,
      coverSourceId: 'cover-701'
    }))
    window.api.invokeEnqueueUploadTask = vi.fn(async () => ({ success: true, taskId: 'task-701' }))
    window.api.invokeReleaseUploadCover = vi.fn(async () => ({ success: true }))

    sender.onSendVideoMessage({
      contactId: 'u2',
      contactType: 0,
      file: { name: 'video.mp4', size: 12, type: 'video/mp4', path: 'D:/tmp/video.mp4' },
      cover
    })

    await vi.waitFor(() => expect(window.api.invokeEnqueueUploadTask).toHaveBeenCalledOnce())
    expect(window.api.registerUploadCover).toHaveBeenCalledWith(cover)
    expect(window.api.invokeEnqueueUploadTask).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 701,
        uploadSourceId: 'source-video.mp4',
        coverSourceId: 'cover-701'
      })
    )
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('keeps a persisted media task running after the user switches sessions', async () => {
    let currentChatSession
    const harness = createHarness({
      requestResults: [() => {
        currentChatSession.value = { contactId: 'u3', contactType: 0, sessionId: 's2' }
        return { data: createServerMediaMessage(711, 'switch-safe.txt') }
      }]
    })
    currentChatSession = harness.currentChatSession
    window.api.invokeEnqueueUploadTask = vi.fn(async () => ({ success: true, taskId: 'task-711' }))

    harness.sender.onSendFileMessage({
      contactId: 'u2',
      contactType: 0,
      file: { name: 'switch-safe.txt', size: 12, type: 'text/plain', path: 'D:/tmp/switch-safe.txt' }
    })

    await vi.waitFor(() => expect(window.api.invokeEnqueueUploadTask).toHaveBeenCalledOnce())
    expect(window.api.invokeEnqueueUploadTask).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 711, uploadSourceId: 'source-switch-safe.txt' })
    )
  })

  it('releases the registered source when persistent task creation fails', async () => {
    const { sender } = createHarness({
      requestResults: [{ data: createServerMediaMessage(712, 'enqueue-failed.txt') }]
    })
    window.api.invokeEnqueueUploadTask = vi.fn(async () => ({ success: false, error: 'database unavailable' }))

    sender.onSendFileMessage({
      contactId: 'u2',
      contactType: 0,
      file: { name: 'enqueue-failed.txt', size: 12, type: 'text/plain', path: 'D:/tmp/enqueue-failed.txt' }
    })

    await vi.waitFor(() => expect(window.api.invokeReleaseUploadSource).toHaveBeenCalledWith({
      uploadSourceId: 'source-enqueue-failed.txt'
    }))
  })

  it('marks the local message successful after the task manager reconciles a delayed ACK', async () => {
    const { emitUploadTaskProgress, messageList, sender } = createHarness()
    messageList.value.push({
      messageId: 702,
      status: 2,
      uploading: true,
      uploadProgress: 99,
      sessionId: 's1'
    })

    emitUploadTaskProgress({ messageId: 702, state: 'succeeded', progress: 100 })
    await flush()

    expect(messageList.value[0]).toMatchObject({
      status: 1,
      uploading: false,
      uploadProgress: 100,
      uploadPaused: false
    })
    sender.cleanupUploadControllers()
  })
})
