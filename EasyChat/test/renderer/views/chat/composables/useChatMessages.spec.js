import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

vi.mock('@/views/chat/composables/useMessageScroll', () => ({
  useMessageScroll: () => ({
    cleanupMessageScroll: vi.fn(),
    clearInitialBottomLock: vi.fn(),
    getActiveMessageLoadSeq: () => 1,
    getMessagePanel: () => ({ scrollHeight: 100, scrollTop: 0 }),
    getMessagePanelRenderSeq: () => 1,
    isNearMessageBottom: () => true,
    markMessagePanelReady: vi.fn(),
    messagePanelPhase: ref('ready'),
    scrollMessageToBottom: vi.fn(),
    settleScrollToBottom: vi.fn(),
    showMessagePanelAtBottom: vi.fn(),
    startMessagePanelRender: vi.fn()
  })
}))

let useChatMessages

const createIpcMock = () => {
  const handlers = {}
  return {
    handlers,
    ipcRenderer: {
      on: vi.fn((channel, handler) => {
        handlers[channel] = handler
      }),
      removeListener: vi.fn((channel) => {
        delete handlers[channel]
      }),
      invoke: vi.fn(async () => ({ success: true })),
      send: vi.fn()
    }
  }
}

const createHarness = () => {
  const { handlers, ipcRenderer } = createIpcMock()
  global.window = {
    electron: {
      ipcRenderer
    },
    requestAnimationFrame: (callback) => setTimeout(callback, 0)
  }
  global.document = {
    getElementById: () => null
  }

  const currentChatSession = ref({
    contactId: 'u2',
    contactType: 0,
    sessionId: 's1'
  })
  const loadChatSession = vi.fn()
  const markSessionRead = vi.fn()
  const patchChatSessions = vi.fn()
  const proxy = {
    Api: {
      sendMessage: '/chat/sendMessage',
      uploadFile: '/chat/uploadFile'
    },
    Request: vi.fn(async () => null),
    Message: {
      error: vi.fn(),
      warning: vi.fn()
    }
  }
  const chat = useChatMessages({
    currentChatSession,
    currentUserId: ref('u1'),
    loadChatSession,
    markSessionRead,
    messageListRef: ref(null),
    patchChatSessions,
    proxy
  })
  chat.registerMessageListeners()

  return {
    chat,
    currentChatSession,
    handlers,
    loadChatSession,
    markSessionRead,
    patchChatSessions,
    proxy,
    window: global.window
  }
}

describe('useChatMessages receive flow', () => {
  beforeAll(async () => {
    ;({ useChatMessages } = await import('@/views/chat/composables/useChatMessages'))
  })

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('appends only current-session messages from a batch and patches sessions', () => {
    const { chat, handlers, markSessionRead, patchChatSessions } = createHarness()
    const currentMessage = {
      messageId: 1,
      sessionId: 's1',
      contactId: 'u2',
      contactType: 0,
      messageType: 2,
      messageContent: 'hi',
      sendUserId: 'u2'
    }
    const otherMessage = {
      messageId: 2,
      sessionId: 's2',
      contactId: 'u3',
      contactType: 0,
      messageType: 2,
      messageContent: 'elsewhere',
      sendUserId: 'u3'
    }

    handlers.receiveMessageBatch(
      {},
      {
        messages: [currentMessage, otherMessage, currentMessage],
        sessions: [{ contactId: 'u2', sessionId: 's1' }]
      }
    )

    expect(chat.messageList.value).toEqual([currentMessage])
    expect(markSessionRead).toHaveBeenCalledWith('u2')
    expect(patchChatSessions).toHaveBeenCalledWith([{ contactId: 'u2', sessionId: 's1' }], {
      readContactIds: ['u2']
    })
  })

  it('ignores expired or wrong-session message page callbacks', async () => {
    const { chat, currentChatSession, handlers } = createHarness()
    currentChatSession.value = { contactId: 'u2', sessionId: 's1', contactType: 0 }

    await handlers.loadChatMessageCallback(
      {},
      {
        dataList: [{ messageId: 9, sessionId: 's2' }],
        hasMore: false,
        sessionId: 's2',
        loadSeq: 1
      }
    )

    expect(chat.messageList.value).toEqual([])
  })

  it('surfaces batch receive failures without mutating the message list', () => {
    const { chat, handlers, proxy } = createHarness()

    handlers.receiveMessageBatch(
      {},
      {
        success: false,
        error: 'db failed'
      }
    )

    expect(chat.messageList.value).toEqual([])
    expect(proxy.Message.error).toHaveBeenCalledWith('db failed')
  })

  it('resyncs sessions and refreshes current chat tail when batch receive requires recovery', () => {
    const { chat, handlers, loadChatSession, patchChatSessions, proxy, window } = createHarness()

    handlers.receiveMessageBatch(
      {},
      {
        success: false,
        kind: 'queue_overflow',
        resyncRequired: true,
        error: '消息同步异常，正在尝试恢复。',
        sessions: [{ contactId: 'u2', sessionId: 's1', lastMessage: 'latest' }]
      }
    )

    expect(chat.messageList.value).toEqual([])
    expect(proxy.Message.error).toHaveBeenCalledWith('消息同步异常，正在尝试恢复。')
    expect(patchChatSessions).toHaveBeenCalledWith([
      { contactId: 'u2', sessionId: 's1', lastMessage: 'latest' }
    ])
    expect(loadChatSession).toHaveBeenCalled()
    expect(window.electron.ipcRenderer.send).toHaveBeenCalledWith(
      'loadChatMessage',
      expect.objectContaining({
        sessionId: 's1',
        loadMode: 'tail'
      })
    )
  })

  it('merges a self WebSocket echo when HTTP replacement arrives later', async () => {
    let resolveRequest
    const requestPromise = new Promise((resolve) => {
      resolveRequest = resolve
    })
    const { chat, handlers, proxy, window } = createHarness()
    proxy.Request.mockImplementationOnce(() => requestPromise)

    chat.onSendChatMessage({ contactId: 'u2', contactType: 0, messageContent: 'echo' })
    await vi.waitFor(() => expect(proxy.Request).toHaveBeenCalledTimes(1))

    handlers.receiveMessageBatch(
      {},
      {
        messages: [
          {
            messageId: 777,
            sessionId: 's1',
            contactId: 'u2',
            contactType: 0,
            messageType: 2,
            messageContent: 'echo',
            sendUserId: 'u1',
            sendTime: 7000
          }
        ],
        sessions: [{ contactId: 'u2', sessionId: 's1' }]
      }
    )

    expect(chat.messageList.value.map((message) => message.messageId)).toHaveLength(2)

    resolveRequest({
      data: {
        messageId: 777,
        sessionId: 's1',
        contactId: 'u2',
        contactType: 0,
        messageType: 2,
        messageContent: 'echo',
        sendUserId: 'u1',
        sendTime: 7000
      }
    })

    await vi.waitFor(() => {
      expect(chat.messageList.value.map((message) => message.messageId)).toEqual([777])
    })
    expect(window.electron.ipcRenderer.invoke.mock.calls.map((call) => call[1].mode)).toEqual([
      'pending',
      'replace'
    ])
  })

  it('registers message listeners idempotently', () => {
    const { chat, window } = createHarness()

    chat.registerMessageListeners()

    expect(window.electron.ipcRenderer.removeListener).toHaveBeenCalledWith(
      'receiveMessage',
      expect.any(Function)
    )
    expect(window.electron.ipcRenderer.removeListener).toHaveBeenCalledWith(
      'receiveMessageBatch',
      expect.any(Function)
    )
    expect(window.electron.ipcRenderer.removeListener).toHaveBeenCalledWith(
      'loadChatMessageCallback',
      expect.any(Function)
    )
  })
})
