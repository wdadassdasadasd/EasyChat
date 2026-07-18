import { beforeEach, describe, expect, it, vi } from 'vitest'

const { wsInstances } = vi.hoisted(() => ({ wsInstances: [] }))

vi.mock('ws', () => ({
  WebSocket: (() => {
    class MockWebSocket {
      constructor(url, options) {
        this.url = url
        this.options = options
        this.readyState = 1
        this.handlers = {}
        this.ping = vi.fn()
        this.close = vi.fn(() => { this.readyState = 3; this.onclose?.() })
        this.on = vi.fn((event, handler) => { this.handlers[event] = handler })
        this.removeListener = vi.fn((event, handler) => {
          if (this.handlers[event] === handler) delete this.handlers[event]
        })
        wsInstances.push(this)
      }

      emit(event, ...args) { this.handlers[event]?.(...args) }
    }
    MockWebSocket.OPEN = 1
    MockWebSocket.CLOSED = 3
    return MockWebSocket
  })()
}))

vi.mock('../../src/main/store', () => ({
  default: { getData: vi.fn(() => 'ws://localhost/ws'), getUserId: () => 'u1' }
}))

vi.mock('../../src/main/db/ChatMessageModel', () => ({
  saveMessageBatch: vi.fn(async () => ({ savedMessages: [] })),
  applyV2Events: vi.fn(async (events) => ({
    savedMessages: events.filter((item) => item.type === 'MESSAGE_UPSERT').map((item) => item.payload),
    stateChanged: events.some((item) => item.type !== 'MESSAGE_UPSERT'),
    mediaUpdates: events.filter((item) => item.type === 'MEDIA_STATUS').map((item) => item.payload),
    eventTypes: events.map((item) => item.type)
  }))
}))

vi.mock('../../src/main/receiveRecoveryStore', () => ({
  appendReceiveRecoveryMessages: vi.fn(async () => ({ success: true, kind: 'stored', storedCount: 1 })),
  compactReceiveRecoveryMessages: vi.fn(async () => 0),
  readReceiveRecoveryMessages: vi.fn(async () => [])
}))

const v2 = (type, payload = {}, serverSequence = 1) => ({
  version: 2,
  eventId: `event-${serverSequence}`,
  serverSequence,
  type,
  occurredAt: 1700000000000 + serverSequence,
  payload
})

describe('wsClient V2 contract', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.resetModules()
    wsInstances.length = 0
  })

  it('normalizes transport wrappers without changing complete V2 envelopes', async () => {
    const { normalizeWsMessages } = await import('../../src/main/wsClient')
    const first = v2('MESSAGE_UPSERT', { messageId: 1 }, 1)
    const second = v2('CONTACT_CHANGED', { contactId: 'u2' }, 2)
    expect(normalizeWsMessages([{ messages: [first] }, { dataList: [second] }])).toEqual([first, second])
  })

  it('uses Authorization for the handshake and never places credentials in the URL', async () => {
    const { buildWsUrl, closeWs, initWs } = await import('../../src/main/wsClient')
    expect(buildWsUrl('ws://localhost/ws?client=desktop')).toBe('ws://localhost/ws?client=desktop')
    await initWs({ token: 'header-token', userId: 'u1' }, { send: vi.fn(), isDestroyed: vi.fn(() => false) })
    expect(wsInstances.at(-1).url).not.toContain('token=')
    expect(wsInstances.at(-1).options).toEqual({ headers: { Authorization: 'Bearer header-token' } })
    await closeWs()
  })

  it('persists a V2 message before publishing a renderer batch', async () => {
    const { applyV2Events } = await import('../../src/main/db/ChatMessageModel')
    const { closeWs, initWs } = await import('../../src/main/wsClient')
    const sender = { send: vi.fn(), isDestroyed: vi.fn(() => false) }
    await initWs({ token: 'token-1', userId: 'u1' }, sender)
    wsInstances.at(-1).onmessage({ data: JSON.stringify(v2('MESSAGE_UPSERT', { messageId: 10, sessionId: 's1', contactId: 'u2', contactType: 0, sendUserId: 'u2' })) })
    await vi.waitFor(() => expect(applyV2Events).toHaveBeenCalledTimes(1))
    expect(sender.send).toHaveBeenCalledWith('receiveMessageBatch', expect.objectContaining({
      messages: [expect.objectContaining({ messageId: 10 })],
      eventTypes: ['MESSAGE_UPSERT']
    }))
    await closeWs()
  })

  it('batches consecutive V2 events before one durable write and renderer publish', async () => {
    vi.useFakeTimers()
    const { applyV2Events } = await import('../../src/main/db/ChatMessageModel')
    const { closeWs, initWs } = await import('../../src/main/wsClient')
    const sender = { send: vi.fn(), isDestroyed: vi.fn(() => false) }
    await initWs({ token: 'token-1', userId: 'u1' }, sender)
    const events = [
      v2('MESSAGE_UPSERT', { messageId: 11, sessionId: 's1', contactId: 'u2', contactType: 0, sendUserId: 'u2' }, 11),
      v2('MEDIA_STATUS', { messageId: 11, status: 1 }, 12)
    ]

    wsInstances.at(-1).onmessage({ data: JSON.stringify({ messages: events }) })
    await vi.advanceTimersByTimeAsync(51)

    expect(applyV2Events).toHaveBeenCalledTimes(1)
    expect(applyV2Events).toHaveBeenCalledWith(events)
    expect(sender.send.mock.calls.filter(([channel]) => channel === 'receiveMessageBatch')).toHaveLength(1)
    await closeWs()
    vi.useRealTimers()
  })

  it('flushes a full V2 batch immediately without waiting for the timer window', async () => {
    const { applyV2Events } = await import('../../src/main/db/ChatMessageModel')
    const { closeWs, initWs } = await import('../../src/main/wsClient')
    const sender = { send: vi.fn(), isDestroyed: vi.fn(() => false) }
    await initWs({ token: 'token-1', userId: 'u1' }, sender)
    const events = Array.from({ length: 100 }, (_item, index) =>
      v2('MESSAGE_UPSERT', { messageId: index + 100, sessionId: 's1', contactId: 'u2' }, index + 100)
    )

    wsInstances.at(-1).onmessage({ data: JSON.stringify({ messages: events }) })

    await vi.waitFor(() => expect(applyV2Events).toHaveBeenCalledTimes(1))
    expect(applyV2Events).toHaveBeenCalledWith(events)
    expect(sender.send.mock.calls.filter(([channel]) => channel === 'receiveMessageBatch')).toHaveLength(1)
    await closeWs()
  })

  it('ignores V2 events delivered by an earlier WebSocket generation', async () => {
    vi.useFakeTimers()
    const { applyV2Events } = await import('../../src/main/db/ChatMessageModel')
    const { closeWs, initWs } = await import('../../src/main/wsClient')
    const firstSender = { send: vi.fn(), isDestroyed: vi.fn(() => false) }
    const secondSender = { send: vi.fn(), isDestroyed: vi.fn(() => false) }
    await initWs({ token: 'token-1', userId: 'u1' }, firstSender)
    const oldSocket = wsInstances.at(-1)
    const oldMessageHandler = oldSocket.onmessage
    await initWs({ token: 'token-2', userId: 'u2' }, secondSender)
    oldMessageHandler({ data: JSON.stringify(v2('MESSAGE_UPSERT', { messageId: 201 }, 201)) })
    await vi.advanceTimersByTimeAsync(51)

    expect(applyV2Events).not.toHaveBeenCalled()
    expect(secondSender.send.mock.calls.filter(([channel]) => channel === 'receiveMessageBatch')).toHaveLength(0)
    await closeWs()
    vi.useRealTimers()
  })

  it('signals HTTP recovery when a V2 batch cannot be persisted', async () => {
    const { applyV2Events } = await import('../../src/main/db/ChatMessageModel')
    const { closeWs, initWs } = await import('../../src/main/wsClient')
    applyV2Events.mockRejectedValueOnce(new Error('SQLite unavailable'))
    const sender = { send: vi.fn(), isDestroyed: vi.fn(() => false) }
    await initWs({ token: 'token-1', userId: 'u1' }, sender)

    wsInstances.at(-1).onmessage({ data: JSON.stringify(v2('MESSAGE_UPSERT', { messageId: 301 }, 301)) })

    await vi.waitFor(() =>
      expect(sender.send).toHaveBeenCalledWith(
        'receiveMessageBatch',
        expect.objectContaining({
          resyncRequired: true,
          stats: expect.objectContaining({ kind: 'v2_batch_persist_failed', eventCount: 1 })
        })
      )
    )
    await closeWs()
  })

  it('marks the runtime stale and reconnects when a heartbeat pong times out', async () => {
    vi.useFakeTimers()
    const { HEARTBEAT_PONG_TIMEOUT } = await import('../../src/main/constants')
    const { closeWs, initWs } = await import('../../src/main/wsClient')
    const sender = { send: vi.fn(), isDestroyed: vi.fn(() => false) }
    await initWs({ token: 'token-1', userId: 'u1' }, sender)
    const socket = wsInstances.at(-1)
    socket.onopen()

    await vi.advanceTimersByTimeAsync(HEARTBEAT_PONG_TIMEOUT)

    expect(socket.ping).toHaveBeenCalled()
    expect(sender.send).toHaveBeenCalledWith('wsStatusChange', expect.objectContaining({ status: 'stale' }))
    await closeWs()
    vi.useRealTimers()
  })

  it('reports failed after all reconnect attempts are exhausted', async () => {
    vi.useFakeTimers()
    const { WS_RECONNECT_DELAY, WS_MAX_RECONNECT_TIMES } = await import('../../src/main/constants')
    const { closeWs, initWs } = await import('../../src/main/wsClient')
    const sender = { send: vi.fn(), isDestroyed: vi.fn(() => false) }
    await initWs({ token: 'token-1', userId: 'u1' }, sender)
    wsInstances.at(-1).onopen()

    for (let attempt = 0; attempt < WS_MAX_RECONNECT_TIMES; attempt += 1) {
      wsInstances.at(-1).onclose()
      await vi.advanceTimersByTimeAsync(WS_RECONNECT_DELAY)
    }
    wsInstances.at(-1).onclose()
    await vi.advanceTimersByTimeAsync(0)

    expect(sender.send).toHaveBeenCalledWith('wsStatusChange', expect.objectContaining({
      status: 'failed', retryLeft: 0
    }))
    await closeWs()
    vi.useRealTimers()
  })

  it('publishes media changes as V2 typed updates rather than legacy ACKs', async () => {
    const { closeWs, initWs } = await import('../../src/main/wsClient')
    const sender = { send: vi.fn(), isDestroyed: vi.fn(() => false) }
    await initWs({ token: 'token-1', userId: 'u1' }, sender)
    wsInstances.at(-1).onmessage({ data: JSON.stringify(v2('MEDIA_STATUS', { messageId: 10, status: 1 })) })
    await vi.waitFor(() => expect(sender.send).toHaveBeenCalledWith('receiveMessageBatch', expect.objectContaining({
      eventTypes: ['MEDIA_STATUS'],
      mediaUpdates: [{ messageId: 10, status: 1 }]
    })))
    await closeWs()
  })

  it('rejects legacy and unknown events once per connection without cursor persistence', async () => {
    const { applyV2Events } = await import('../../src/main/db/ChatMessageModel')
    const { closeWs, getWsDiagnostics, initWs } = await import('../../src/main/wsClient')
    const sender = { send: vi.fn(), isDestroyed: vi.fn(() => false) }
    await initWs({ token: 'token-1', userId: 'u1' }, sender)
    const socket = wsInstances.at(-1)
    socket.onmessage({ data: JSON.stringify({ messageType: 0, extendData: {} }) })
    socket.onmessage({ data: JSON.stringify(v2('FUTURE_EVENT', {}, 2)) })
    await vi.waitFor(() => expect(getWsDiagnostics().invalidMessageCount).toBe(2))
    expect(applyV2Events).not.toHaveBeenCalled()
    expect(sender.send.mock.calls.filter(([channel, payload]) => channel === 'receiveMessageBatch' && payload.resyncRequired)).toHaveLength(1)
    await closeWs()
  })
})
