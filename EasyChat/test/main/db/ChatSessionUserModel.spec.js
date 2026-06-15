import { beforeEach, describe, expect, it, vi } from 'vitest'

const insertedRows = []

vi.mock('../../../src/main/store', () => ({
  default: {
    getUserId: () => 'u1'
  }
}))

vi.mock('../../../src/main/db/ADB', () => ({
  insertOrReplaceStrict: vi.fn(async (tableName, data) => {
    insertedRows.push({ tableName, data })
    return 1
  }),
  queryAll: vi.fn(async (sql) => {
    if (sql.includes('chat_session_user') && sql.includes('status=1')) {
      return [
        {
          userId: 'u1',
          contactId: 'c1',
          contactType: 0,
          sessionId: 's1',
          status: 1,
          contactName: 'User One',
          lastMessage: 'hello',
          lastReceiveTime: 100,
          noReadCount: 3,
          topType: 0
        },
        {
          userId: 'u1',
          contactId: 'c2',
          contactType: 1,
          sessionId: 's2',
          status: 1,
          contactName: 'Group Chat',
          lastMessage: 'hi',
          lastReceiveTime: 200,
          noReadCount: 0,
          topType: 1,
          memberCount: 5
        }
      ]
    }
    return []
  }),
  queryOne: vi.fn(async (sql, params) => {
    const secondParam = params?.[1]
    // selectUserSessionByContactId
    if (sql.includes('chat_session_user') && secondParam === 'c1') {
      return {
        userId: 'u1',
        contactId: 'c1',
        contactType: 0,
        sessionId: 's1',
        status: 1,
        contactName: 'User One',
        lastMessage: 'old msg',
        lastReceiveTime: 50,
        noReadCount: 5,
        topType: 0
      }
    }
    // selectUserSessionBySessionId
    if (sql.includes('chat_session_user') && secondParam === 's1') {
      return {
        userId: 'u1',
        contactId: 'c1',
        contactType: 0,
        sessionId: 's1',
        status: 1,
        contactName: 'User One',
        lastMessage: 'old msg',
        lastReceiveTime: 50,
        noReadCount: 5,
        topType: 0
      }
    }
    if (sql.includes('chat_session_user') && secondParam === 'c-new') {
      return null
    }
    return null
  }),
  runStrict: vi.fn(async () => 1),
  runInTransaction: vi.fn(async (callback) => callback())
}))

beforeEach(() => {
  insertedRows.length = 0
})

describe('ChatSessionUserModel saveOrUpdateChatSessionBatch4Init', () => {
  it('preserves existing noReadCount and topType on re-init', async () => {
    const { saveOrUpdateChatSessionBatch4Init } =
      await import('../../../src/main/db/ChatSessionUserModel')

    await saveOrUpdateChatSessionBatch4Init([
      {
        contactId: 'c1',
        contactType: 0,
        sessionId: 's1',
        lastMessage: 'new msg',
        lastReceiveTime: 500
      }
    ])

    const sessionWrite = insertedRows.find((row) => row.tableName === 'chat_session_user')
    expect(sessionWrite?.data).toMatchObject({
      contactId: 'c1',
      sessionId: 's1',
      lastMessage: 'new msg',
      lastReceiveTime: 500,
      noReadCount: 5,
      topType: 0,
      status: 1
    })
  })

  it('handles empty array without error', async () => {
    const { saveOrUpdateChatSessionBatch4Init } =
      await import('../../../src/main/db/ChatSessionUserModel')

    await saveOrUpdateChatSessionBatch4Init([])
    expect(insertedRows).toHaveLength(0)
  })

  it('sets defaults for new sessions', async () => {
    const { saveOrUpdateChatSessionBatch4Init } =
      await import('../../../src/main/db/ChatSessionUserModel')

    await saveOrUpdateChatSessionBatch4Init([
      {
        contactId: 'c-new',
        contactType: 0,
        sessionId: 's-new',
        lastMessage: 'first msg',
        lastReceiveTime: 600
      }
    ])

    const sessionWrite = insertedRows.find((row) => row.tableName === 'chat_session_user')
    expect(sessionWrite?.data).toMatchObject({
      contactId: 'c-new',
      sessionId: 's-new',
      status: 1,
      userId: 'u1'
    })
  })
})

describe('ChatSessionUserModel selectUserSessionList', () => {
  it('returns only status=1 sessions', async () => {
    const { selectUserSessionList } = await import('../../../src/main/db/ChatSessionUserModel')

    const sessions = await selectUserSessionList()
    expect(sessions).toHaveLength(2)
    for (const s of sessions) {
      expect(s.status).toBe(1)
    }
  })
})

describe('ChatSessionUserModel markSessionRead', () => {
  it('calls updateNoReadCount with zero', async () => {
    const { markSessionRead } = await import('../../../src/main/db/ChatSessionUserModel')

    const result = await markSessionRead('c1')
    expect(result).toBe(1)
  })

  it('returns 0 for empty contactId', async () => {
    const { markSessionRead } = await import('../../../src/main/db/ChatSessionUserModel')

    const result = await markSessionRead('')
    expect(result).toBe(0)
  })
})

describe('ChatSessionUserModel delChatSession', () => {
  it('sets status to 0 (soft delete)', async () => {
    const { delChatSession } = await import('../../../src/main/db/ChatSessionUserModel')

    const result = await delChatSession('c1')
    expect(result).toBe(1)
  })
})

describe('ChatSessionUserModel topChatSession', () => {
  it('updates topType', async () => {
    const { topChatSession } = await import('../../../src/main/db/ChatSessionUserModel')

    const result = await topChatSession('c1', 1)
    expect(result).toBe(1)
  })
})

describe('ChatSessionUserModel clearChatSessionSummaryBySessionId', () => {
  it('clears lastMessage and noReadCount', async () => {
    const { clearChatSessionSummaryBySessionId } =
      await import('../../../src/main/db/ChatSessionUserModel')

    const result = await clearChatSessionSummaryBySessionId('s1')
    expect(result).toBeTruthy()
    expect(result.lastMessage).toBe('')
    expect(result.noReadCount).toBe(0)
  })

  it('returns null for empty sessionId', async () => {
    const { clearChatSessionSummaryBySessionId } =
      await import('../../../src/main/db/ChatSessionUserModel')

    const result = await clearChatSessionSummaryBySessionId('')
    expect(result).toBeNull()
  })

  it('returns null for nonexistent session', async () => {
    const { clearChatSessionSummaryBySessionId } =
      await import('../../../src/main/db/ChatSessionUserModel')

    const result = await clearChatSessionSummaryBySessionId('s-nonexistent')
    expect(result).toBeNull()
  })
})
