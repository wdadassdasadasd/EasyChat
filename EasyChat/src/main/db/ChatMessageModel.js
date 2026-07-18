import store from '../store'
import {
  insertOrReplace,
  insertOrReplaceManyStrict,
  insertOrReplaceStrict,
  queryAll,
  queryOne,
  runInTransaction,
  runStrict
} from './ADB'
import { MAX_SQL_IN_PARAMS } from '../constants'
import { isV2EventEnvelope } from '../../shared/v2EventTypes'
const MESSAGE_PAGE_SIZE = 20
const MESSAGE_CONTEXT_SIZE = 20
const MESSAGE_SEARCH_LIMIT = 50
const PENDING_RECOVERY_TIMEOUT_MS = 60000
const FTS_BACKFILL_BATCH_SIZE = 100
let ftsUnavailable = false
const ftsBackfillTimers = new Map()

const getClearInfoBySessionId = (sessionId) => {
  if (!sessionId) {
    return Promise.resolve(null)
  }

  const sql =
    'select clear_message_id, clear_time from chat_session_clear where user_id=? and session_id=?'
  return queryOne(sql, [store.getUserId(), sessionId])
}

const getClearInfoMapBySessionIds = async (sessionIds = []) => {
  const ids = [...new Set(sessionIds.filter(Boolean))]
  const clearInfoMap = new Map()
  if (ids.length === 0) {
    return clearInfoMap
  }

  for (let offset = 0; offset < ids.length; offset += MAX_SQL_IN_PARAMS) {
    const batch = ids.slice(offset, offset + MAX_SQL_IN_PARAMS)
    const placeholders = batch.map(() => '?').join(',')
    const sql = `select session_id, clear_message_id, clear_time from chat_session_clear where user_id=? and session_id in (${placeholders})`
    const rows = await queryAll(sql, [store.getUserId(), ...batch])
    rows.forEach((row) => {
      if (row?.sessionId) {
        clearInfoMap.set(row.sessionId, row)
      }
    })
  }

  return clearInfoMap
}

const getMaxMessageIdBySessionId = async (sessionId) => {
  if (!sessionId) {
    return 0
  }

  const sql =
    'select max(message_id) as max_message_id from chat_message where user_id=? and session_id=?'
  const result = await queryOne(sql, [store.getUserId(), sessionId])
  return Number(result?.maxMessageId || 0)
}

const saveClearInfoBySessionId = async (sessionId, clearMessageId) => {
  if (!sessionId) {
    return 0
  }

  const previousClearInfo = await getClearInfoBySessionId(sessionId)
  const nextClearMessageId = Math.max(
    Number(previousClearInfo?.clearMessageId || 0),
    Number(clearMessageId || 0)
  )
  const nextClearTime = Math.max(Number(previousClearInfo?.clearTime || 0), Date.now())
  const sql = [
    'insert or replace into chat_session_clear',
    '(user_id, session_id, clear_message_id, clear_time)',
    'values (?, ?, ?, ?)'
  ].join(' ')

  return runStrict(sql, [store.getUserId(), sessionId, nextClearMessageId, nextClearTime])
}

const isFtsAvailableError = (error) => {
  const message = String(error?.message || error || '').toLowerCase()
  return message.includes('fts5') || message.includes('chat_message_fts')
}

const runFtsSafe = async (task, context = 'fts') => {
  if (ftsUnavailable) {
    return false
  }
  try {
    return await task()
  } catch (error) {
    if (isFtsAvailableError(error)) {
      ftsUnavailable = true
    }
    console.error(`ChatMessageModel ${context} failed`, error)
    return false
  }
}

const deleteFtsByMessageId = (messageId) => {
  if (messageId == null) {
    return Promise.resolve(false)
  }
  return runFtsSafe(
    () =>
      runStrict('delete from chat_message_fts where user_id=? and message_id=?', [
        store.getUserId(),
        messageId
      ]),
    'delete fts message'
  )
}

const upsertFtsMessage = async (message = {}) => {
  if (!message?.messageId) {
    return false
  }
  return runFtsSafe(async () => {
    await runStrict('delete from chat_message_fts where user_id=? and message_id=?', [
      store.getUserId(),
      message.messageId
    ])
    await runStrict(
      [
        'insert into chat_message_fts',
        '(user_id, session_id, message_id, message_content, file_name)',
        'values (?, ?, ?, ?, ?)'
      ].join(' '),
      [
        store.getUserId(),
        message.sessionId || '',
        message.messageId,
        message.messageContent || '',
        message.fileName || ''
      ]
    )
  }, 'upsert fts message')
}

const deleteFtsBySessionId = (sessionId) => {
  if (!sessionId) {
    return Promise.resolve(false)
  }
  return runFtsSafe(
    () =>
      runStrict('delete from chat_message_fts where user_id=? and session_id=?', [
        store.getUserId(),
        sessionId
      ]),
    'delete fts session'
  )
}

const getFtsIndexState = async (userId) => {
  if (!userId) return null
  return queryOne(
    'select status,last_row_id from fts_index_state where user_id=?',
    [userId]
  )
}

const updateFtsIndexState = async ({ userId, status, lastRowId }) => {
  await runStrict(
    'insert into fts_index_state(user_id,status,last_row_id,updated_at) values(?,?,?,?) on conflict(user_id) do update set status=excluded.status,last_row_id=excluded.last_row_id,updated_at=excluded.updated_at',
    [userId, status, Number(lastRowId || 0), Date.now()]
  )
}

const backfillFtsBatchForUser = async (userId) => {
  if (!userId || ftsUnavailable) return { complete: true }
  return await runFtsSafe(async () => {
    return await runInTransaction(async () => {
      const state = await getFtsIndexState(userId)
      if (state?.status === 'ready') return { complete: true }
      const lastRowId = Number(state?.lastRowId || 0)
      const rows = await queryAll(
        [
          'select rowid as row_id,user_id,session_id,message_id,message_content,file_name',
          'from chat_message where user_id=? and rowid>? order by rowid asc limit ?'
        ].join(' '),
        [userId, lastRowId, FTS_BACKFILL_BATCH_SIZE]
      )
      let nextRowId = lastRowId
      for (const row of rows) {
        nextRowId = Number(row.rowId || nextRowId)
        await runStrict('delete from chat_message_fts where user_id=? and message_id=?', [
          userId,
          row.messageId
        ])
        await runStrict(
          [
            'insert into chat_message_fts',
            '(user_id, session_id, message_id, message_content, file_name)',
            'values (?, ?, ?, ?, ?)'
          ].join(' '),
          [
            userId,
            row.sessionId || '',
            row.messageId,
            row.messageContent || '',
            row.fileName || ''
          ]
        )
      }
      const complete = rows.length < FTS_BACKFILL_BATCH_SIZE
      await updateFtsIndexState({ userId, status: complete ? 'ready' : 'pending', lastRowId: nextRowId })
      return { complete }
    })
  }, 'backfill fts batch')
}

const scheduleFtsBackfillForCurrentUser = () => {
  const userId = store.getUserId()
  if (!userId || ftsUnavailable || ftsBackfillTimers.has(userId)) return false

  const runNextBatch = async () => {
    let shouldContinue = false
    try {
      if (store.getUserId() !== userId) return
      const result = await backfillFtsBatchForUser(userId)
      if (!result || result.complete || store.getUserId() !== userId) return
      shouldContinue = true
    } catch (error) {
      console.error('ChatMessageModel scheduled FTS backfill failed', error)
    } finally {
      if (shouldContinue && store.getUserId() === userId) {
        ftsBackfillTimers.set(userId, setTimeout(runNextBatch, 0))
      } else {
        ftsBackfillTimers.delete(userId)
      }
    }
  }

  const timer = setTimeout(runNextBatch, 0)
  ftsBackfillTimers.set(userId, timer)
  return true
}

const filterVisibleMessages = async (messageList = []) => {
  if (!Array.isArray(messageList) || messageList.length === 0) {
    return []
  }

  // 按 sessionId 分组，每个 session 只查一次清除游标，避免 N+1 查询。
  const sessionIds = [...new Set(messageList.map((m) => m.sessionId).filter(Boolean))]
  if (sessionIds.length === 0) {
    return [...messageList]
  }

  const clearInfoMap = await getClearInfoMapBySessionIds(sessionIds)

  return messageList.filter((message) => {
    const clearInfo = clearInfoMap.get(message.sessionId)
    if (!clearInfo) {
      return true
    }
    const clearMessageId = Number(clearInfo.clearMessageId || 0)
    const clearTime = Number(clearInfo.clearTime || 0)
    const messageId = Number(message.messageId || 0)
    const sendTime = Number(message.sendTime || 0)

    // 消息满足任一可用条件即视为可见（OR 逻辑）：
    // 防止仅依赖 messageId 在服务端 ID 回绕时错误隐藏新消息。
    const hasIdFilter = clearMessageId > 0 && messageId > 0
    const hasTimeFilter = clearTime > 0 && sendTime > 0

    if (hasIdFilter && hasTimeFilter) {
      return messageId > clearMessageId || sendTime > clearTime
    }
    if (hasIdFilter) {
      return messageId > clearMessageId
    }
    if (hasTimeFilter) {
      return sendTime > clearTime
    }
    return true
  })
}

const queryExistingMessageIds = async (messageIds = []) => {
  const numericIds = messageIds.map(Number).filter((id) => id > 0)
  if (numericIds.length === 0) {
    return new Set()
  }

  const existingIds = new Set()
  // 分批查询避免 IN 子句参数过多导致 SQL 过长。
  for (let offset = 0; offset < numericIds.length; offset += MAX_SQL_IN_PARAMS) {
    const batch = numericIds.slice(offset, offset + MAX_SQL_IN_PARAMS)
    const placeholders = batch.map(() => '?').join(',')
    const sql = `select message_id from chat_message where user_id=? and message_id in (${placeholders})`
    const rows = await queryAll(sql, [store.getUserId(), ...batch])
    rows.forEach((row) => {
      if (row.messageId != null) {
        existingIds.add(String(row.messageId))
      }
    })
  }

  return existingIds
}

const filterNewMessages = async (messageList = []) => {
  if (!Array.isArray(messageList) || messageList.length === 0) {
    return []
  }

  const messageIds = messageList.map((item) => item?.messageId).filter((id) => id != null)

  const existingIdSet = await queryExistingMessageIds(messageIds)
  const localDedupSet = new Set()

  return messageList.filter((item) => {
    const messageId = item?.messageId
    if (!messageId) {
      return true
    }
    const messageKey = String(messageId)
    if (localDedupSet.has(messageKey) || existingIdSet.has(messageKey)) {
      return false
    }
    localDedupSet.add(messageKey)
    return true
  })
}

/**
 * 向查询追加清空游标过滤条件。
 * 使用 OR 逻辑：消息满足 messageId > clearMessageId 或 send_time > clearTime 任一条件即为可见，
 * 防止仅依赖 messageId 在服务端 ID 回绕/异常时错误隐藏新消息。
 */
const appendClearFilter = (sqlParts, params, clearInfo, { alias = '' } = {}) => {
  const clearMessageId = Number(clearInfo?.clearMessageId || 0)
  const clearTime = Number(clearInfo?.clearTime || 0)
  const prefix = alias ? `${alias}.` : ''

  if (clearMessageId > 0 && clearTime > 0) {
    sqlParts.push(`and (${prefix}message_id>? or ${prefix}send_time is null or ${prefix}send_time>?)`)
    params.push(clearMessageId, clearTime)
  } else if (clearMessageId > 0) {
    sqlParts.push(`and ${prefix}message_id>?`)
    params.push(clearMessageId)
  } else if (clearTime > 0) {
    sqlParts.push(`and (${prefix}send_time is null or ${prefix}send_time>?)`)
    params.push(clearTime)
  }
}

const incrementNoReadCountStrict = ({ contactId, noReadCount }) => {
  if (!contactId || !noReadCount) {
    return Promise.resolve(0)
  }
  const sql =
    'update chat_session_user set no_read_count=coalesce(no_read_count,0)+? where user_id=? and contact_id=?'
  return runStrict(sql, [noReadCount, store.getUserId(), contactId])
}

const selectSessionByContactId = (contactId) => {
  if (!contactId) {
    return Promise.resolve(null)
  }
  const sql = 'select * from chat_session_user where user_id=? and contact_id=?'
  return queryOne(sql, [store.getUserId(), contactId])
}

const upsertChatSessionPreservingState = async (session) => {
  if (!session?.contactId) {
    return null
  }

  const previous = await selectSessionByContactId(session.contactId)
  const nextSession = {
    ...previous,
    ...session,
    noReadCount: session.noReadCount ?? previous?.noReadCount ?? 0,
    topType: session.topType ?? previous?.topType,
    status: session.status ?? previous?.status ?? 1,
    userId: store.getUserId()
  }

  await insertOrReplaceStrict('chat_session_user', nextSession)
  return nextSession
}

const saveMessage = async (data) => {
  data.userId = store.getUserId()
  const result = await insertOrReplace('chat_message', data)
  await upsertFtsMessage(data)
  return result
}

const toSendSessionInfo = ({ message = {}, chatSession = {} } = {}) => {
  if (!chatSession?.contactId && !message?.contactId) {
    return null
  }

  return {
    contactId: chatSession?.contactId || message.contactId,
    contactType: chatSession?.contactType ?? message.contactType,
    sessionId: message.sessionId || chatSession?.sessionId,
    status: 1,
    contactName: chatSession?.contactName || message.contactName,
    lastMessage: message.messageContent,
    lastReceiveTime: message.sendTime || Date.now(),
    memberCount: chatSession?.memberCount,
    topType: chatSession?.topType
  }
}

// V2 MESSAGE_UPSERT events do not require a separate session event to make a
// received message visible.  Derive the same minimal session summary that the
// legacy WebSocket path writes, keeping the message, its summary and unread
// count in one transaction.
const getLatestSessionRowsForMessages = (messages = []) => {
  const sessions = new Map()
  for (const message of messages) {
    const session = toSendSessionInfo({ message })
    if (!session?.contactId) continue
    const key = String(session.contactId)
    const previous = sessions.get(key)
    if (!previous || Number(session.lastReceiveTime || 0) >= Number(previous.lastReceiveTime || 0)) {
      sessions.set(key, session)
    }
  }
  return Array.from(sessions.values())
}

const savePendingMessage = async ({ message, chatSession } = {}) => {
  if (!message?.messageId) {
    return {
      success: false,
      error: 'messageId is empty'
    }
  }

  // 发送链路先写本地 pending，再发 HTTP；消息和会话摘要必须同事务提交。
  return runInTransaction(async () => {
    const pendingMessage = {
      ...message,
      userId: store.getUserId(),
      status: message.status ?? 2
    }
    await insertOrReplaceStrict('chat_message', pendingMessage)
    await upsertFtsMessage(pendingMessage)

    const session = toSendSessionInfo({ message: pendingMessage, chatSession })
    if (session) {
      await upsertChatSessionPreservingState(session)
    }

    return {
      success: true,
      messageId: pendingMessage.messageId,
      session
    }
  })
}

const replacePendingMessage = async ({ localMessageId, message, chatSession } = {}) => {
  if (!message?.messageId) {
    return {
      success: false,
      error: 'messageId is empty'
    }
  }

  // 服务端 messageId 替换本地临时 id 时，同步更新 FTS 和会话摘要，避免搜索或列表指向旧 id。
  return runInTransaction(async () => {
    if (localMessageId && String(localMessageId) !== String(message.messageId)) {
      const deleteSql = 'delete from chat_message where user_id=? and message_id=?'
      await runStrict(deleteSql, [store.getUserId(), localMessageId])
    }

    const savedMessage = {
      ...message,
      userId: store.getUserId(),
      status: message.status ?? 1
    }
    await insertOrReplaceStrict('chat_message', savedMessage)
    if (localMessageId && String(localMessageId) !== String(savedMessage.messageId)) {
      await deleteFtsByMessageId(localMessageId)
    }
    await upsertFtsMessage(savedMessage)

    const session = toSendSessionInfo({ message: savedMessage, chatSession })
    if (session) {
      await upsertChatSessionPreservingState(session)
    }

    return {
      success: true,
      messageId: savedMessage.messageId,
      localMessageId,
      session
    }
  })
}

const saveMessageBatch = async (
  chatMessageList,
  { sessionRows = [], incrementUnread = true } = {}
) => {
  if (!Array.isArray(chatMessageList) || chatMessageList.length === 0) {
    return {
      savedCount: 0,
      savedMessages: []
    }
  }

  // 将去重 SELECT 移入事务内部，防止并发 saveMessageBatch 在 SELECT 和 INSERT 之间
  // 发生 TOCTOU 竞态，导致相同消息被重复插入且未读计数被重复累加。
  return runInTransaction(async () => {
    const visibleMessageList = await filterVisibleMessages(chatMessageList)
    if (visibleMessageList.length === 0) {
      return {
        savedCount: 0,
        savedMessages: []
      }
    }

    const newMessageList = await filterNewMessages(visibleMessageList)
    if (newMessageList.length === 0) {
      return {
        savedCount: 0,
        savedMessages: []
      }
    }

    const resolvedSessionRows =
      typeof sessionRows === 'function' ? sessionRows(newMessageList) : sessionRows
    sessionRows = resolvedSessionRows || []

    // 会话表写入与消息表写入在同一事务中，防止会话摘要指向不存在的消息。
    for (const row of sessionRows) {
      await upsertChatSessionPreservingState({
        ...row,
        status: row.status ?? 1
      })
    }

    if (incrementUnread) {
      const chatSessionCountMap = {}
      newMessageList.forEach((item) => {
        if (item.sendUserId == store.getUserId()) {
          return
        }
        const contactId = item.contactType == 1 ? item.contactId : item.sendUserId
        chatSessionCountMap[contactId] = Number(chatSessionCountMap[contactId] || 0) + 1
      })

      for (let item in chatSessionCountMap) {
        await incrementNoReadCountStrict({
          contactId: item,
          noReadCount: chatSessionCountMap[item]
        })
      }
    }

    const messagesToSave = newMessageList.map((item) => ({
      ...item,
      userId: store.getUserId()
    }))
    await insertOrReplaceManyStrict('chat_message', messagesToSave)
    for (const item of messagesToSave) {
      await upsertFtsMessage(item)
    }

    return {
      savedCount: messagesToSave.length,
      savedMessages: messagesToSave
    }
  })
}

/**
 * Applies V2 messages exactly once. The processed marker and cursor advance are
 * committed with the message/session write, so a SQLite failure cannot create a
 * false acknowledgement cursor.
 */
const applyV2Events = async (events = []) => {
  if (!Array.isArray(events)) throw new Error('events must be an array')
  for (const event of events) {
    if (!isV2EventEnvelope(event)) {
      // Do not acknowledge an event the installed client cannot interpret.
      throw new Error('Unsupported or malformed V2 event')
    }
  }
  if (!events.length) return { savedMessages: [], nextCursor: null, stateChanged: false, mediaUpdates: [], eventTypes: [] }
  return runInTransaction(async () => {
    const userId = store.getUserId()
    const unseen = []
    const mediaUpdates = []
    const eventTypes = new Set()
    let maxSequence = 0
    let stateChanged = false
    for (const event of events) {
      const sequence = Number(event.serverSequence)
      const seen = await queryOne(
        'select event_id from processed_event where user_id=? and event_id=?',
        [userId, event.eventId]
      )
      maxSequence = Math.max(maxSequence, sequence)
      if (seen) continue
      eventTypes.add(event.type)
      await runStrict(
        'insert into processed_event(user_id,event_id,server_sequence,processed_at) values(?,?,?,?)',
        [userId, event.eventId, sequence, Date.now()]
      )
      const payload = { ...(event.payload || {}) }
      // The durable direct-message target is the recipient.  SQLite stores
      // the peer as contactId for the receiving account, regardless of
      // whether the event arrived over WS or the HTTP compensation path.
      if (Number(payload.contactType) === 0 && payload.sendUserId !== userId) {
        payload.contactId = payload.sendUserId
      }
      if (event.type === 'MESSAGE_UPSERT' && payload.messageId) {
        unseen.push(payload)
      } else if (event.type === 'MEDIA_STATUS' && payload.messageId) {
        await updateMessageStatus(payload.messageId, payload.status ?? 0)
        mediaUpdates.push(payload)
        stateChanged = true
      } else {
        stateChanged = true
      }
    }
    const result = unseen.length
      ? await saveMessageBatch(unseen, {
          sessionRows: getLatestSessionRowsForMessages(unseen)
        })
      : { savedMessages: [] }
    if (maxSequence > 0) {
      await runStrict(
        'insert into sync_cursor(user_id,server_sequence,updated_at) values(?,?,?) on conflict(user_id) do update set server_sequence=max(sync_cursor.server_sequence,excluded.server_sequence),updated_at=excluded.updated_at',
        [userId, maxSequence, Date.now()]
      )
    }
    return {
      savedMessages: result.savedMessages || [],
      nextCursor: maxSequence || null,
      stateChanged,
      mediaUpdates,
      eventTypes: Array.from(eventTypes)
    }
  })
}

const getSyncCursor = async () => {
  const row = await queryOne('select server_sequence from sync_cursor where user_id=?', [
    store.getUserId()
  ])
  return Number(row?.serverSequence || 0)
}

const applyUnreadSnapshot = async (snapshot = {}) => {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return
  for (const [contactId, count] of Object.entries(snapshot)) {
    if (!contactId || !Number.isFinite(Number(count)) || Number(count) < 0) continue
    await runStrict('update chat_session_user set no_read_count=? where user_id=? and contact_id=?', [
      Math.floor(Number(count)),
      store.getUserId(),
      contactId
    ])
  }
}

const applyV2SyncPage = async ({ events = [], nextCursor, unreadSnapshot = {} } = {}) => {
  if (!Number.isSafeInteger(Number(nextCursor)) || Number(nextCursor) < 0) {
    throw new Error('nextCursor must be a non-negative safe integer')
  }
  return runInTransaction(async () => {
    const result = await applyV2Events(events)
    await applyUnreadSnapshot(unreadSnapshot)
    const currentCursor = await getSyncCursor()
    const cursor = Math.max(currentCursor, Number(nextCursor))
    await runStrict(
      'insert into sync_cursor(user_id,server_sequence,updated_at) values(?,?,?) on conflict(user_id) do update set server_sequence=excluded.server_sequence,updated_at=excluded.updated_at',
      [store.getUserId(), cursor, Date.now()]
    )
    return {
      success: true,
      savedMessages: result.savedMessages || [],
      nextCursor: cursor,
      stateChanged: result.stateChanged,
      mediaUpdates: result.mediaUpdates || [],
      eventTypes: result.eventTypes || []
    }
  })
}

const applyV2Snapshot = async ({ sessions = [], messages = [], cursor, unreadSnapshot = {} } = {}) => {
  if (!Number.isSafeInteger(Number(cursor)) || Number(cursor) < 0) {
    throw new Error('cursor must be a non-negative safe integer')
  }
  return runInTransaction(async () => {
    const userId = store.getUserId()
    await runStrict('delete from processed_event where user_id=?', [userId])
    for (const session of sessions) {
      if (!session?.contactId) continue
      await upsertChatSessionPreservingState({ ...session, userId, noReadCount: 0, status: 1 })
    }
    const result = await saveMessageBatch(messages, { incrementUnread: false })
    await applyUnreadSnapshot(unreadSnapshot)
    await runStrict(
      'insert into sync_cursor(user_id,server_sequence,updated_at) values(?,?,?) on conflict(user_id) do update set server_sequence=excluded.server_sequence,updated_at=excluded.updated_at',
      [userId, Number(cursor), Date.now()]
    )
    return { success: true, savedMessages: result.savedMessages || [], nextCursor: Number(cursor) }
  })
}

const getSnapshotProgress = async () =>
  queryOne('select snapshot_id,snapshot_cursor,next_session_cursor from snapshot_progress where user_id=?', [
    store.getUserId()
  ])

const applyV2SnapshotPage = async ({
  snapshotId,
  snapshotCursor,
  nextSessionCursor = null,
  hasMore,
  sessions = [],
  messages = [],
  unreadSnapshot = {}
} = {}) => {
  if (!snapshotId || !Number.isSafeInteger(Number(snapshotCursor)) || Number(snapshotCursor) < 0) {
    throw new Error('invalid snapshot page')
  }
  return runInTransaction(async () => {
    const userId = store.getUserId()
    const prior = await getSnapshotProgress()
    if (prior && prior.snapshotId !== snapshotId) {
      await runStrict('delete from snapshot_stage_session where user_id=?', [userId])
      await runStrict('delete from snapshot_stage_message where user_id=?', [userId])
    }
    for (const session of sessions) {
      if (!session?.contactId) continue
      await runStrict('insert or replace into snapshot_stage_session(user_id,snapshot_id,contact_id,payload) values(?,?,?,?)', [
        userId, snapshotId, session.contactId, JSON.stringify(session)
      ])
    }
    for (const message of messages) {
      if (message?.messageId == null) continue
      await runStrict('insert or replace into snapshot_stage_message(user_id,snapshot_id,message_id,payload) values(?,?,?,?)', [
        userId, snapshotId, message.messageId, JSON.stringify(message)
      ])
    }
    await runStrict('insert or replace into snapshot_progress(user_id,snapshot_id,snapshot_cursor,next_session_cursor,updated_at) values(?,?,?,?,?)', [
      userId, snapshotId, Number(snapshotCursor), nextSessionCursor, Date.now()
    ])
    if (hasMore) return { success: true, complete: false, nextSessionCursor }
    const stagedSessions = (await queryAll('select payload from snapshot_stage_session where user_id=? and snapshot_id=?', [userId, snapshotId]))
      .map((row) => JSON.parse(row.payload))
    const stagedMessages = (await queryAll('select payload from snapshot_stage_message where user_id=? and snapshot_id=?', [userId, snapshotId]))
      .map((row) => JSON.parse(row.payload))
    const visibleIds = new Set(stagedSessions.map((item) => item.contactId))
    const current = await queryAll('select contact_id from chat_session_user where user_id=?', [userId])
    for (const row of current) {
      if (!visibleIds.has(row.contactId)) await runStrict('update chat_session_user set status=0 where user_id=? and contact_id=?', [userId, row.contactId])
    }
    for (const session of stagedSessions) await upsertChatSessionPreservingState({ ...session, userId, status: 1, noReadCount: 0 })
    const result = await saveMessageBatch(stagedMessages, { incrementUnread: false })
    await applyUnreadSnapshot(unreadSnapshot)
    await runStrict('delete from processed_event where user_id=?', [userId])
    await runStrict('insert or replace into sync_cursor(user_id,server_sequence,updated_at) values(?,?,?)', [userId, Number(snapshotCursor), Date.now()])
    await runStrict('delete from snapshot_stage_session where user_id=?', [userId])
    await runStrict('delete from snapshot_stage_message where user_id=?', [userId])
    await runStrict('delete from snapshot_progress where user_id=?', [userId])
    return { success: true, complete: true, savedMessages: result.savedMessages || [], nextCursor: Number(snapshotCursor) }
  })
}

const isCurrentUserMessageFilePath = async (filePath) => {
  if (!filePath) {
    return false
  }
  const row = await queryOne(
    'select file_path from chat_message where user_id=? and file_path=? limit 1',
    [store.getUserId(), filePath]
  )
  return Boolean(row?.filePath)
}

const updateMessageStatus = (messageId, status = 1) => {
  if (!messageId) {
    return Promise.resolve()
  }
  const sql = 'update chat_message set status=? where user_id=? and message_id=?'
  return runStrict(sql, [status, store.getUserId(), messageId])
}

const updateLocalMessageStatus = async ({ messageId, status, chatSession } = {}) => {
  if (!messageId) {
    return {
      success: false,
      error: 'messageId is empty'
    }
  }

  return runInTransaction(async () => {
    await updateMessageStatus(messageId, status)

    let session = null
    if (chatSession?.contactId) {
      // 剥离 noReadCount，防止 renderer 快照中的未读数覆盖 DB 权威值。
      // 未读数只能通过 markSessionRead / incrementNoReadCountStrict 修改。
      const safeFields = { ...chatSession }
      delete safeFields.noReadCount
      session = {
        ...safeFields,
        status: chatSession.status ?? 1
      }
      session = await upsertChatSessionPreservingState(session)
    }

    return {
      success: true,
      messageId,
      status,
      session
    }
  })
}

const selectMessageList = async (query = {}) => {
  const { sessionId, beforeMessageId } = query

  if (!sessionId) {
    return {
      dataList: [],
      hasMore: false
    }
  }

  const clearInfo = await getClearInfoBySessionId(sessionId)
  const sqlParts = ['select * from chat_message where user_id=? and session_id=?']
  const params = [store.getUserId(), sessionId]
  appendClearFilter(sqlParts, params, clearInfo)

  if (beforeMessageId) {
    sqlParts.push('and message_id<?')
    params.push(beforeMessageId)
  }

  sqlParts.push('order by message_id desc limit ?')
  params.push(MESSAGE_PAGE_SIZE)

  let dataList = await queryAll(sqlParts.join(' '), params)
  dataList = dataList.sort((a, b) => a.messageId - b.messageId)

  return {
    dataList,
    hasMore: dataList.length === MESSAGE_PAGE_SIZE
  }
}

const selectMessageContextByMessageId = async ({ sessionId, messageId } = {}) => {
  if (!sessionId || !messageId) {
    return []
  }

  const clearInfo = await getClearInfoBySessionId(sessionId)
  const olderSqlParts = ['select * from chat_message where user_id=? and session_id=?']
  const olderParams = [store.getUserId(), sessionId]
  appendClearFilter(olderSqlParts, olderParams, clearInfo)
  olderSqlParts.push('and message_id<=? order by message_id desc limit ?')
  olderParams.push(messageId, MESSAGE_CONTEXT_SIZE)

  const newerSqlParts = ['select * from chat_message where user_id=? and session_id=?']
  const newerParams = [store.getUserId(), sessionId]
  appendClearFilter(newerSqlParts, newerParams, clearInfo)
  newerSqlParts.push('and message_id>? order by message_id asc limit ?')
  newerParams.push(messageId, MESSAGE_CONTEXT_SIZE)

  const olderMessages = await queryAll(olderSqlParts.join(' '), olderParams)
  const newerMessages = await queryAll(newerSqlParts.join(' '), newerParams)
  const messageMap = new Map()
  olderMessages.concat(newerMessages).forEach((message) => {
    if (message?.messageId != null) {
      messageMap.set(String(message.messageId), message)
    }
  })

  return Array.from(messageMap.values()).sort((a, b) => a.messageId - b.messageId)
}

const clearMessageBySessionId = async (sessionId) => {
  if (!sessionId) {
    return Promise.resolve(0)
  }

  return runInTransaction(async () => {
    const maxMessageId = await getMaxMessageIdBySessionId(sessionId)
    // 清空游标写入和消息删除放在同一事务中，防止游标更新后删除失败导致数据不一致。
    await saveClearInfoBySessionId(sessionId, maxMessageId)

    const sql = 'delete from chat_message where user_id=? and session_id=?'
    const result = await runStrict(sql, [store.getUserId(), sessionId])
    await deleteFtsBySessionId(sessionId)
    return result
  })
}

const clearMessageAndSessionSummaryBySessionId = async (sessionId) => {
  if (!sessionId) {
    return null
  }

  return runInTransaction(async () => {
    const maxMessageId = await getMaxMessageIdBySessionId(sessionId)
    await saveClearInfoBySessionId(sessionId, maxMessageId)

    const deleteSql = 'delete from chat_message where user_id=? and session_id=?'
    await runStrict(deleteSql, [store.getUserId(), sessionId])
    await deleteFtsBySessionId(sessionId)

    const sessionSql = 'select * from chat_session_user where user_id=? and session_id=?'
    const session = await queryOne(sessionSql, [store.getUserId(), sessionId])
    if (!session) {
      return null
    }

    const updateSessionSql =
      'update chat_session_user set last_message=?, no_read_count=? where user_id=? and session_id=?'
    await runStrict(updateSessionSql, ['', 0, store.getUserId(), sessionId])

    return {
      ...session,
      lastMessage: '',
      noReadCount: 0
    }
  })
}

const escapeLikeKeyword = (keyword = '') => {
  return String(keyword).replace(/[\\%_]/g, (match) => `\\${match}`)
}

const escapeFtsKeyword = (keyword = '') => {
  return String(keyword)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((item) => `"${item.replace(/"/g, '""')}"`)
    .join(' ')
}

const searchMessageBySessionIdLike = async ({ sessionId, keyword } = {}) => {
  const searchKey = String(keyword || '').trim()
  if (!sessionId || !searchKey) {
    return []
  }

  const clearInfo = await getClearInfoBySessionId(sessionId)
  const likeKeyword = `%${escapeLikeKeyword(searchKey)}%`
  const sqlParts = [
    'select * from chat_message',
    'where user_id=? and session_id=?',
    "and (message_content like ? escape '\\' or file_name like ? escape '\\')"
  ]
  const params = [store.getUserId(), sessionId, likeKeyword, likeKeyword]
  appendClearFilter(sqlParts, params, clearInfo)
  sqlParts.push('order by message_id desc limit ?')
  params.push(MESSAGE_SEARCH_LIMIT)

  const dataList = await queryAll(sqlParts.join(' '), params)
  return dataList || []
}

const searchMessageBySessionIdFts = async ({ sessionId, keyword } = {}) => {
  const ftsKeyword = escapeFtsKeyword(keyword)
  if (!sessionId || !ftsKeyword || ftsUnavailable) {
    return []
  }

  const clearInfo = await getClearInfoBySessionId(sessionId)
  const sqlParts = [
    'select m.* from chat_message_fts f',
    'join chat_message m on m.user_id=f.user_id and m.message_id=f.message_id',
    'where f.user_id=? and f.session_id=? and chat_message_fts match ?'
  ]
  const params = [store.getUserId(), sessionId, ftsKeyword]
  appendClearFilter(sqlParts, params, clearInfo, { alias: 'm' })
  sqlParts.push('order by m.message_id desc limit ?')
  params.push(MESSAGE_SEARCH_LIMIT)
  return await queryAll(sqlParts.join(' '), params)
}

const searchMessageBySessionId = async ({ sessionId, keyword } = {}) => {
  if (!sessionId || !keyword) return []
  const userId = store.getUserId()
  const state = await getFtsIndexState(userId)
  if (state?.status === 'ready') {
    try {
      const ftsResults = await searchMessageBySessionIdFts({ sessionId, keyword })
      if (ftsResults.length > 0) return ftsResults
    } catch (error) {
      if (isFtsAvailableError(error)) ftsUnavailable = true
      console.error('FTS search failed, fallback to LIKE', error)
    }
  } else {
    // 冷数据回填在低优先级小批次中完成；当前搜索先走完整 LIKE 结果，避免半成品索引漏查。
    scheduleFtsBackfillForCurrentUser()
  }
  return searchMessageBySessionIdLike({ sessionId, keyword })
}

const recoverStalePendingMessages = async ({
  timeoutMs = PENDING_RECOVERY_TIMEOUT_MS,
  excludeMessageIds = []
} = {}) => {
  const cutoffTime = Date.now() - Number(timeoutMs || PENDING_RECOVERY_TIMEOUT_MS)
  const userId = store.getUserId()
  const condition = 'where user_id=? and status=? and (send_time is null or send_time<?)'
  const protectedIds = new Set(excludeMessageIds.map((id) => String(id)).filter(Boolean))
  if (protectedIds.size === 0) {
    const recoveredCount = await runStrict(`update chat_message set status=? ${condition}`, [0, userId, 2, cutoffTime])
    return { success: true, recoveredCount, cutoffTime }
  }

  // SQLite 绑定参数总数受限。先找出候选 pending，再按每批 496 个 messageId 更新，
  // 保证任意数量的受保护上传任务都不会在较早批次里被误标失败。
  const rows = await queryAll(`select message_id from chat_message ${condition}`, [userId, 2, cutoffTime])
  const recoverableIds = rows
    .map((row) => String(row?.messageId || ''))
    .filter((messageId) => messageId && !protectedIds.has(messageId))
  const maxIdsPerBatch = MAX_SQL_IN_PARAMS - 4
  let recoveredCount = 0
  for (let offset = 0; offset < recoverableIds.length; offset += maxIdsPerBatch) {
    const batch = recoverableIds.slice(offset, offset + maxIdsPerBatch)
    const placeholders = batch.map(() => '?').join(',')
    recoveredCount += await runStrict(
      `update chat_message set status=? ${condition} and message_id in (${placeholders})`,
      [0, userId, 2, cutoffTime, ...batch]
    )
  }
  return {
    success: true,
    recoveredCount,
    cutoffTime
  }
}

export {
  filterNewMessages,
  filterVisibleMessages,
  saveMessage,
  savePendingMessage,
  replacePendingMessage,
  saveMessageBatch,
  applyV2Events,
  applyV2Snapshot,
  applyV2SnapshotPage,
  applyV2SyncPage,
  getSnapshotProgress,
  getSyncCursor,
  isCurrentUserMessageFilePath,
  updateMessageStatus,
  updateLocalMessageStatus,
  selectMessageList,
  selectMessageContextByMessageId,
  clearMessageBySessionId,
  clearMessageAndSessionSummaryBySessionId,
  recoverStalePendingMessages,
  searchMessageBySessionIdLike,
  searchMessageBySessionIdFts,
  searchMessageBySessionId,
  backfillFtsBatchForUser
}
