import { CHAT_CONSTANTS } from '@/utils/ChatConstants'
import { createOutboundMessagePersistence } from './outboundMessagePersistence'

/**
 * Owns the outgoing message state machine shared by text and media sends.
 * Transport and upload details intentionally remain outside this module.
 */
export const createOutboundMessageLifecycle = ({
  appendMessageIfMissing,
  currentChatSession,
  currentUserId,
  isNearMessageBottom,
  messageList,
  patchChatSessions,
  proxy,
  replaceMessageById,
  updateMessageById,
  scrollMessageToBottom
}) => {
  let localMessageSeq = -Date.now()
  let sendTaskChain = Promise.resolve()
  let pendingSendTaskCount = 0
  const localSyncRetryTimers = []

  // The server treats this stable UUID as the idempotency key. Create it before
  // persisting the pending row and never replace it on a retry.
  const createClientMessageId = () => {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
    const bytes = new Uint8Array(16)
    globalThis.crypto?.getRandomValues?.(bytes)
    if (bytes.some((value) => value !== 0)) {
      bytes[6] = (bytes[6] & 0x0f) | 0x40
      bytes[8] = (bytes[8] & 0x3f) | 0x80
      const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    }
    return `fallback-${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.abs(localMessageSeq)}`
  }

  const saveSendMessageToLocal = async (payload) => window.api.invokeSaveSendMessage(payload)
  const { persistMessageStatus, persistPendingMessage, persistServerMessage } =
    createOutboundMessagePersistence({
      currentChatSession,
      patchChatSessions,
      saveSendMessageToLocal
    })

  const enqueueSendTask = (task, { onRejected } = {}) => {
    if (pendingSendTaskCount >= CHAT_CONSTANTS.MAX_SEND_TASK_QUEUE) {
      onRejected?.()
      proxy.Message.warning('发送任务过多，请等待当前消息处理完成后再试。')
      return false
    }
    pendingSendTaskCount += 1
    sendTaskChain = sendTaskChain
      .catch((error) => console.error('send queue: previous task failed, continuing', error))
      .then(task)
      .catch((error) => console.error('send message failed', error))
      .finally(() => {
        pendingSendTaskCount = Math.max(0, pendingSendTaskCount - 1)
      })
    return sendTaskChain
  }

  const appendSentMessageIfMissing = (message) => {
    const shouldStickToBottom = isNearMessageBottom()
    const appended =
      appendMessageIfMissing?.(message) ??
      (() => {
        messageList.value.push(message)
        return true
      })()
    if (appended) scrollMessageToBottom({ force: shouldStickToBottom })
    return appended
  }

  const createPendingMessage = ({
    contactId,
    contactType,
    messageType,
    messageContent,
    file,
    fileType,
    filePath,
    uploadSourceId
  }) => ({
    messageId: --localMessageSeq,
    clientMessageId: createClientMessageId(),
    sessionId: currentChatSession.value.sessionId || `${contactType}_${contactId}`,
    contactId,
    contactType,
    messageType,
    messageContent,
    fileSize: file?.size,
    fileName: file?.name,
    filePath,
    uploadSourceId,
    fileType,
    sendUserId: currentUserId?.value,
    sendTime: Date.now(),
    status: 2
  })

  const markMessageFailed = async (message, errorText, { shouldReportError } = {}) => {
    const patch = { status: 0, uploading: false, uploadError: errorText || '' }
    Object.assign(message, patch)
    updateMessageById?.(message.messageId, patch)
    await persistMessageStatus(message).catch((error) =>
      console.error('save failed message status failed', error)
    )
    if (errorText && (!shouldReportError || shouldReportError())) proxy.Message.error(errorText)
  }

  const markMessageSending = async (message, patch = {}) => {
    const nextPatch = { status: 2, ...patch }
    Object.assign(message, nextPatch)
    updateMessageById?.(message.messageId, nextPatch)
    await persistMessageStatus(message)
  }

  const scheduleLocalSyncRetry = (
    localMessageId,
    recoveryMessage,
    attempt,
    maxRetries,
    onRecovered
  ) => {
    if (attempt > maxRetries) {
      console.error('local sync retry exhausted after', maxRetries, 'attempts')
      return
    }
    const timer = setTimeout(
      async () => {
        const index = localSyncRetryTimers.indexOf(timer)
        if (index >= 0) localSyncRetryTimers.splice(index, 1)
        try {
          await persistServerMessage(localMessageId, { ...recoveryMessage })
          const recoveredMessage = { ...recoveryMessage }
          const wasReplaced =
            replaceMessageById?.(localMessageId, recoveredMessage) ||
            replaceMessageById?.(recoveredMessage.messageId, recoveredMessage)
          if (!wasReplaced) appendSentMessageIfMissing(recoveredMessage)
          onRecovered?.(recoveredMessage)
        } catch (error) {
          console.error('local sync retry failed (attempt', attempt, ')', error)
          scheduleLocalSyncRetry(
            localMessageId,
            recoveryMessage,
            attempt + 1,
            maxRetries,
            onRecovered
          )
        }
      },
      Math.min(2000 * attempt, 10000)
    )
    localSyncRetryTimers.push(timer)
  }

  const markMessageLocalSyncFailed = (
    localMessage,
    serverMessage,
    error,
    { recoveredStatus = 1, onRecovered } = {}
  ) => {
    const nextMessage = {
      ...localMessage,
      ...serverMessage,
      status: 0,
      uploading: false,
      uploadError: '消息已发出，但本地记录保存失败，正在等待同步恢复。',
      localSyncFailed: true
    }
    if (!replaceMessageById?.(localMessage.messageId, nextMessage)) {
      updateMessageById?.(localMessage.messageId, nextMessage)
    }
    console.error('message sent but local replace failed', error)
    proxy.Message.error('消息已发出，但本地记录保存失败，请稍后重新打开会话同步。')
    scheduleLocalSyncRetry(
      localMessage.messageId,
      {
        ...localMessage,
        ...serverMessage,
        status: recoveredStatus,
        uploading: recoveredStatus === 2,
        uploadError: '',
        localSyncFailed: false
      },
      1,
      3,
      onRecovered
    )
    return nextMessage
  }

  const replaceLocalWithServerMessage = async (localMessage, serverMessage, patch = {}) => {
    const nextMessage = {
      ...localMessage,
      ...serverMessage,
      ...patch,
      status: patch.status ?? serverMessage.status ?? 1
    }
    const activeSessionId = currentChatSession.value?.sessionId
    const messageSessionId = localMessage.sessionId || serverMessage.sessionId
    await persistServerMessage(localMessage.messageId, nextMessage)
    if (activeSessionId && messageSessionId && activeSessionId !== messageSessionId)
      return nextMessage
    if (!replaceMessageById?.(localMessage.messageId, nextMessage))
      appendSentMessageIfMissing(nextMessage)
    return nextMessage
  }

  const cleanup = () => {
    localSyncRetryTimers.forEach((timer) => clearTimeout(timer))
    localSyncRetryTimers.length = 0
  }

  return {
    appendSentMessageIfMissing,
    cleanup,
    createClientMessageId,
    createPendingMessage,
    enqueueSendTask,
    markMessageFailed,
    markMessageLocalSyncFailed,
    markMessageSending,
    persistMessageStatus,
    persistPendingMessage,
    replaceLocalWithServerMessage
  }
}
