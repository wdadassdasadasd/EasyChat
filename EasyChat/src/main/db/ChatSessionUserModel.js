import store from '../store'
import { insertOrReplaceStrict, queryAll, queryOne, runStrict, runInTransaction } from './ADB'

const selectUserSessionByContactId = (contactId) => {
  if (!contactId) {
    return Promise.resolve(null)
  }
  const sql = 'select * from chat_session_user where user_id=? and contact_id=?'
  return queryOne(sql, [store.getUserId(), contactId])
}

const upsertSessionPreservingState = async (sessionInfo) => {
  if (!sessionInfo?.contactId) {
    return null
  }

  const previous = await selectUserSessionByContactId(sessionInfo.contactId)
  const nextSession = {
    ...previous,
    ...sessionInfo,
    noReadCount: sessionInfo.noReadCount ?? previous?.noReadCount,
    topType: sessionInfo.topType ?? previous?.topType,
    status: sessionInfo.status ?? previous?.status ?? 1,
    userId: store.getUserId()
  }

  await insertOrReplaceStrict('chat_session_user', nextSession)
  return nextSession
}

const saveOrUpdateChatSessionBatch4Init = async (chatSessionList) => {
  // WebSocket 初始化、普通消息和发送成功统一使用 INSERT OR REPLACE 批量 upsert。
  if (!Array.isArray(chatSessionList) || chatSessionList.length === 0) {
    return
  }
  const userId = store.getUserId()
  return runInTransaction(async () => {
    for (let i = 0; i < chatSessionList.length; i++) {
      const sessionInfo = { ...chatSessionList[i], userId, status: 1 }
      await upsertSessionPreservingState(sessionInfo)
    }
  })
}

//更新未读数
const updateNoReadCount = ({ contactId, noReadCount }) => {
  // noReadCount=0 表示已读清零，其他数值表示在原未读数上累加。
  if (!contactId) {
    return Promise.resolve(0)
  }
  if (noReadCount === 0) {
    let sql = 'update chat_session_user set no_read_count=0 where user_id=? and contact_id=?'
    return runStrict(sql, [store.getUserId(), contactId])
  }
  let sql =
    'update chat_session_user set no_read_count=coalesce(no_read_count,0)+? where user_id=? and contact_id=?'
  return runStrict(sql, [noReadCount, store.getUserId(), contactId])
}

const markSessionRead = (contactId) => {
  return updateNoReadCount({ contactId, noReadCount: 0 })
}

//查询用户会话列表
const selectUserSessionList = () => {
  // renderer 只展示 status=1 的会话；删除会话会把 status 置为 0。
  let sql = 'select * from chat_session_user where user_id=? and status=1'
  return queryAll(sql, [store.getUserId()])
}

const selectUserSessionBySessionId = (sessionId) => {
  let sql = 'select * from chat_session_user where user_id=? and session_id=?'
  return queryOne(sql, [store.getUserId(), sessionId])
}

const clearChatSessionSummaryBySessionId = async (sessionId) => {
  if (!sessionId) {
    return null
  }
  const sessionData = await selectUserSessionBySessionId(sessionId)
  if (!sessionData) {
    return null
  }
  const sessionInfo = {
    lastMessage: '',
    noReadCount: 0
  }
  const sql =
    'update chat_session_user set last_message=?, no_read_count=? where user_id=? and session_id=?'
  await runStrict(sql, [
    sessionInfo.lastMessage,
    sessionInfo.noReadCount,
    store.getUserId(),
    sessionId
  ])
  return Object.assign({}, sessionData, sessionInfo)
}

const delChatSession = (contactId) => {
  // 这里不物理删除会话，也不删除消息，方便后续重新打开聊天时继续使用历史记录。
  const paramData = {
    userId: store.getUserId(),
    contactId
  }
  const sessionInfo = {
    status: 0
  }
  const sql = 'update chat_session_user set status=? where user_id=? and contact_id=?'
  return runStrict(sql, [sessionInfo.status, paramData.userId, paramData.contactId])
}

const topChatSession = (contactId, topType) => {
  const paramData = {
    userId: store.getUserId(),
    contactId
  }
  const sessionInfo = {
    topType
  }
  const sql = 'update chat_session_user set top_type=? where user_id=? and contact_id=?'
  return runStrict(sql, [sessionInfo.topType, paramData.userId, paramData.contactId])
}

export {
  saveOrUpdateChatSessionBatch4Init,
  updateNoReadCount,
  markSessionRead,
  selectUserSessionList,
  selectUserSessionBySessionId,
  clearChatSessionSummaryBySessionId,
  delChatSession,
  topChatSession
}
