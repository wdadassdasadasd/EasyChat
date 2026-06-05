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

  it('rejects invalid chat messages before they enter the receive queue', async () => {
    const { isValidWsMessage } = await import('../../src/main/wsClient')

    expect(isValidWsMessage({ messageType: 0 })).toBe(true)
    expect(isValidWsMessage({ messageType: 6, messageId: 10 })).toBe(true)
    expect(isValidWsMessage({ messageType: 2, messageId: 11, sessionId: 's1' })).toBe(true)
    expect(isValidWsMessage({ messageType: 2, sessionId: 's1' })).toBe(false)
    expect(isValidWsMessage({ messageType: 2, messageId: 12 })).toBe(false)
    expect(isValidWsMessage([{ messageType: 2 }])).toBe(false)
  })
})
