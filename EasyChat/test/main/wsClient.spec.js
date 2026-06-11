import { describe, expect, it, vi } from 'vitest'

vi.mock('ws', () => ({
  WebSocket: class {
    static OPEN = 1
  }
}))

vi.mock('../../src/main/store', () => ({
  default: {
    getData: vi.fn(),
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
})
