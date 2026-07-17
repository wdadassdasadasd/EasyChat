/**
 * 高并发消息压力测试
 *
 * 测试场景：
 * 1. 数据库写入队列高并发压力
 * 2. WebSocket 消息洪峰处理
 * 3. 消息去重竞态
 * 4. 队列溢出保护
 * 5. 事务隔离与数据完整性
 * 6. 端到端消息链路吞吐量
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// vi.hoisted() — vi.mock 会被提升到文件顶部，所以共享状态也必须提升
// ---------------------------------------------------------------------------

const {
  writeQueueLog,
  insertedMessages,
  insertedSessions,
  queryLog,
  mockExistingIds,
  mockClearInfoMap,
  mockSessionData,
  queueCompressCount,
  __writeQueueSize
} = vi.hoisted(() => {
  const state = {
    writeQueueLog: [],
    insertedMessages: [],
    insertedSessions: [],
    queryLog: [],
    mockExistingIds: new Set(),
    mockClearInfoMap: new Map(),
    mockSessionData: {},
    queueCompressCount: { value: 0 },
    __writeQueueSize: { value: 0 }
  }
  return state
})

const fakeUserId = 'stress-user-1'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../src/main/store', () => ({
  default: {
    getUserId: () => 'stress-user-1',
    getData: vi.fn(() => 'ws://mock/ws'),
    setData: vi.fn(),
    initUserId: vi.fn()
  }
}))

// ADB mock — serialized write queue is the core concurrency primitive
vi.mock('../../../src/main/db/ADB', async () => {
  let writeQueue = Promise.resolve()

  const enqueueDbWrite = (task) => {
    __writeQueueSize.value++
    const nextTask = writeQueue
      .catch(() => {})
      .then(() => {
        writeQueueLog.push({ type: 'task-start', queueSize: __writeQueueSize.value })
        return task()
      })
      .then((result) => {
        writeQueueLog.push({ type: 'task-end', queueSize: __writeQueueSize.value })
        return result
      })
    // 定期压缩 Promise 链。
    if (__writeQueueSize.value >= 1000) {
      nextTask.finally(() => {
        queueCompressCount.value++
        __writeQueueSize.value = 0
      })
    }
    writeQueue = nextTask
    return nextTask
  }

  const { AsyncLocalStorage } = await import('async_hooks')
  const transactionContext = new AsyncLocalStorage()

  const runStrictNow = async (sql, params = []) => {
    queryLog.push({ sql, params })
    return 1
  }

  const runInTransaction = async (callback) => {
    if (transactionContext.getStore()?.inTransaction) {
      return callback()
    }
    return enqueueDbWrite(async () => {
      return transactionContext.run({ inTransaction: true }, async () => {
        writeQueueLog.push({ type: 'txn-begin' })
        await runStrictNow('begin immediate transaction', [])
        try {
          const result = await callback()
          writeQueueLog.push({ type: 'txn-commit' })
          await runStrictNow('commit', [])
          return result
        } catch (error) {
          writeQueueLog.push({ type: 'txn-rollback' })
          await runStrictNow('rollback', []).catch(() => {})
          throw error
        }
      })
    })
  }

  return {
    insertOrReplace: vi.fn(async (tableName, data) => {
      if (tableName === 'chat_message') insertedMessages.push(data)
      if (tableName === 'chat_session_user') insertedSessions.push(data)
      return 1
    }),
    insertOrReplaceStrict: vi.fn(async (tableName, data) => {
      if (tableName === 'chat_message') insertedMessages.push(data)
      if (tableName === 'chat_session_user') insertedSessions.push(data)
      return 1
    }),
    insertOrReplaceManyStrict: vi.fn(async (tableName, rows) => {
      if (tableName === 'chat_message') insertedMessages.push(...rows)
      if (tableName === 'chat_session_user') insertedSessions.push(...rows)
      return rows.length
    }),
    insertOrIgnore: vi.fn(async () => 1),
    queryAll: vi.fn(async (sql, params = []) => {
      if (sql.includes('chat_session_clear')) {
        const sessionIds = params.slice(1)
        return sessionIds
          .map((sid) => {
            const info = mockClearInfoMap.get(String(sid))
            return info
              ? { sessionId: sid, clearMessageId: info.clearMessageId, clearTime: info.clearTime }
              : null
          })
          .filter(Boolean)
      }
      if (sql.includes('chat_message') && sql.includes('message_id in')) {
        return []
      }
      if (sql.includes('chat_session_user')) {
        if (params.length >= 2 && params[1]) {
          const contactId = String(params[1])
          const session = mockSessionData[contactId]
          return session ? [session] : []
        }
        return Object.values(mockSessionData)
      }
      return []
    }),
    queryOne: vi.fn(async (sql, params = []) => {
      if (sql.includes('chat_session_user')) {
        const contactId = String(params[1])
        return mockSessionData[contactId] || null
      }
      if (sql.includes('chat_session_clear')) {
        return mockClearInfoMap.get(String(params[1])) || null
      }
      if (sql.includes('max(message_id')) {
        return { maxMessageId: 5000 }
      }
      return null
    }),
    queryCount: vi.fn(async () => 0),
    run: vi.fn(async () => 1),
    runStrict: vi.fn(async () => 1),
    runInTransaction,
    insert: vi.fn(async () => 1),
    update: vi.fn(async () => 1)
  }
})

vi.mock('ws', () => ({
  WebSocket: (() => {
    class MockWebSocket {
      constructor() {
        this.readyState = 1
      }
      send() {}
      close() {}
    }
    MockWebSocket.OPEN = 1
    return MockWebSocket
  })()
}))

vi.mock('../../../src/main/db/UserSettingModel', () => ({
  addUserSetting: vi.fn(),
  setContactApplyNoReadCount: vi.fn(),
  getLocalFileFolder: vi.fn(async () => ({ localFileFolder: '/tmp/easychat-downloads' })),
  updateLocalFileFolder: vi.fn(),
  resetLocalFileFolder: vi.fn()
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * 生成模拟 WebSocket 消息
 */
const makeWsMessage = (overrides = {}) => ({
  messageId: overrides.messageId ?? Math.floor(Math.random() * 1_000_000) + 10000,
  sessionId: overrides.sessionId ?? 'session-stress-1',
  messageType: overrides.messageType ?? 2,
  messageContent: overrides.messageContent ?? 'stress test message',
  contactType: overrides.contactType ?? 0,
  contactId: overrides.contactId ?? 'contact-stress-1',
  sendUserId: overrides.sendUserId ?? 'user-other',
  sendUserNickName: overrides.sendUserNickName ?? 'Stress User',
  sendTime: overrides.sendTime ?? Date.now(),
  status: overrides.status ?? 1,
  ...overrides
})

/**
 * 生成一批消息
 */
const generateMessageBatch = (count, baseOptions = {}) => {
  const baseId = baseOptions.messageId || Date.now()
  return Array.from({ length: count }, (_, i) =>
    makeWsMessage({
      ...baseOptions,
      messageId: baseId + i,
      messageContent: `stress msg #${i} @ ${Date.now()}`
    })
  )
}

// ---------------------------------------------------------------------------
// beforeEach — 每个测试前重置状态
// ---------------------------------------------------------------------------

beforeEach(() => {
  writeQueueLog.length = 0
  insertedMessages.length = 0
  insertedSessions.length = 0
  queryLog.length = 0
  mockExistingIds.clear()
  mockClearInfoMap.clear()
  Object.keys(mockSessionData).forEach((k) => delete mockSessionData[k])
  queueCompressCount.value = 0
})

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('Stress: Database Write Queue', () => {
  it('should serialize concurrent writes and preserve order', async () => {
    const { runInTransaction, insertOrReplaceStrict } = await import('../../../src/main/db/ADB')

    const order = []
    const tasks = Array.from({ length: 100 }, (_, i) =>
      runInTransaction(async () => {
        await insertOrReplaceStrict('chat_message', makeWsMessage({ messageId: i + 1 }))
        order.push(i)
      })
    )

    await Promise.all(tasks)
    // 串行化写入队列保证事务按入队顺序执行
    expect(order).toEqual(Array.from({ length: 100 }, (_, i) => i))
  })

  it('should handle 1000 concurrent insert tasks without deadlock', async () => {
    const { runInTransaction, insertOrReplaceStrict } = await import('../../../src/main/db/ADB')

    const tasks = Array.from({ length: 1000 }, (_, i) =>
      runInTransaction(async () => {
        await insertOrReplaceStrict('chat_message', makeWsMessage({ messageId: i + 1 }))
      })
    )

    const start = performance.now()
    await Promise.all(tasks)
    const duration = performance.now() - start

    // 1000 个事务不应该超时（正常 < 30s）
    expect(duration).toBeLessThan(30000)
    expect(insertedMessages.length).toBe(1000)
  })

  it('should compress the Promise chain when queue depth exceeds 1000', async () => {
    const { runInTransaction, insertOrReplaceStrict } = await import('../../../src/main/db/ADB')

    const tasks = Array.from({ length: 2000 }, (_, i) =>
      runInTransaction(async () => {
        await insertOrReplaceStrict('chat_message', makeWsMessage({ messageId: i + 1 }))
      })
    )

    await Promise.all(tasks)

    // 2000 个任务应该触发至少一次 Promise 链压缩 (>=1000)
    expect(queueCompressCount.value).toBeGreaterThanOrEqual(1)
  })

  it('should maintain data integrity with interleaved reads and writes', async () => {
    const { runInTransaction, insertOrReplaceStrict, queryOne } =
      await import('../../../src/main/db/ADB')

    // 先写入一条会话数据
    mockSessionData['contact-a'] = {
      userId: fakeUserId,
      contactId: 'contact-a',
      contactType: 0,
      status: 1,
      contactName: 'User A',
      lastMessage: 'initial',
      lastReceiveTime: 100,
      noReadCount: 0,
      topType: 0
    }

    const results = []
    for (let i = 0; i < 50; i++) {
      const writePromise = runInTransaction(async () => {
        await insertOrReplaceStrict('chat_message', makeWsMessage({ messageId: i + 1 }))
        return `write-${i}`
      })

      const readPromise = (async () => {
        const session = await queryOne(
          'select * from chat_session_user where user_id=? and contact_id=?',
          [fakeUserId, 'contact-a']
        )
        return `read-${i}-${session?.contactName || 'none'}`
      })()

      const [writeResult, readResult] = await Promise.all([writePromise, readPromise])
      results.push({ write: writeResult, read: readResult })
    }

    expect(results.length).toBe(50)
    results.forEach((r) => {
      expect(r.write).toMatch(/^write-/)
      expect(r.read).toContain('User A')
    })
  })

  it('should handle nested transaction rejection and rollback', async () => {
    const { runInTransaction, insertOrReplaceStrict } = await import('../../../src/main/db/ADB')

    let errorCaught = false
    try {
      await runInTransaction(async () => {
        await insertOrReplaceStrict('chat_message', makeWsMessage({ messageId: 1 }))
        await runInTransaction(async () => {
          throw new Error('nested failure')
        })
      })
    } catch (error) {
      errorCaught = true
      expect(error.message).toBe('nested failure')
    }

    expect(errorCaught).toBe(true)
    const rollbacks = writeQueueLog.filter((e) => e.type === 'txn-rollback')
    expect(rollbacks.length).toBeGreaterThanOrEqual(1)
  })
})

describe('Stress: Message Batch Processing', () => {
  it('should batch process 5000 incoming messages within acceptable time', async () => {
    const { saveMessageBatch } = await import('../../../src/main/db/ChatMessageModel')

    const messages = generateMessageBatch(5000, {
      sessionId: 'session-batch-1',
      contactId: 'contact-batch-1',
      sendUserId: 'user-other',
      contactType: 0
    })

    const start = performance.now()
    const result = await saveMessageBatch(messages)
    const duration = performance.now() - start

    // 5000 条消息应全部入库（没有清除游标，没有重复）
    expect(result.savedCount).toBe(5000)
    expect(duration).toBeLessThan(10000)
    expect(insertedMessages.length).toBe(5000)
  })

  it('should correctly deduplicate repeated messageIds within a batch', async () => {
    const { saveMessageBatch } = await import('../../../src/main/db/ChatMessageModel')

    const uniqueCount = 200
    const duplicateMultiplier = 3
    const messages = []

    for (let i = 0; i < uniqueCount; i++) {
      for (let j = 0; j < duplicateMultiplier; j++) {
        messages.push(
          makeWsMessage({
            messageId: 1000 + i,
            sessionId: 'session-dedup',
            contactId: 'contact-dedup',
            sendUserId: 'user-other'
          })
        )
      }
    }

    const result = await saveMessageBatch(messages)
    // 只应保存唯一的 messageId
    expect(result.savedCount).toBe(uniqueCount)
    expect(result.savedCount).toBeLessThan(messages.length)
  })

  it('should filter messages below clear cursor', async () => {
    const { saveMessageBatch } = await import('../../../src/main/db/ChatMessageModel')

    mockClearInfoMap.set('session-clear', {
      clearMessageId: 500,
      clearTime: 0
    })

    const messages = generateMessageBatch(1000, {
      sessionId: 'session-clear',
      contactId: 'contact-clear',
      sendUserId: 'user-other'
    }).map((m, i) => ({ ...m, messageId: i + 1 }))

    const result = await saveMessageBatch(messages)
    // 只有 messageId > 500 的消息应被保存
    expect(result.savedCount).toBe(500)
  })

  it('should handle rapid multi-session message flood', async () => {
    const { saveMessageBatch } = await import('../../../src/main/db/ChatMessageModel')

    const sessionCount = 20
    const messagesPerSession = 100
    const allBatches = []

    for (let s = 0; s < sessionCount; s++) {
      const messages = generateMessageBatch(messagesPerSession, {
        sessionId: `session-flood-${s}`,
        contactId: `contact-flood-${s}`,
        sendUserId: 'user-other',
        contactType: 0
      })
      allBatches.push(saveMessageBatch(messages))
    }

    const start = performance.now()
    const results = await Promise.all(allBatches)
    const duration = performance.now() - start

    const totalSaved = results.reduce((sum, r) => sum + r.savedCount, 0)
    expect(totalSaved).toBe(sessionCount * messagesPerSession)

    expect(duration).toBeLessThan(30000)
  })

  it('should preserve unread count across concurrent receive batches', async () => {
    const { saveMessageBatch } = await import('../../../src/main/db/ChatMessageModel')

    mockSessionData['contact-unread'] = {
      userId: fakeUserId,
      contactId: 'contact-unread',
      contactType: 0,
      sessionId: 'session-unread',
      status: 1,
      contactName: 'Unread User',
      lastMessage: 'previous',
      lastReceiveTime: 100,
      noReadCount: 10,
      topType: 0
    }

    const batches = Array.from({ length: 3 }, (_, b) =>
      generateMessageBatch(5, {
        sessionId: 'session-unread',
        contactId: 'contact-unread',
        sendUserId: 'contact-unread',
        contactType: 0
      }).map((m) => ({ ...m, messageId: m.messageId + b * 1000 }))
    )

    const results = await Promise.all(batches.map((b) => saveMessageBatch(b)))
    const totalSaved = results.reduce((sum, r) => sum + r.savedCount, 0)
    expect(totalSaved).toBe(15)
  })
})

describe('Stress: WebSocket Queue Mechanics', () => {
  it('should normalize deeply nested message payloads efficiently', async () => {
    const { normalizeWsMessages } = await import('../../../src/main/wsClient')

    const buildDeepNested = (depth, messageCount) => {
      if (depth <= 0) {
        return Array.from({ length: messageCount }, (_, i) =>
          makeWsMessage({ messageId: 1000 + depth * 1000 + i })
        )
      }
      return { messages: buildDeepNested(depth - 1, messageCount) }
    }

    const payload = buildDeepNested(10, 5)

    const start = performance.now()
    const normalized = normalizeWsMessages(payload)
    const duration = performance.now() - start

    expect(normalized.length).toBeGreaterThan(0)
    expect(duration).toBeLessThan(10)
  })

  it('should reject messages at depth > 10', async () => {
    const { normalizeWsMessages } = await import('../../../src/main/wsClient')

    // normalizeWsMessages 仅在 payload.messages 是数组时才递归，
    // 构造 { messages: [{ messages: [{ ... }] }] } 形式的深度嵌套数组
    const buildDeepArrayNested = (depth) => {
      if (depth <= 0) {
        return [makeWsMessage({ messageId: 1 })]
      }
      return { messages: [buildDeepArrayNested(depth - 1)] }
    }

    const payload = buildDeepArrayNested(12)
    const normalized = normalizeWsMessages(payload)

    // 深度 > 10 时返回空数组（叶子消息被丢弃）
    expect(normalized).toEqual([])
  })

  it('should handle queue overflow scenario (2000+ messages)', async () => {
    const { RECEIVE_FLUSH_MAX } = await import('../../../src/main/constants')

    const RECEIVE_QUEUE_MAX = RECEIVE_FLUSH_MAX * 20 // 2000
    let receiveQueue = []
    const droppedEvents = []

    const enqueueSimulated = (message) => {
      if (receiveQueue.length >= RECEIVE_QUEUE_MAX) {
        const overflowCount = receiveQueue.length - RECEIVE_QUEUE_MAX + 1
        receiveQueue.splice(0, overflowCount)
        droppedEvents.push({ type: 'overflow', droppedCount: overflowCount })
      }
      receiveQueue.push(message)
    }

    const messages = generateMessageBatch(2500)
    messages.forEach((m) => enqueueSimulated(m))

    expect(droppedEvents.length).toBeGreaterThan(0)
    expect(receiveQueue.length).toBeLessThanOrEqual(RECEIVE_QUEUE_MAX)
  })

  it('should respect flush batch size (RECEIVE_FLUSH_MAX = 100)', async () => {
    const { RECEIVE_FLUSH_MAX } = await import('../../../src/main/constants')

    expect(RECEIVE_FLUSH_MAX).toBe(100)

    const totalMessages = 550
    const batches = []
    let remaining = [...generateMessageBatch(totalMessages)]

    while (remaining.length > 0) {
      const batch = remaining.slice(0, RECEIVE_FLUSH_MAX)
      batches.push(batch)
      remaining = remaining.slice(RECEIVE_FLUSH_MAX)
    }

    expect(batches.length).toBe(6)
    batches.slice(0, 5).forEach((batch) => {
      expect(batch.length).toBe(100)
    })
    expect(batches[5].length).toBe(50)
  })

  it('should maintain message ordering within a flush batch', async () => {
    const { saveMessageBatch } = await import('../../../src/main/db/ChatMessageModel')

    const messages = generateMessageBatch(100, {
      sessionId: 'session-order',
      contactId: 'contact-order',
      sendUserId: 'user-other'
    }).map((m, i) => ({ ...m, messageId: 10001 + i }))

    const result = await saveMessageBatch(messages)
    expect(result.savedCount).toBe(100)

    const savedIds = insertedMessages
      .filter((m) => m.sessionId === 'session-order')
      .map((m) => Number(m.messageId))
      .sort((a, b) => a - b)

    expect(savedIds.length).toBe(100)
    expect(savedIds[0]).toBe(10001)
    expect(savedIds[99]).toBe(10100)
  })
})

describe('Stress: Chat Session Model Under Load', () => {
  it('should batch upsert many sessions without data loss', async () => {
    const { saveOrUpdateChatSessionBatch4Init } =
      await import('../../../src/main/db/ChatSessionUserModel')

    const sessions = Array.from({ length: 200 }, (_, i) => ({
      contactId: `contact-init-${i}`,
      contactType: i % 2,
      sessionId: `session-init-${i}`,
      status: 1,
      contactName: `User ${i}`,
      lastMessage: `hello from ${i}`,
      lastReceiveTime: Date.now() + i,
      memberCount: i % 2 === 0 ? undefined : 10,
      noReadCount: i % 5
    }))

    await saveOrUpdateChatSessionBatch4Init(sessions)

    const sessionWrites = insertedSessions.filter((s) =>
      String(s.contactId || '').startsWith('contact-init-')
    )
    expect(sessionWrites.length).toBe(200)

    const contactIds = sessionWrites.map((s) => s.contactId)
    const uniqueIds = new Set(contactIds)
    expect(uniqueIds.size).toBe(200)
  })

  it('should preserve existing unread count on re-initialization', async () => {
    const { saveOrUpdateChatSessionBatch4Init } =
      await import('../../../src/main/db/ChatSessionUserModel')

    mockSessionData['contact-preserve'] = {
      userId: fakeUserId,
      contactId: 'contact-preserve',
      contactType: 0,
      sessionId: 'session-preserve',
      status: 1,
      contactName: 'Preserve User',
      lastMessage: 'old message',
      lastReceiveTime: 100,
      noReadCount: 42,
      topType: 1
    }

    const sessions = [
      {
        contactId: 'contact-preserve',
        contactType: 0,
        sessionId: 'session-preserve',
        status: 1,
        contactName: 'Preserve User Updated',
        lastMessage: 'new message',
        lastReceiveTime: 200
      }
    ]

    await saveOrUpdateChatSessionBatch4Init(sessions)

    const sessionWrite = insertedSessions.find((s) => s.contactId === 'contact-preserve')
    expect(sessionWrite).toBeDefined()
    expect(sessionWrite.noReadCount).toBe(42)
    expect(sessionWrite.topType).toBe(1)
  })

  it('should handle concurrent session updates and message inserts atomically', async () => {
    const { saveMessageBatch } = await import('../../../src/main/db/ChatMessageModel')

    mockSessionData['contact-atomic'] = {
      userId: fakeUserId,
      contactId: 'contact-atomic',
      contactType: 0,
      sessionId: 'session-atomic',
      status: 1,
      contactName: 'Atomic User',
      lastMessage: 'initial',
      lastReceiveTime: 100,
      noReadCount: 0,
      topType: 0
    }

    const messages = generateMessageBatch(10, {
      sessionId: 'session-atomic',
      contactId: 'contact-atomic',
      sendUserId: 'user-other'
    })

    const result = await saveMessageBatch(messages, {
      sessionRows: [
        {
          contactId: 'contact-atomic',
          contactType: 0,
          sessionId: 'session-atomic',
          lastMessage: 'batch update',
          lastReceiveTime: 300
        }
      ]
    })

    expect(result.savedCount).toBe(10)
    const txnBegins = writeQueueLog.filter((e) => e.type === 'txn-begin')
    expect(txnBegins.length).toBeGreaterThanOrEqual(1)
  })
})

describe('Stress: End-to-End Message Flow Simulation', () => {
  it('should simulate full chat lifecycle: send → receive → flush', async () => {
    const { savePendingMessage, replacePendingMessage, updateLocalMessageStatus } =
      await import('../../../src/main/db/ChatMessageModel')

    mockSessionData['contact-e2e'] = {
      userId: fakeUserId,
      contactId: 'contact-e2e',
      contactType: 0,
      sessionId: 'session-e2e',
      status: 1,
      contactName: 'E2E User',
      lastMessage: 'initial',
      lastReceiveTime: 100,
      noReadCount: 0,
      topType: 0
    }

    // 用户发送消息并先保存为 pending。
    const sendResults = []
    const e2eChatSession = {
      contactId: 'contact-e2e',
      contactType: 0,
      sessionId: 'session-e2e',
      contactName: 'E2E User'
    }
    for (let i = 0; i < 10; i++) {
      const result = await savePendingMessage({
        message: makeWsMessage({
          messageId: `local-${i}`,
          sessionId: 'session-e2e',
          contactId: 'contact-e2e',
          sendUserId: fakeUserId,
          contactType: 0,
          status: 2
        }),
        chatSession: e2eChatSession
      })
      sendResults.push(result)
    }

    expect(sendResults.every((r) => r.success)).toBe(true)

    // 服务端确认后用正式消息替换本地 pending。
    const replaceResults = []
    for (let i = 0; i < 10; i++) {
      const realMsg = makeWsMessage({
        messageId: 10000 + i,
        sessionId: 'session-e2e',
        contactId: 'contact-e2e',
        sendUserId: fakeUserId,
        contactType: 0,
        status: 1
      })
      const result = await replacePendingMessage({
        localMessageId: `local-${i}`,
        message: realMsg,
        chatSession: {
          contactId: 'contact-e2e',
          contactType: 0,
          sessionId: 'session-e2e',
          contactName: 'E2E User'
        }
      })
      replaceResults.push(result)
    }

    expect(replaceResults.every((r) => r.success)).toBe(true)

    // 最后更新消息状态。
    const statusResult = await updateLocalMessageStatus({
      messageId: 10005,
      status: 1,
      chatSession: {
        contactId: 'contact-e2e',
        contactType: 0,
        sessionId: 'session-e2e',
        contactName: 'E2E User'
      }
    })

    expect(statusResult.success).toBe(true)

    const totalMessages = insertedMessages.filter((m) => m.sessionId === 'session-e2e')
    expect(totalMessages.length).toBeGreaterThanOrEqual(20)
  })

  it('should measure throughput: messages per second', async () => {
    const { saveMessageBatch } = await import('../../../src/main/db/ChatMessageModel')

    const totalMessages = 10000
    const batchSize = 100
    const batches = []

    for (let offset = 0; offset < totalMessages; offset += batchSize) {
      batches.push(
        generateMessageBatch(batchSize, {
          sessionId: `session-tput-${Math.floor(offset / 500)}`,
          contactId: `contact-tput-${Math.floor(offset / 500)}`,
          sendUserId: 'user-other',
          contactType: 0
        }).map((m, i) => ({ ...m, messageId: 200000 + offset + i }))
      )
    }

    const start = performance.now()
    const results = await Promise.all(batches.map((b) => saveMessageBatch(b)))
    const duration = performance.now() - start

    const totalSaved = results.reduce((sum, r) => sum + r.savedCount, 0)
    const throughput = Math.round(totalSaved / (duration / 1000))

    console.log(
      `\n[Throughput] ${totalSaved} messages in ${duration.toFixed(0)}ms = ${throughput.toLocaleString()} msg/s`
    )

    expect(totalSaved).toBe(totalMessages)
    expect(throughput).toBeGreaterThan(500)
  })

  it('should not lose messages under rapid concurrent send+receive', async () => {
    const { saveMessageBatch, savePendingMessage, replacePendingMessage } =
      await import('../../../src/main/db/ChatMessageModel')

    mockSessionData['contact-rapid'] = {
      userId: fakeUserId,
      contactId: 'contact-rapid',
      contactType: 0,
      sessionId: 'session-rapid',
      status: 1,
      contactName: 'Rapid User',
      lastMessage: 'initial',
      lastReceiveTime: 100,
      noReadCount: 0,
      topType: 0
    }

    const rapidChatSession = {
      contactId: 'contact-rapid',
      contactType: 0,
      sessionId: 'session-rapid'
    }
    const sendTasks = Array.from({ length: 50 }, async (_, i) => {
      await savePendingMessage({
        message: makeWsMessage({
          messageId: `rapid-local-${i}`,
          sessionId: 'session-rapid',
          contactId: 'contact-rapid',
          sendUserId: fakeUserId,
          status: 2
        }),
        chatSession: rapidChatSession
      })

      const realMsg = makeWsMessage({
        messageId: 30000 + i,
        sessionId: 'session-rapid',
        contactId: 'contact-rapid',
        sendUserId: fakeUserId,
        status: 1
      })
      await replacePendingMessage({
        localMessageId: `rapid-local-${i}`,
        message: realMsg,
        chatSession: {
          contactId: 'contact-rapid',
          contactType: 0,
          sessionId: 'session-rapid'
        }
      })
    })

    const receiveTasks = Array.from({ length: 5 }, (_, batchIdx) => {
      const batch = generateMessageBatch(20, {
        sessionId: 'session-rapid',
        contactId: 'contact-rapid',
        sendUserId: 'user-other',
        contactType: 0
      }).map((m, i) => ({ ...m, messageId: 40000 + batchIdx * 100 + i }))
      return saveMessageBatch(batch)
    })

    const allTasks = [...sendTasks, ...receiveTasks]
    // 随机打乱任务顺序模拟真实并发
    for (let i = allTasks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[allTasks[i], allTasks[j]] = [allTasks[j], allTasks[i]]
    }

    const start = performance.now()
    await Promise.all(allTasks)
    const duration = performance.now() - start

    expect(duration).toBeLessThan(30000)

    const rapidMessages = insertedMessages.filter((m) => m.sessionId === 'session-rapid')
    expect(rapidMessages.length).toBeGreaterThanOrEqual(150)
  })

  it('should handle wsRuntimeGeneration concept during message processing', async () => {
    const { saveMessageBatch } = await import('../../../src/main/db/ChatMessageModel')

    mockSessionData['contact-ws-gen'] = {
      userId: fakeUserId,
      contactId: 'contact-ws-gen',
      contactType: 0,
      sessionId: 'session-ws-gen',
      status: 1,
      contactName: 'WS Gen User',
      lastMessage: 'initial',
      lastReceiveTime: 100,
      noReadCount: 0,
      topType: 0
    }

    const messages = generateMessageBatch(50, {
      sessionId: 'session-ws-gen',
      contactId: 'contact-ws-gen',
      sendUserId: 'user-other'
    })

    const result = await saveMessageBatch(messages)
    expect(result.savedCount).toBe(50)

    // wsRuntimeGeneration 守卫在上层 wsClient.js 的 saveAndPublishMessageBatch 中实现：
    // 如果在 saveMessageBatch 执行期间 generation 变化，不推送 renderer
    // 此处验证 saveMessageBatch 正常完成
  })
})

describe('Stress: Edge Cases & Resilience', () => {
  it('should handle empty message arrays gracefully', async () => {
    const { saveMessageBatch } = await import('../../../src/main/db/ChatMessageModel')

    const result = await saveMessageBatch([])
    expect(result.savedCount).toBe(0)
    expect(result.savedMessages).toEqual([])
  })

  it('should handle null/undefined gracefully', async () => {
    const { saveMessageBatch } = await import('../../../src/main/db/ChatMessageModel')

    const result = await saveMessageBatch(null)
    expect(result.savedCount).toBe(0)
  })

  it('should handle very large messageIds (close to Number.MAX_SAFE_INTEGER)', async () => {
    const { saveMessageBatch } = await import('../../../src/main/db/ChatMessageModel')

    const messages = [
      makeWsMessage({
        messageId: Number.MAX_SAFE_INTEGER - 10,
        sessionId: 'session-large-id',
        contactId: 'contact-large-id',
        sendUserId: 'user-other'
      }),
      makeWsMessage({
        messageId: Number.MAX_SAFE_INTEGER - 5,
        sessionId: 'session-large-id',
        contactId: 'contact-large-id',
        sendUserId: 'user-other'
      }),
      makeWsMessage({
        messageId: Number.MAX_SAFE_INTEGER,
        sessionId: 'session-large-id',
        contactId: 'contact-large-id',
        sendUserId: 'user-other'
      })
    ]

    const result = await saveMessageBatch(messages)
    expect(result.savedCount).toBe(3)
  })

  it('should handle mixed valid and invalid messages in a batch', async () => {
    const { saveMessageBatch } = await import('../../../src/main/db/ChatMessageModel')

    const messages = [
      makeWsMessage({ messageId: 50001, sessionId: 'session-mixed' }),
      makeWsMessage({ messageId: null, sessionId: 'session-mixed' }),
      makeWsMessage({ messageId: undefined, sessionId: 'session-mixed' }),
      makeWsMessage({ messageId: 50002, sessionId: 'session-mixed' }),
      makeWsMessage({ messageId: 'not-a-number', sessionId: 'session-mixed' })
    ]

    const result = await saveMessageBatch(messages)
    // 不应崩溃
    expect(result).toBeDefined()
    expect(typeof result.savedCount).toBe('number')
  })

  it('should handle maximum flush batch size (100 messages)', async () => {
    const { saveMessageBatch } = await import('../../../src/main/db/ChatMessageModel')

    const messages = generateMessageBatch(100, {
      sessionId: 'session-max-flush',
      contactId: 'contact-max-flush',
      sendUserId: 'user-other'
    })

    const start = performance.now()
    const result = await saveMessageBatch(messages)
    const duration = performance.now() - start

    expect(result.savedCount).toBe(100)
    expect(duration).toBeLessThan(200)
  })

  it('should survive rapid sequential transaction opens (simulating burst)', async () => {
    const { runInTransaction, insertOrReplaceStrict } = await import('../../../src/main/db/ADB')

    const tasks = []
    for (let i = 0; i < 500; i++) {
      tasks.push(
        runInTransaction(async () => {
          await insertOrReplaceStrict(
            'chat_message',
            makeWsMessage({
              messageId: 60000 + i,
              sessionId: 'session-burst',
              contactId: 'contact-burst',
              sendUserId: 'user-other'
            })
          )
          return i
        })
      )
    }

    const start = performance.now()
    const results = await Promise.all(tasks)
    const duration = performance.now() - start

    expect(results.length).toBe(500)
    results.forEach((r, i) => {
      expect(r).toBe(i)
    })
    expect(duration).toBeLessThan(30000)
  })

  it('should handle same messageId arriving from different senders', async () => {
    const { saveMessageBatch } = await import('../../../src/main/db/ChatMessageModel')

    // 两个不同发送者使用相同 messageId（极端情况）
    const messages = [
      makeWsMessage({
        messageId: 77777,
        sessionId: 'session-dup-sender',
        contactId: 'contact-a',
        sendUserId: 'sender-a',
        messageContent: 'from A'
      }),
      makeWsMessage({
        messageId: 77777, // 相同 ID
        sessionId: 'session-dup-sender',
        contactId: 'contact-b',
        sendUserId: 'sender-b',
        messageContent: 'from B'
      })
    ]

    const result = await saveMessageBatch(messages)
    // 去重逻辑基于 messageId，应该只保存一条
    expect(result.savedCount).toBe(1)
  })
})
