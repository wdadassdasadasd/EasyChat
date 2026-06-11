import { beforeEach, describe, expect, it, vi } from 'vitest'

const { wsInstances } = vi.hoisted(() => ({
  wsInstances: []
}))

vi.mock('ws', () => ({
  WebSocket: class {
    static OPEN = 1
    static CLOSED = 3

    constructor(url) {
      this.url = url
      this.readyState = 1
      this.handlers = {}
      this.ping = vi.fn()
      this.close = vi.fn(() => {
        this.readyState = 3
        this.onclose?.()
      })
      this.on = vi.fn((event, handler) => {
        this.handlers[event] = handler
      })
      this.removeListener = vi.fn((event, handler) => {
        if (this.handlers[event] === handler) {
          delete this.handlers[event]
        }
      })
      wsInstances.push(this)
    }

    emit(event, ...args) {
      this.handlers[event]?.(...args)
    }
  }
}))

vi.mock('../../src/main/store', () => ({
  default: {
    getData: vi.fn(() => 'ws://localhost/ws'),
    getUserId: () => 'u1'
  }
}))

vi.mock('../../src/main/db/ChatSessionUserModel', () => ({
  saveOrUpdateChatSessionBatch4Init: vi.fn()
}))

vi.mock('../../src/main/db/ChatMessageModel', () => ({
  saveMessageBatch: vi.fn(async () => ({ savedMessages: [] })),
  updateMessageStatus: vi.fn()
}))

vi.mock('../../src/main/db/UserSettingModel', () => ({
  updateNoReadCount: vi.fn()
}))

describe('wsClient message normalization', () => {
  beforeEach(async () => {
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.resetModules()
    wsInstances.length = 0
    const store = (await import('../../src/main/store')).default
    store.getData.mockImplementation(() => 'ws://localhost/ws')
    const chatModel = await import('../../src/main/db/ChatMessageModel')
    chatModel.saveMessageBatch.mockImplementation(async () => ({ savedMessages: [] }))
    chatModel.updateMessageStatus.mockResolvedValue(undefined)
    const sessionModel = await import('../../src/main/db/ChatSessionUserModel')
    sessionModel.saveOrUpdateChatSessionBatch4Init.mockResolvedValue(undefined)
    const userSettingModel = await import('../../src/main/db/UserSettingModel')
    userSettingModel.updateNoReadCount.mockResolvedValue(undefined)
  })

  it('flattens raw arrays and nested batch payloads', async () => {
    const { normalizeWsMessages } = await import('../../src/main/wsClient')
    const first = { messageId: 1, sessionId: 's1', messageType: 2 }
    const second = { messageId: 2, sessionId: 's1', messageType: 2 }
    const third = { messageId: 3, sessionId: 's2', messageType: 2 }

    expect(
      normalizeWsMessages([
        first,
        {
          messageType: 'batch',
          messages: [second, { messages: [third] }]
        }
      ])
    ).toEqual([first, second, third])
  })

  it('drops messages beyond max recursion depth of 10', async () => {
    const { normalizeWsMessages } = await import('../../src/main/wsClient')

    // Build a deeply nested structure: depth 12 > 10
    let deep = { messageId: 999, sessionId: 's1', messageType: 2 }
    for (let i = 0; i < 12; i++) {
      deep = { messages: [deep] }
    }

    const result = normalizeWsMessages(deep)
    expect(result).toEqual([])
  })

  it('handles depth 10 normally', async () => {
    const { normalizeWsMessages } = await import('../../src/main/wsClient')

    let nested = { messageId: 1, sessionId: 's1', messageType: 2 }
    // Nest to exactly depth 10
    for (let i = 0; i < 10; i++) {
      nested = { messages: [nested] }
    }

    const result = normalizeWsMessages(nested)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ messageId: 1, messageType: 2 })
  })

  it('unwraps dataList and chatMessageList arrays', async () => {
    const { normalizeWsMessages } = await import('../../src/main/wsClient')

    const msg1 = { messageId: 1, sessionId: 's1', messageType: 2 }
    const msg2 = { messageId: 2, sessionId: 's1', messageType: 2 }
    const msg3 = { messageId: 3, sessionId: 's2', messageType: 2 }

    // Pass items as separate array elements, not nested in a single object
    const result = normalizeWsMessages([
      { dataList: [msg1] },
      { chatMessageList: [msg2, msg3] }
    ])

    expect(result).toHaveLength(3)
    const ids = result.map((m) => m.messageId).sort((a, b) => a - b)
    expect(ids).toEqual([1, 2, 3])
  })

  it('rejects invalid chat messages before they enter the receive queue', async () => {
    const { isValidWsMessage } = await import('../../src/main/wsClient')

    expect(isValidWsMessage({ messageType: 0 })).toBe(true)
    expect(isValidWsMessage({ messageType: 6, messageId: 10 })).toBe(true)
    expect(isValidWsMessage({ messageType: 2, messageId: 11, sessionId: 's1' })).toBe(true)
    expect(isValidWsMessage({ messageType: 2, sessionId: 's1' })).toBe(false)
    expect(isValidWsMessage({ messageType: 2, messageId: 12 })).toBe(false)
    expect(isValidWsMessage([{ messageType: 2 }])).toBe(false)
  })

  it('rejects null, undefined, and non-object messages', async () => {
    const { isValidWsMessage } = await import('../../src/main/wsClient')

    expect(isValidWsMessage(null)).toBe(false)
    expect(isValidWsMessage(undefined)).toBe(false)
    expect(isValidWsMessage('string')).toBe(false)
    expect(isValidWsMessage(42)).toBe(false)
  })

  it('rejects messages with invalid messageType', async () => {
    const { isValidWsMessage } = await import('../../src/main/wsClient')

    expect(isValidWsMessage({ messageType: 'invalid' })).toBe(false)
    expect(isValidWsMessage({ messageType: undefined })).toBe(false)
    expect(isValidWsMessage({})).toBe(false)
  })

  it('publishes stale status and reconnects when pong times out', async () => {
    vi.useFakeTimers()
    const { initWs, closeWs } = await import('../../src/main/wsClient')
    const sender = {
      send: vi.fn(),
      isDestroyed: vi.fn(() => false)
    }

    initWs({ token: 'token-1', userId: 'u1' }, sender)
    const socket = wsInstances.at(-1)
    socket.onopen()

    expect(socket.ping).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(20000)

    expect(sender.send).toHaveBeenCalledWith(
      'wsStatusChange',
      expect.objectContaining({
        status: 'stale',
        diagnostics: expect.objectContaining({
          lastPingAt: expect.any(Number),
          lastError: 'WebSocket heartbeat timed out'
        })
      })
    )
    expect(socket.close).toHaveBeenCalled()

    closeWs()
    vi.useRealTimers()
  })

  it('emits resyncRequired when the receive queue overflows', async () => {
    const { saveMessageBatch } = await import('../../src/main/db/ChatMessageModel')
    saveMessageBatch.mockImplementation(() => new Promise(() => {}))
    const { initWs, closeWs } = await import('../../src/main/wsClient')
    const sender = {
      send: vi.fn(),
      isDestroyed: vi.fn(() => false)
    }

    initWs({ token: 'token-1', userId: 'u1' }, sender)
    const socket = wsInstances.at(-1)
    socket.onopen()
    const messages = Array.from({ length: 2105 }, (_, index) => ({
      messageId: index + 1,
      sessionId: 's1',
      contactId: 'u2',
      contactType: 0,
      messageType: 2,
      messageContent: `m-${index}`,
      sendUserId: 'u2',
      sendTime: index + 1
    }))

    socket.onmessage({ data: JSON.stringify(messages) })
    await vi.waitFor(() => {
      expect(sender.send).toHaveBeenCalledWith(
        'receiveMessageBatch',
        expect.objectContaining({
          kind: 'queue_overflow',
          resyncRequired: true,
          stats: expect.objectContaining({
            diagnostics: expect.objectContaining({
              queueSize: expect.any(Number)
            })
          })
        })
      )
    })

    closeWs()
  })

  it('emits db_write_failed after repeated receive flush failures', async () => {
    vi.useFakeTimers()
    const { saveMessageBatch } = await import('../../src/main/db/ChatMessageModel')
    saveMessageBatch.mockRejectedValue(new Error('db down'))
    const { initWs, closeWs } = await import('../../src/main/wsClient')
    const sender = {
      send: vi.fn(),
      isDestroyed: vi.fn(() => false)
    }

    initWs({ token: 'token-1', userId: 'u1' }, sender)
    const socket = wsInstances.at(-1)
    socket.onopen()
    socket.emit('pong')
    socket.onmessage({
      data: JSON.stringify({
        messageId: 1,
        sessionId: 's1',
        contactId: 'u2',
        contactType: 0,
        messageType: 2,
        messageContent: 'hello',
        sendUserId: 'u2'
      })
    })

    await vi.advanceTimersByTimeAsync(200)

    expect(sender.send).toHaveBeenCalledWith(
      'receiveMessageBatch',
      expect.objectContaining({
          kind: 'db_write_failed',
          resyncRequired: true,
          stats: expect.objectContaining({
            diagnostics: expect.objectContaining({
              dbErrorCount: 3
            })
          })
        })
    )

    closeWs()
    vi.useRealTimers()
  })

  it('emits recovery signal when a WebSocket message task times out', async () => {
    vi.useFakeTimers()
    const { saveOrUpdateChatSessionBatch4Init } = await import(
      '../../src/main/db/ChatSessionUserModel'
    )
    saveOrUpdateChatSessionBatch4Init.mockImplementation(() => new Promise(() => {}))
    const { initWs, closeWs } = await import('../../src/main/wsClient')
    const sender = {
      send: vi.fn(),
      isDestroyed: vi.fn(() => false)
    }

    initWs({ token: 'token-1', userId: 'u1' }, sender)
    const socket = wsInstances.at(-1)
    socket.onopen()
    socket.emit('pong')
    socket.onmessage({
      data: JSON.stringify({
        messageType: 0,
        extendData: {
          chatSessionList: [{ contactId: 'u2', contactName: 'User Two' }],
          chatMessageList: []
        }
      })
    })

    await vi.advanceTimersByTimeAsync(15000)

    expect(sender.send).toHaveBeenCalledWith(
      'receiveMessageBatch',
      expect.objectContaining({
        kind: 'message_processing_timeout',
        resyncRequired: true
      })
    )

    closeWs()
    vi.useRealTimers()
  })

  it('publishes failed config_missing when WebSocket domain is not configured', async () => {
    const store = (await import('../../src/main/store')).default
    store.getData.mockImplementationOnce(() => '')
    const { initWs } = await import('../../src/main/wsClient')
    const sender = {
      send: vi.fn(),
      isDestroyed: vi.fn(() => false)
    }

    initWs({ token: 'secret-token', userId: 'u1' }, sender)

    expect(wsInstances).toHaveLength(0)
    expect(sender.send).toHaveBeenCalledWith(
      'wsStatusChange',
      expect.objectContaining({
        status: 'failed',
        kind: 'config_missing',
        diagnostics: expect.objectContaining({
          retryLeft: 0,
          lastError: expect.stringContaining('missing')
        })
      })
    )
    expect(JSON.stringify(sender.send.mock.calls)).not.toContain('secret-token')
  })

  it('publishes closed diagnostics with no reconnect attempts left', async () => {
    const { initWs, closeWs } = await import('../../src/main/wsClient')
    const sender = {
      send: vi.fn(),
      isDestroyed: vi.fn(() => false)
    }

    initWs({ token: 'token-1', userId: 'u1' }, sender)
    closeWs()

    expect(sender.send).toHaveBeenCalledWith(
      'wsStatusChange',
      expect.objectContaining({
        status: 'closed',
        retryLeft: 0,
        diagnostics: expect.objectContaining({
          retryLeft: 0
        })
      })
    )
  })

  it('counts JSON parse errors without blocking later messages', async () => {
    vi.useFakeTimers()
    const { initWs, closeWs, getWsDiagnostics } = await import('../../src/main/wsClient')
    const { saveMessageBatch } = await import('../../src/main/db/ChatMessageModel')
    saveMessageBatch.mockResolvedValueOnce({
      savedMessages: [
        {
          messageId: 2,
          sessionId: 's1',
          contactId: 'u2',
          contactType: 0,
          messageType: 2,
          messageContent: 'ok',
          sendUserId: 'u2'
        }
      ]
    })
    const sender = {
      send: vi.fn(),
      isDestroyed: vi.fn(() => false)
    }

    initWs({ token: 'token-1', userId: 'u1' }, sender)
    const socket = wsInstances.at(-1)
    socket.onopen()
    socket.emit('pong')
    socket.onmessage({ data: '{bad-json' })
    socket.onmessage({
      data: JSON.stringify({
        messageId: 2,
        sessionId: 's1',
        contactId: 'u2',
        contactType: 0,
        messageType: 2,
        messageContent: 'ok',
        sendUserId: 'u2'
      })
    })
    await vi.advanceTimersByTimeAsync(100)

    expect(getWsDiagnostics().parseErrorCount).toBe(1)
    expect(sender.send).toHaveBeenCalledWith(
      'receiveMessageBatch',
      expect.objectContaining({
        messages: expect.arrayContaining([expect.objectContaining({ messageId: 2 })])
      })
    )

    closeWs()
    vi.useRealTimers()
  })

  it('counts invalid WebSocket messages', async () => {
    const { initWs, closeWs, getWsDiagnostics } = await import('../../src/main/wsClient')
    const sender = {
      send: vi.fn(),
      isDestroyed: vi.fn(() => false)
    }

    initWs({ token: 'token-1', userId: 'u1' }, sender)
    const socket = wsInstances.at(-1)
    socket.onopen()
    socket.emit('pong')
    socket.onmessage({ data: JSON.stringify({ messageType: 2, sessionId: 's1' }) })
    await vi.waitFor(() => {
      expect(getWsDiagnostics().invalidMessageCount).toBe(1)
    })

    closeWs()
  })
})
