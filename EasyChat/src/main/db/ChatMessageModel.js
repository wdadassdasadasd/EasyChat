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
const MESSAGE_PAGE_SIZE = 20
const MESSAGE_CONTEXT_SIZE = 20
const MESSAGE_SEARCH_LIMIT = 50
const PENDING_RECOVERY_TIMEOUT_MS = 60000
let ftsUnavailable = false
const ftsBackfilledUsers = new Set()

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
    await task()
    return true
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

const backfillFtsForCurrentUser = async () => {
  const userId = store.getUserId()
  if (!userId || ftsUnavailable || ftsBackfilledUsers.has(userId)) {
    return false
  }
  return runFtsSafe(async () => {
    const sql = [
      'insert into chat_message_fts',
      '(user_id, session_id, message_id, message_content, file_name)',
      "select user_id, session_id, message_id, coalesce(message_content, ''), coalesce(file_name, '')",
      'from chat_message',
      'where user_id=? and message_id not in',
      '(select message_id from chat_message_fts where user_id=?)'
    ].join(' ')
    await runStrict(sql, [userId, userId])
    ftsBackfilledUsers.add(userId)
  }, 'backfill fts')
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

  await backfillFtsForCurrentUser()
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
  try {
    const ftsResults = await searchMessageBySessionIdFts({ sessionId, keyword })
    if (ftsResults.length > 0) {
      return ftsResults
    }
  } catch (error) {
    if (isFtsAvailableError(error)) {
      ftsUnavailable = true
    }
    console.error('FTS search failed, fallback to LIKE', error)
  }
  return searchMessageBySessionIdLike({ sessionId, keyword })
}

const recoverStalePendingMessages = async ({ timeoutMs = PENDING_RECOVERY_TIMEOUT_MS } = {}) => {
  const cutoffTime = Date.now() - Number(timeoutMs || PENDING_RECOVERY_TIMEOUT_MS)
  const sql =
    'update chat_message set status=? where user_id=? and status=? and (send_time is null or send_time<?)'
  const recoveredCount = await runStrict(sql, [0, store.getUserId(), 2, cutoffTime])
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
  searchMessageBySessionId
}
