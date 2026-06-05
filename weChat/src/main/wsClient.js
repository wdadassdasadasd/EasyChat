import { WebSocket } from 'ws'
import { saveOrUpdateChatSessionBatch4Init } from './db/ChatSessionUserModel'
import store from './store.js'
import { saveMessageBatch, updateMessageStatus } from './db/ChatMessageModel'
import { updateNoReadCount } from './db/UserSettingModel'
import {
  WS_SYSTEM_CONTACT_FILTER,
  HEARTBEAT_INTERVAL,
  RECEIVE_FLUSH_DELAY,
  RECEIVE_FLUSH_MAX,
  WS_RECONNECT_DELAY,
  WS_MAX_RECONNECT_TIMES
} from './constants'

const NODE_ENV = process.env.NODE_ENV

let ws = null
let maxReConnectTimes = null
let wsUrl = null
let webContentsSender = null
let needReconnect = null
let lockReconnect = false
let heartbeatTimer = null
let reconnectTimer = null
let receiveQueue = []
let receiveFlushTimer = null
let receiveFlushing = false
let wsRuntimeGeneration = 0
const RECEIVE_SAVE_MAX_RETRY = 3
const RECEIVE_QUEUE_MAX = RECEIVE_FLUSH_MAX * 20

const clearHeartbeatTimer = () => {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
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

const resetWsRuntime = () => {
  clearHeartbeatTimer()
  clearReconnectTimer()
  clearReceiveFlushTimer()
  receiveQueue = []
  receiveFlushing = false
  lockReconnect = false
  wsRuntimeGeneration += 1
  closeCurrentSocket()
}

const getMessageContactId = (message = {}) => {
  if (message.contactType == 1) {
    return message.contactId
  }
  return message.sendUserId == store.getUserId() ? message.contactId : message.sendUserId
}

const toSessionInfo = (message = {}) => {
  const contactId = getMessageContactId(message)
  return {
    contactId,
    contactType: message.contactType,
    sessionId: message.sessionId,
    status: 1,
    contactName: message.contactName || message.groupName || message.sendUserNickName,
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
  sendToRenderer('wsStatusChange', payload)
}

const saveAndPublishMessageBatch = async (messages) => {
  if (!messages.length) {
    return
  }

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
      const messages = receiveQueue.slice(0, RECEIVE_FLUSH_MAX)
      try {
        await saveAndPublishMessageBatch(messages)
        receiveQueue.splice(0, messages.length)
      } catch (error) {
        console.error('failed to save received WebSocket messages', error)
        messages.forEach((message) => {
          message.__receiveRetry = Number(message.__receiveRetry || 0) + 1
        })
        const failedMessages = messages.filter((message) => {
          return Number(message.__receiveRetry || 0) >= RECEIVE_SAVE_MAX_RETRY
        })
        if (failedMessages.length > 0) {
          const failedSet = new Set(failedMessages)
          receiveQueue = receiveQueue.filter((message) => {
            return !failedSet.has(message)
          })
          sendToRenderer('receiveMessageBatch', {
            success: false,
            messageType: 'batch',
            messages: [],
            sessions: [],
            error: error?.message || String(error),
            stats: {
              failedCount: failedMessages.length
            }
          })
        }
        break
      }
    }
  } finally {
    receiveFlushing = false
    if (receiveQueue.length > 0) {
      scheduleReceiveFlush()
    }
  }
}

const enqueueReceiveMessage = (message) => {
  if (receiveQueue.length >= RECEIVE_QUEUE_MAX) {
    const overflowCount = receiveQueue.length - RECEIVE_QUEUE_MAX + 1
    receiveQueue.splice(0, overflowCount)
    sendToRenderer('receiveMessageBatch', {
      success: false,
      messageType: 'batch',
      messages: [],
      sessions: [],
      error: 'Receive queue overflow. Some messages were not saved locally.',
      stats: {
        droppedCount: overflowCount
      }
    })
  }
  receiveQueue.push(message)
  scheduleReceiveFlush()
}

const startHeartbeat = () => {
  clearHeartbeatTimer()
  if (ws?.readyState === WebSocket.OPEN) {
    try {
      ws.send('heart beat')
    } catch (error) {
      console.error('failed to send heartbeat', error)
    }
  }
  heartbeatTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      console.log('send heartbeat')
      try {
        ws.send('heart beat')
      } catch (error) {
        console.error('failed to send heartbeat', error)
        reconnect()
      }
    }
  }, HEARTBEAT_INTERVAL)
}

const initWs = (config, sender) => {
  const domainKey = NODE_ENV !== 'development' ? 'prodWsDomain' : 'devWsDomain'
  const wsDomain = store.getData(domainKey)
  if (!wsDomain) {
    console.log(`missing ${domainKey}, skip WebSocket connect`)
    return
  }
  resetWsRuntime()
  wsUrl = `${wsDomain}?token=${config.token}`
  webContentsSender = sender
  needReconnect = true
  maxReConnectTimes = WS_MAX_RECONNECT_TIMES
  publishWsStatus({ status: 'connecting', retryLeft: maxReConnectTimes })
  createWs()
}

const closeWs = () => {
  needReconnect = false
  resetWsRuntime()
  publishWsStatus({ status: 'closed' })
  webContentsSender = null
}

const normalizeWsMessages = (payload) => {
  if (payload == null) {
    return []
  }
  if (Array.isArray(payload)) {
    return payload.flatMap(normalizeWsMessages)
  }
  if (Array.isArray(payload.messages)) {
    return payload.messages.flatMap(normalizeWsMessages)
  }
  if (Array.isArray(payload.dataList)) {
    return payload.dataList.flatMap(normalizeWsMessages)
  }
  if (Array.isArray(payload.chatMessageList)) {
    return payload.chatMessageList.flatMap(normalizeWsMessages)
  }
  return [payload]
}

const isValidWsMessage = (message = {}) => {
  if (message == null || typeof message !== 'object' || Array.isArray(message)) {
    return false
  }
  const messageType = Number(message.messageType)
  if (!Number.isFinite(messageType)) {
    return false
  }
  if (messageType === 0) {
    return true
  }
  if (messageType === 6) {
    return message.messageId != null
  }
  return message.messageId != null && Boolean(message.sessionId)
}

const handleSingleWsMessage = async (message) => {
  const messageType = Number(message.messageType)

  switch (messageType) {
    case 0: {
      await flushReceiveQueue()
      const chatSessionList = (message.extendData?.chatSessionList || []).filter((item) => {
        return item.contactName !== WS_SYSTEM_CONTACT_FILTER
      })

      await saveOrUpdateChatSessionBatch4Init(chatSessionList)

      const chatMessageList = message.extendData?.chatMessageList || []
      await saveMessageBatch(chatMessageList)
      await updateNoReadCount(store.getUserId(), message.extendData?.contact?.applyCount || 0)

      sendToRenderer('receiveMessage', {
        messageType: message.messageType
      })
      break
    }

    case 6: {
      await flushReceiveQueue()
      await updateMessageStatus(message.messageId, message.status ?? 1)
      sendToRenderer('receiveMessage', message)
      break
    }

    default: {
      enqueueReceiveMessage(message)
      break
    }
  }
}

const handleWsMessage = async (payload) => {
  const messages = normalizeWsMessages(payload)
  for (const message of messages) {
    if (!isValidWsMessage(message)) {
      console.warn('drop invalid WebSocket message', message)
      continue
    }
    await handleSingleWsMessage(message)
  }
}

const createWs = () => {
  if (wsUrl == null) {
    return
  }

  clearHeartbeatTimer()
  closeCurrentSocket()
  try {
    ws = new WebSocket(wsUrl)
  } catch (error) {
    console.error('failed to create WebSocket', error)
    lockReconnect = false
    reconnect()
    return
  }

  ws.onopen = function () {
    console.log('WebSocket connected')
    lockReconnect = false
    maxReConnectTimes = WS_MAX_RECONNECT_TIMES
    publishWsStatus({ status: 'connected', retryLeft: maxReConnectTimes })
    startHeartbeat()
  }

  ws.onmessage = async function (e) {
    console.log('received WebSocket message', e.data)

    let message = null
    try {
      message = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
    } catch (error) {
      console.error('failed to parse WebSocket message', error)
      return
    }

    try {
      await handleWsMessage(message)
    } catch (error) {
      console.error('failed to handle WebSocket message', error)
    }
  }

  ws.onclose = function () {
    console.log('WebSocket closed, reconnecting')
    clearHeartbeatTimer()
    reconnect()
  }

  ws.onerror = function (error) {
    console.log('WebSocket error, reconnecting')
    publishWsStatus({
      status: 'reconnecting',
      retryLeft: maxReConnectTimes,
      error: error?.message || String(error)
    })
    clearHeartbeatTimer()
    reconnect()
  }
}

const reconnect = () => {
  if (!needReconnect) {
    console.log('WebSocket closed intentionally')
    return
  }
  if (lockReconnect) {
    return
  }
  lockReconnect = true

  closeCurrentSocket()

  if (maxReConnectTimes > 0) {
    console.log('prepare reconnect, remaining times: ' + maxReConnectTimes, new Date().getTime())
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
    console.log('WebSocket reconnect timeout')
    publishWsStatus({ status: 'failed', retryLeft: 0 })
  }
}

export { initWs, closeWs, normalizeWsMessages, isValidWsMessage }
