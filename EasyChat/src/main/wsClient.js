import { WebSocket } from 'ws'
import store from './store.js'
import { applyV2Events, saveMessageBatch } from './db/ChatMessageModel'
import { runtimeConfig } from '../shared/runtimeConfig.js'
import { isV2EventEnvelope } from '../shared/v2EventTypes.js'
import {
  HEARTBEAT_INTERVAL,
  HEARTBEAT_PONG_TIMEOUT,
  RECEIVE_FLUSH_DELAY,
  RECEIVE_FLUSH_MAX,
  WS_MESSAGE_PROCESS_TIMEOUT,
  WS_RESET_FLUSH_TIMEOUT,
  WS_RECONNECT_DELAY,
  WS_MAX_RECONNECT_TIMES
} from './constants'
import {
  appendReceiveRecoveryMessages,
  compactReceiveRecoveryMessages,
  readReceiveRecoveryMessages
} from './receiveRecoveryStore.js'
import logger from './logger.js'

let ws = null
let maxReConnectTimes = 0
let wsUrl = null
let wsAuthToken = ''
let webContentsSender = null
let needReconnect = null
let lockReconnect = false
let heartbeatTimer = null
let legacyRejectionReported = false
let pongTimeoutTimer = null
let pongHandler = null
let reconnectTimer = null
let receiveQueue = []
let receiveFlushTimer = null
let receiveFlushing = false
let wsRuntimeGeneration = 0
let messageProcessingQueue = Promise.resolve()
let awaitingPong = false
let resetRuntimePromise = null
let recoveryReplayPromise = null
const RECEIVE_SAVE_MAX_RETRY = 3
const RECEIVE_QUEUE_MAX = RECEIVE_FLUSH_MAX * 20
const wsDiagnostics = {
  status: 'closed',
  retryLeft: 0,
  reconnectCount: 0,
  queueSize: 0,
  lastPingAt: 0,
  lastPongAt: 0,
  parseErrorCount: 0,
  invalidMessageCount: 0,
  dbErrorCount: 0,
  lastError: ''
}

const updateWsDiagnostics = (patch = {}) => {
  Object.assign(wsDiagnostics, patch, {
    queueSize: receiveQueue.length,
    retryLeft: maxReConnectTimes
  })
}

const getWsDiagnostics = () => {
  return { ...wsDiagnostics, queueSize: receiveQueue.length, retryLeft: maxReConnectTimes }
}

const recordWsError = (error, patch = {}) => {
  updateWsDiagnostics({
    ...patch,
    lastError: error?.message || String(error || '')
  })
}

const resetWsDiagnostics = () => {
  Object.assign(wsDiagnostics, {
    status: 'closed',
    retryLeft: 0,
    reconnectCount: 0,
    queueSize: 0,
    lastPingAt: 0,
    lastPongAt: 0,
    parseErrorCount: 0,
    invalidMessageCount: 0,
    dbErrorCount: 0,
    lastError: ''
  })
}

const clearPongTimeoutTimer = () => {
  if (pongTimeoutTimer) {
    clearTimeout(pongTimeoutTimer)
    pongTimeoutTimer = null
  }
  awaitingPong = false
}

const clearHeartbeatTimer = () => {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  clearPongTimeoutTimer()
}

const clearReconnectTimer = () => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

const clearReceiveFlushTimer = () => {
  if (receiveFlushTimer) {
    clearTimeout(receiveFlushTimer)
    receiveFlushTimer = null
  }
}

const closeCurrentSocket = () => {
  if (!ws) {
    return
  }
  clearPongTimeoutTimer()
  if (pongHandler && typeof ws.removeListener === 'function') {
    ws.removeListener('pong', pongHandler)
  }
  pongHandler = null
  ws.onopen = null
  ws.onmessage = null
  ws.onclose = null
  ws.onerror = null
  try {
    ws.close()
  } catch (error) {
    console.error('failed to close WebSocket', error)
  }
  ws = null
}

const blockWsForRecoveryFailure = (kind, error, failedCount) => {
  const safeError = new Error(
    'Local recovery storage is unavailable. Repair the local database and restart EasyChat.'
  )
  recordWsError(error || safeError, { status: 'recovery_blocked' })
  needReconnect = false
  lockReconnect = true
  clearReconnectTimer()
  clearHeartbeatTimer()
  closeCurrentSocket()
  publishWsStatus({ status: 'recovery_blocked', retryLeft: 0, error: safeError.message })
  publishReceiveRecoveryNeeded({
    error: safeError,
    messages: [],
    stats: { kind, failedCount, resyncRequired: true }
  })
}

const persistRecoveryMessages = async (messages, kind, error) => {
  if (!messages.length) {
    return { persisted: true, blocked: false }
  }
  let result
  try {
    result = await appendReceiveRecoveryMessages(store.getUserId(), messages)
  } catch (persistError) {
    result = { success: false, kind: 'recovery_log_write_failed', error: persistError }
  }
  if (result?.success) {
    publishReceiveRecoveryNeeded({
      error,
      messages,
      stats: { kind, persistedCount: result.storedCount }
    })
    return { persisted: true, blocked: false }
  }

  const failure = result?.error || new Error(`Receive recovery log ${result?.kind || 'write failed'}`)
  blockWsForRecoveryFailure(result?.kind || 'recovery_log_write_failed', failure, messages.length)
  return { persisted: false, blocked: true }
}

const replayReceiveRecovery = async () => {
  if (recoveryReplayPromise) {
    return recoveryReplayPromise
  }
  recoveryReplayPromise = (async () => {
    const messages = await readReceiveRecoveryMessages(store.getUserId())
    if (!messages.length) {
      return { recoveredCount: 0 }
    }
    try {
      await saveAndPublishMessageBatch(messages)
      await compactReceiveRecoveryMessages(store.getUserId(), messages)
      return { recoveredCount: messages.length }
    } catch (error) {
      console.error('Failed to replay receive recovery messages', error)
      throw error
    }
  })().finally(() => {
    recoveryReplayPromise = null
  })
  return recoveryReplayPromise
}

const incrementRuntimeGeneration = () => {
  if (wsRuntimeGeneration >= Number.MAX_SAFE_INTEGER) {
    wsRuntimeGeneration = 0
  } else {
    wsRuntimeGeneration += 1
  }
}

const resetWsRuntime = async () => {
  if (resetRuntimePromise) {
    return resetRuntimePromise
  }
  resetRuntimePromise = (async () => {
    // reset 期间先尽量刷完当前接收队列，再递增运行代次丢弃旧 WebSocket 的异步回包。
    clearHeartbeatTimer()
    clearReconnectTimer()
    clearReceiveFlushTimer()
    const pendingProcessing = messageProcessingQueue
    try {
      await runWithTimeout(
        async () => {
          await pendingProcessing
          await flushReceiveQueue()
        },
        WS_RESET_FLUSH_TIMEOUT,
        'WebSocket reset flush timed out'
      )
    } catch (error) {
      const pending = receiveQueue.slice()
      const recovery = await persistRecoveryMessages(pending, 'reset_flush_failed', error)
      if (recovery.persisted) {
        receiveQueue.splice(0, pending.length)
      }
    }
    receiveFlushing = false
    if (wsDiagnostics.status !== 'recovery_blocked') {
      lockReconnect = false
    }
    messageProcessingQueue = Promise.resolve()
    incrementRuntimeGeneration()
    closeCurrentSocket()
  })().finally(() => {
    resetRuntimePromise = null
  })
  return resetRuntimePromise
}

const getMessageContactId = (message = {}) => {
  if (message.contactType == 1) {
    return message.contactId
  }
  return message.sendUserId == store.getUserId() ? message.contactId : message.sendUserId
}

const toSessionInfo = (message = {}) => {
  const contactId = getMessageContactId(message)
  const isGroupMessage = Number(message.contactType) === 1
  const contactName = isGroupMessage
    ? message.contactName || message.groupName
    : message.contactName || message.groupName || message.sendUserNickName
  return {
    contactId,
    contactType: message.contactType,
    sessionId: message.sessionId,
    status: 1,
    // Group messages do not always include the group name. Do not pass an
    // undefined value to the session upsert, or it would erase a known name.
    ...(contactName ? { contactName } : {}),
    lastMessage: message.messageContent,
    lastReceiveTime: message.sendTime || Date.now(),
    memberCount: message.memberCount,
    noReadCountDelta: message.sendUserId == store.getUserId() ? 0 : 1
  }
}

const getLatestSessionList = (messages = []) => {
  const sessionMap = new Map()
  messages.forEach((message) => {
    const sessionInfo = toSessionInfo(message)
    if (!sessionInfo.contactId) {
      return
    }
    const previous = sessionMap.get(sessionInfo.contactId)
    if (
      !previous ||
      Number(sessionInfo.lastReceiveTime || 0) >= Number(previous.lastReceiveTime || 0)
    ) {
      sessionInfo.noReadCountDelta += Number(previous?.noReadCountDelta || 0)
      sessionMap.set(sessionInfo.contactId, sessionInfo)
    } else {
      previous.noReadCountDelta += sessionInfo.noReadCountDelta
    }
  })

  return Array.from(sessionMap.values())
}

const sendToRenderer = (channel, payload) => {
  if (!webContentsSender || webContentsSender.isDestroyed?.()) {
    return false
  }
  try {
    webContentsSender.send(channel, payload)
    return true
  } catch (error) {
    console.error(`failed to send IPC message: ${channel}`, error)
    return false
  }
}

const publishWsStatus = (payload) => {
  updateWsDiagnostics({
    status: payload?.status || wsDiagnostics.status,
    retryLeft: payload?.retryLeft ?? maxReConnectTimes,
    lastError: payload?.error || wsDiagnostics.lastError
  })
  sendToRenderer('wsStatusChange', {
    ...payload,
    diagnostics: getWsDiagnostics()
  })
}

const getResyncSessions = (messages = []) => {
  return getLatestSessionList(messages).map((sessionInfo) => {
    const cleanSession = { ...sessionInfo }
    delete cleanSession.noReadCountDelta
    return cleanSession
  })
}

const publishReceiveRecoveryNeeded = ({ error, messages = [], stats = {} } = {}) => {
  if (stats.kind === 'queue_overflow') {
    recordWsError(error, { queueSize: receiveQueue.length })
  }
  sendToRenderer('receiveMessageBatch', {
    success: false,
    messageType: 'batch',
    messages: [],
    sessions: getResyncSessions(messages),
    kind: stats.kind || 'receive_resync_required',
    error: error?.message || String(error || '消息同步异常，正在尝试恢复。'),
    resyncRequired: true,
    stats: {
      ...stats,
      diagnostics: getWsDiagnostics()
    }
  })
}

const runWithTimeout = (task, timeoutMs, errorMessage) => {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      reject(new Error(errorMessage))
    }, timeoutMs)

    Promise.resolve()
      .then(task)
      .then(
        (result) => {
          if (settled) {
            return
          }
          settled = true
          clearTimeout(timer)
          resolve(result)
        },
        (error) => {
          if (settled) {
            return
          }
          settled = true
          clearTimeout(timer)
          reject(error)
        }
      )
  })
}

const saveAndPublishMessageBatch = async (messages) => {
  if (!messages.length) {
    return
  }

  // 普通消息必须先批量落库，再发布给 renderer，保证 UI 展示的数据已经可恢复。
  const genAtStart = wsRuntimeGeneration
  const { savedMessages = [] } = await saveMessageBatch(messages, {
    sessionRows: (newMessages) => {
      return getLatestSessionList(newMessages).map((sessionInfo) => {
        const clean = { ...sessionInfo }
        delete clean.noReadCountDelta
        return clean
      })
    }
  })
  // 如果 saveMessageBatch 期间触发了 resetWsRuntime（登出/重连等），
  // 放弃向可能已销毁的渲染窗口推送过期会话数据。
  if (wsRuntimeGeneration !== genAtStart) {
    return
  }
  if (!savedMessages.length) {
    return
  }

  const sessionPatches = getLatestSessionList(savedMessages)
  sendToRenderer('receiveMessageBatch', {
    messageType: 'batch',
    messages: savedMessages,
    sessions: sessionPatches,
    stats: {
      receivedCount: messages.length,
      savedCount: savedMessages.length,
      filteredCount: messages.length - savedMessages.length
    }
  })
}

const isV2Event = isV2EventEnvelope

const normalizeV2EventForCurrentUser = (event) => {
  const payload = { ...(event.payload || {}) }
  // The durable event retains the sender's original target. The receiver's
  // local view uses the peer as contactId, without mutating the event itself.
  if (Number(payload.contactType) === 0 && payload.sendUserId !== store.getUserId()) {
    payload.contactId = payload.sendUserId
  }
  return { ...event, payload }
}

const saveAndPublishV2EventBatch = async (events) => {
  const normalizedEvents = events.map(normalizeV2EventForCurrentUser)
  const { savedMessages = [], stateChanged = false, mediaUpdates = [], eventTypes = [] } = await applyV2Events(normalizedEvents)
  if (!savedMessages.length && !stateChanged && !mediaUpdates.length) return
  sendToRenderer('receiveMessageBatch', {
    messageType: 'batch',
    messages: savedMessages,
    sessions: getLatestSessionList(savedMessages),
    stateChanged,
    mediaUpdates,
    eventTypes,
    stats: { receivedCount: events.length, savedCount: savedMessages.length, filteredCount: 0 }
  })
}

const scheduleReceiveFlush = () => {
  if (receiveQueue.length >= RECEIVE_FLUSH_MAX) {
    flushReceiveQueue()
    return
  }
  if (!receiveFlushTimer) {
    receiveFlushTimer = setTimeout(flushReceiveQueue, RECEIVE_FLUSH_DELAY)
  }
}

const flushReceiveQueue = async () => {
  clearReceiveFlushTimer()
  if (receiveFlushing) {
    return
  }
  receiveFlushing = true

  try {
    while (receiveQueue.length > 0) {
      // 按固定批量写库，既降低 SQLite 写放大，也让失败批次能独立进入恢复流程。
      const messages = receiveQueue.slice(0, RECEIVE_FLUSH_MAX)
      try {
        await saveAndPublishMessageBatch(messages)
        receiveQueue.splice(0, messages.length)
      } catch (error) {
        console.error('failed to save received WebSocket messages', error)
        updateWsDiagnostics({ dbErrorCount: wsDiagnostics.dbErrorCount + 1 })
        messages.forEach((message) => {
          message.__receiveRetry = Number(message.__receiveRetry || 0) + 1
        })
        const failedMessages = messages.filter((message) => {
          return Number(message.__receiveRetry || 0) >= RECEIVE_SAVE_MAX_RETRY
        })
        if (failedMessages.length > 0) {
          const failedSet = new Set(failedMessages)
          const recovery = await persistRecoveryMessages(failedMessages, 'db_write_failed', error)
          if (recovery.persisted) {
            receiveQueue = receiveQueue.filter((message) => {
              return !failedSet.has(message)
            })
          } else if (!recovery.blocked) {
            reconnect().catch((err) => console.error('reconnect failed', err))
          }
        }
        break
      }
    }
  } finally {
    receiveFlushing = false
    if (receiveQueue.length > 0) {
      scheduleReceiveFlush()
    } else {
      replayReceiveRecovery().catch((error) => {
        console.error('Idle receive recovery replay failed', error)
      })
    }
  }
}

const isCurrentRuntimeGeneration = (expectedGeneration) => {
  return expectedGeneration === wsRuntimeGeneration
}

const enqueueReceiveMessages = async (messages, expectedGeneration) => {
  if (!messages.length || !isCurrentRuntimeGeneration(expectedGeneration)) {
    return true
  }
  const combinedQueue = receiveQueue.concat(messages)
  if (combinedQueue.length > RECEIVE_QUEUE_MAX) {
    const overflowCount = combinedQueue.length - RECEIVE_QUEUE_MAX
    const droppedMessages = combinedQueue.slice(0, overflowCount)
    const error = new Error('接收消息过多，已保存溢出消息并将在队列空闲后恢复。')
    const recovery = await persistRecoveryMessages(droppedMessages, 'queue_overflow', error)
    if (!recovery.persisted) {
      recordWsError(error)
      if (!recovery.blocked) {
        reconnect().catch((err) => console.error('reconnect failed', err))
      }
      return false
    }
    if (!isCurrentRuntimeGeneration(expectedGeneration)) {
      return false
    }
    receiveQueue = combinedQueue.slice(overflowCount)
  } else {
    receiveQueue = combinedQueue
  }
  updateWsDiagnostics({ queueSize: receiveQueue.length })
  scheduleReceiveFlush()
  return true
}

const startHeartbeat = () => {
  clearHeartbeatTimer()
  pongHandler = () => {
    updateWsDiagnostics({ lastPongAt: Date.now(), lastError: '' })
    clearPongTimeoutTimer()
  }

  if (typeof ws?.on === 'function') {
    ws.on('pong', pongHandler)
  }

  const sendHeartbeatPing = () => {
    if (awaitingPong) {
      return
    }
    if (ws?.readyState === WebSocket.OPEN) {
      try {
        ws.ping()
        updateWsDiagnostics({ lastPingAt: Date.now() })
        awaitingPong = true
        if (pongTimeoutTimer) {
          clearTimeout(pongTimeoutTimer)
        }
        pongTimeoutTimer = setTimeout(() => {
          if (!awaitingPong) {
            return
          }
          console.warn('WebSocket pong timeout, reconnecting')
          recordWsError(new Error('WebSocket heartbeat timed out'))
          publishWsStatus({
            status: 'stale',
            retryLeft: maxReConnectTimes,
            error: 'WebSocket heartbeat timed out'
          })
          clearHeartbeatTimer()
          closeCurrentSocket()
          reconnect().catch((err) => console.error('reconnect failed', err))
        }, HEARTBEAT_PONG_TIMEOUT)
      } catch (error) {
        console.error('failed to send heartbeat ping', error)
        recordWsError(error)
        clearHeartbeatTimer()
        reconnect().catch((err) => console.error('reconnect failed', err))
      }
    }
  }

  sendHeartbeatPing()
  heartbeatTimer = setInterval(sendHeartbeatPing, HEARTBEAT_INTERVAL)
}

const enqueueMessageProcessing = (message) => {
  const expectedGeneration = wsRuntimeGeneration
  messageProcessingQueue = messageProcessingQueue
    .catch((error) => {
      console.error('previous WebSocket message task failed, continuing', error)
    })
    .then(() => {
      return runWithTimeout(
        () => handleWsMessage(message, expectedGeneration),
        WS_MESSAGE_PROCESS_TIMEOUT,
        'WebSocket message processing timed out'
      )
    })
    .catch((error) => {
      console.error('failed to handle WebSocket message', error)
      publishReceiveRecoveryNeeded({
        error,
        messages: normalizeWsMessages(message).filter(isV2Event),
        stats: {
          kind: 'message_processing_timeout'
        }
      })
    })

  return messageProcessingQueue
}

const buildWsUrl = (domain) => {
  // 令牌不能进入 URL，避免被代理、监控或错误日志记录。
  return new URL(domain).toString()
}

const initWs = async (config, sender) => {
  resetWsDiagnostics()
  legacyRejectionReported = false
  webContentsSender = sender
  await resetWsRuntime()
  wsUrl = buildWsUrl(runtimeConfig.wsOrigin)
  wsAuthToken = String(config.token || '')
  needReconnect = true
  maxReConnectTimes = WS_MAX_RECONNECT_TIMES
  try {
    await replayReceiveRecovery()
  } catch (error) {
    console.error('Startup receive recovery replay failed', error)
    if (error?.kind === 'corrupt') {
      blockWsForRecoveryFailure('corrupt', error, 0)
      return
    }
  }
  publishWsStatus({ status: 'connecting', retryLeft: maxReConnectTimes })
  createWs()
}

const closeWs = async () => {
  needReconnect = false
  maxReConnectTimes = 0
  await resetWsRuntime()
  publishWsStatus({ status: 'closed', retryLeft: 0 })
  webContentsSender = null
  wsAuthToken = ''
}

const normalizeWsMessages = (payload, depth = 0) => {
  // 限制递归深度，防止异常或恶意嵌套的 WebSocket payload 导致栈溢出。
  if (depth > 10) {
    console.warn('normalizeWsMessages: max recursion depth reached, dropping nested payload')
    return []
  }
  if (payload == null) {
    return []
  }
  if (Array.isArray(payload)) {
    return payload.flatMap((item) => normalizeWsMessages(item, depth + 1))
  }
  if (Array.isArray(payload.messages)) {
    return payload.messages.flatMap((item) => normalizeWsMessages(item, depth + 1))
  }
  if (Array.isArray(payload.dataList)) {
    return payload.dataList.flatMap((item) => normalizeWsMessages(item, depth + 1))
  }
  if (Array.isArray(payload.chatMessageList)) {
    return payload.chatMessageList.flatMap((item) => normalizeWsMessages(item, depth + 1))
  }
  return [payload]
}

const handleWsMessage = async (payload, expectedGeneration) => {
  const messages = normalizeWsMessages(payload)
  let pendingRegularMessages = []
  const flushPendingRegularMessages = async () => {
    if (!pendingRegularMessages.length || !isCurrentRuntimeGeneration(expectedGeneration)) {
      return
    }
    await enqueueReceiveMessages(pendingRegularMessages, expectedGeneration)
    pendingRegularMessages = []
  }
  for (const message of messages) {
    if (!isCurrentRuntimeGeneration(expectedGeneration)) {
      return
    }
    if (isV2Event(message)) {
      await flushPendingRegularMessages()
      await saveAndPublishV2EventBatch([message])
      continue
    }
    // V1 INIT/ACK and bare messages are deliberately not persisted. Treating
    // them as received would acknowledge data that cannot participate in the
    // event cursor protocol. The renderer's recovery path will request V2.
    await flushPendingRegularMessages()
    updateWsDiagnostics({
      invalidMessageCount: wsDiagnostics.invalidMessageCount + 1,
      lastError: 'Legacy or malformed WebSocket event rejected'
    })
    if (!legacyRejectionReported) {
      legacyRejectionReported = true
      publishReceiveRecoveryNeeded({
        error: 'Legacy WebSocket event rejected; V2 reconciliation required',
        stats: { rejectedLegacyEvent: true }
      })
    }
  }
  await flushPendingRegularMessages()
}

const createWs = () => {
  if (wsUrl == null) {
    return
  }

  clearHeartbeatTimer()
  closeCurrentSocket()
  try {
    ws = new WebSocket(wsUrl, {
      headers: {
        Authorization: `Bearer ${wsAuthToken}`
      }
    })
  } catch (error) {
    console.error('failed to create WebSocket', error)
    recordWsError(error)
    lockReconnect = false
    reconnect().catch((err) => console.error('reconnect failed', err))
    return
  }

  ws.onopen = function () {
    logger.info('WebSocket connected')
    lockReconnect = false
    maxReConnectTimes = WS_MAX_RECONNECT_TIMES
    updateWsDiagnostics({ lastError: '' })
    publishWsStatus({ status: 'connected', retryLeft: maxReConnectTimes })
    startHeartbeat()
  }

  ws.onmessage = function (e) {
    let message = null
    try {
      message = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
    } catch (error) {
      console.error('failed to parse WebSocket message', error)
      updateWsDiagnostics({
        parseErrorCount: wsDiagnostics.parseErrorCount + 1,
        lastError: error?.message || String(error)
      })
      return
    }

    // 串行化消息处理，防止多个 handleWsMessage 并发竞争接收队列和运行代次。
    enqueueMessageProcessing(message)
  }

  ws.onclose = function () {
    logger.info('WebSocket closed, reconnecting')
    clearHeartbeatTimer()
    reconnect().catch((err) => console.error('reconnect failed', err))
  }

  ws.onerror = function (error) {
    // onclose always follows onerror in the WebSocket spec, so let onclose
    // handle the actual reconnection to avoid double-reconnect races.
    logger.warn('WebSocket error', error?.message || String(error))
    recordWsError(error)
    publishWsStatus({
      status: 'reconnecting',
      retryLeft: maxReConnectTimes,
      error: error?.message || String(error)
    })
  }
}

const reconnect = async () => {
  if (!needReconnect) {
    logger.info('WebSocket closed intentionally')
    return
  }
  if (lockReconnect) {
    return
  }
  lockReconnect = true

  closeCurrentSocket()
  await resetWsRuntime()
  if (!needReconnect) {
    return
  }
  lockReconnect = true

  if (maxReConnectTimes > 0) {
    logger.info('prepare reconnect, remaining times:', maxReConnectTimes, Date.now())
    updateWsDiagnostics({ reconnectCount: wsDiagnostics.reconnectCount + 1 })
    publishWsStatus({ status: 'reconnecting', retryLeft: maxReConnectTimes })
    maxReConnectTimes--
    clearReconnectTimer()
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      lockReconnect = false
      createWs()
    }, WS_RECONNECT_DELAY)
  } else {
    lockReconnect = false
    logger.warn('WebSocket reconnect timeout')
    publishWsStatus({ status: 'failed', retryLeft: 0 })
  }
}

export { buildWsUrl, initWs, closeWs, normalizeWsMessages, getWsDiagnostics }
