import { beforeEach, describe, expect, it, vi } from 'vitest'

const insertedRows = []
const strictRuns = []

vi.mock('../../../src/main/store', () => ({
  default: {
    getUserId: () => 'u1'
  }
}))

vi.mock('../../../src/main/db/ADB', () => ({
  insertOrReplace: vi.fn(),
  insertOrReplaceStrict: vi.fn(async (tableName, data) => {
    insertedRows.push({ tableName, data })
    return 1
  }),
  queryAll: vi.fn(async (sql) => {
    if (sql.includes('chat_session_clear')) {
      return []
    }
    if (sql.includes('chat_message')) {
      return []
    }
    return []
  }),
  queryOne: vi.fn(async (sql) => {
    if (sql.includes('chat_session_user')) {
      return {
        userId: 'u1',
        contactId: 'u2',
        contactType: 0,
        sessionId: 's1',
        status: 1,
        contactName: 'User Two',
        lastMessage: 'previous',
        lastReceiveTime: 100,
        noReadCount: 5,
        topType: 1
      }
    }
    return null
  }),
  run: vi.fn(async () => 1),
  runInTransaction: vi.fn(async (callback) => callback()),
  runStrict: vi.fn(async (sql, params) => {
    strictRuns.push({ sql, params })
    return 1
  }),
  update: vi.fn(async () => 1)
}))

describe('ChatMessageModel saveMessageBatch', () => {
  beforeEach(() => {
    insertedRows.length = 0
    strictRuns.length = 0
  })

  it('preserves existing unread and top state when receive session patch omits them', async () => {
    const { saveMessageBatch } = await import('../../../src/main/db/ChatMessageModel')

    await saveMessageBatch(
      [
        {
          messageId: 101,
          sessionId: 's1',
          contactId: 'u2',
          contactType: 0,
          sendUserId: 'u2',
          messageType: 2,
          messageContent: 'hello',
          sendTime: 200
        }
      ],
      {
        sessionRows: [
          {
            contactId: 'u2',
            contactType: 0,
            sessionId: 's1',
            lastMessage: 'hello',
            lastReceiveTime: 200
          }
        ]
      }
    )

    const sessionWrite = insertedRows.find((row) => row.tableName === 'chat_session_user')

    expect(sessionWrite?.data).toMatchObject({
      contactId: 'u2',
      sessionId: 's1',
      lastMessage: 'hello',
      lastReceiveTime: 200,
      noReadCount: 5,
      topType: 1,
      status: 1
    })
  })
})

describe('ChatMessageModel savePendingMessage', () => {
  beforeEach(() => {
    insertedRows.length = 0
  })

  it('saves message with status=2 and returns session', async () => {
    const { savePendingMessage } = await import('../../../src/main/db/ChatMessageModel')

    const result = await savePendingMessage({
      message: {
        messageId: 200,
        sessionId: 's1',
        contactId: 'u2',
        contactType: 0,
        messageType: 2,
        messageContent: 'pending msg',
        sendTime: 300
      },
      chatSession: {
        contactId: 'u2',
        contactType: 0,
        sessionId: 's1'
      }
    })

    expect(result.success).toBe(true)
    expect(result.messageId).toBe(200)

    const messageWrite = insertedRows.find((row) => row.tableName === 'chat_message')
    expect(messageWrite?.data).toMatchObject({
      messageId: 200,
      status: 2,
      messageContent: 'pending msg',
      userId: 'u1'
    })

    expect(result.session).toBeTruthy()
    expect(result.session.contactId).toBe('u2')
  })

  it('returns error when messageId is missing', async () => {
    const { savePendingMessage } = await import('../../../src/main/db/ChatMessageModel')

    const result = await savePendingMessage({
      message: { messageContent: 'no id' },
      chatSession: {}
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('ChatMessageModel replacePendingMessage', () => {
  beforeEach(() => {
    insertedRows.length = 0
  })

  it('deletes old temp messageId and inserts with status=1', async () => {
    const { replacePendingMessage } = await import('../../../src/main/db/ChatMessageModel')

    const result = await replacePendingMessage({
      localMessageId: -1,
      message: {
        messageId: 300,
        sessionId: 's1',
        contactId: 'u2',
        messageType: 2,
        messageContent: 'replaced msg',
        sendTime: 400
      },
      chatSession: {
        contactId: 'u2',
        sessionId: 's1'
      }
    })

    expect(result.success).toBe(true)
    expect(result.messageId).toBe(300)
    expect(result.localMessageId).toBe(-1)

    const messageWrite = insertedRows.find((row) => row.tableName === 'chat_message')
    expect(messageWrite?.data).toMatchObject({
      messageId: 300,
      status: 1,
      messageContent: 'replaced msg'
    })
  })

  it('returns error when messageId is missing', async () => {
    const { replacePendingMessage } = await import('../../../src/main/db/ChatMessageModel')

    const result = await replacePendingMessage({
      localMessageId: -1,
      message: {},
      chatSession: {}
    })

    expect(result.success).toBe(false)
  })
})

describe('ChatMessageModel filterVisibleMessages', () => {
  it('returns all messages when no clear cursor exists', async () => {
    const { filterVisibleMessages } = await import('../../../src/main/db/ChatMessageModel')

    const messages = [
      { messageId: 1, sessionId: 's1', sendTime: 100 },
      { messageId: 2, sessionId: 's1', sendTime: 200 }
    ]

    const result = await filterVisibleMessages(messages)
    expect(result).toHaveLength(2)
  })

  it('returns empty for empty input', async () => {
    const { filterVisibleMessages } = await import('../../../src/main/db/ChatMessageModel')

    expect(await filterVisibleMessages([])).toEqual([])
    expect(await filterVisibleMessages(null)).toEqual([])
  })
})

describe('ChatMessageModel filterNewMessages', () => {
  it('returns all messages when no duplicates exist', async () => {
    const { filterNewMessages } = await import('../../../src/main/db/ChatMessageModel')

    const messages = [
      { messageId: 10, sessionId: 's1' },
      { messageId: 20, sessionId: 's1' }
    ]

    const result = await filterNewMessages(messages)
    expect(result).toHaveLength(2)
  })

  it('deduplicates repeated messageIds within the same batch', async () => {
    const { filterNewMessages } = await import('../../../src/main/db/ChatMessageModel')

    const messages = [
      { messageId: 10, sessionId: 's1' },
      { messageId: 10, sessionId: 's1' },
      { messageId: 20, sessionId: 's1' }
    ]

    const result = await filterNewMessages(messages)
    expect(result).toHaveLength(2)
    const ids = result.map((m) => m.messageId)
    expect(ids).toContain(10)
    expect(ids).toContain(20)
  })

  it('returns empty for empty input', async () => {
    const { filterNewMessages } = await import('../../../src/main/db/ChatMessageModel')

    expect(await filterNewMessages([])).toEqual([])
  })
})

describe('ChatMessageModel selectMessageList', () => {
  it('returns empty when no sessionId', async () => {
    const { selectMessageList } = await import('../../../src/main/db/ChatMessageModel')

    const result = await selectMessageList({})
    expect(result.dataList).toEqual([])
    expect(result.hasMore).toBe(false)
  })

  it('returns sorted messages and hasMore flag', async () => {
    const { selectMessageList } = await import('../../../src/main/db/ChatMessageModel')

    const result = await selectMessageList({ sessionId: 's1' })
    expect(result.dataList).toBeDefined()
    expect(typeof result.hasMore).toBe('boolean')
  })
})

describe('ChatMessageModel clearMessageAndSessionSummaryBySessionId', () => {
  beforeEach(() => {
    strictRuns.length = 0
  })

  it('clears cursor, messages, and session summary in one transaction', async () => {
    const { runInTransaction } = await import('../../../src/main/db/ADB')
    const { clearMessageAndSessionSummaryBySessionId } = await import(
      '../../../src/main/db/ChatMessageModel'
    )

    const session = await clearMessageAndSessionSummaryBySessionId('s1')

    expect(runInTransaction).toHaveBeenCalled()
    expect(session).toMatchObject({
      sessionId: 's1',
      lastMessage: '',
      noReadCount: 0
    })
    expect(strictRuns.some((run) => run.sql.includes('chat_session_clear'))).toBe(true)
    expect(strictRuns.some((run) => run.sql.includes('delete from chat_message'))).toBe(true)
    expect(strictRuns.some((run) => run.sql.includes('update chat_session_user'))).toBe(true)
  })

  it('returns null for empty sessionId', async () => {
    const { clearMessageAndSessionSummaryBySessionId } = await import(
      '../../../src/main/db/ChatMessageModel'
    )

    await expect(clearMessageAndSessionSummaryBySessionId('')).resolves.toBeNull()
  })
})

describe('ChatMessageModel selectMessageContextByMessageId', () => {
  it('returns empty array when sessionId is missing', async () => {
    const { selectMessageContextByMessageId } = await import(
      '../../../src/main/db/ChatMessageModel'
    )

    const result = await selectMessageContextByMessageId({ messageId: 1 })
    expect(result).toEqual([])
  })

  it('returns empty array when messageId is missing', async () => {
    const { selectMessageContextByMessageId } = await import(
      '../../../src/main/db/ChatMessageModel'
    )

    const result = await selectMessageContextByMessageId({ sessionId: 's1' })
    expect(result).toEqual([])
  })
})

describe('ChatMessageModel searchMessageBySessionId', () => {
  it('returns empty for missing sessionId', async () => {
    const { searchMessageBySessionId } = await import('../../../src/main/db/ChatMessageModel')

    const result = await searchMessageBySessionId({ keyword: 'hello' })
    expect(result).toEqual([])
  })

  it('returns empty for missing keyword', async () => {
    const { searchMessageBySessionId } = await import('../../../src/main/db/ChatMessageModel')

    const result = await searchMessageBySessionId({ sessionId: 's1', keyword: '' })
    expect(result).toEqual([])
  })
})
