import { beforeEach, describe, expect, it, vi } from 'vitest'

const insertedRows = []

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
  runStrict: vi.fn(async () => 1),
  update: vi.fn(async () => 1)
}))

describe('ChatMessageModel saveMessageBatch', () => {
  beforeEach(() => {
    insertedRows.length = 0
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
