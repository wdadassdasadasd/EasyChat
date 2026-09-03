import { CHAT_CONSTANTS } from '@/utils/ChatConstants'
import {
  getSendFailureMessage,
  getUploadFailureMessage,
  isRequestFailure
} from '@/utils/RequestFailure'
import { validateFileSize } from '@/utils/FileLimits'
import { cancelMediaUpload, uploadMediaFile } from '@/utils/MediaUploadTransport'
import { toRaw } from 'vue'

/**
 * 出站消息发送链路的执行入口。
 *
 * 只组装文本发送、出站生命周期和媒体传输控制器；不直接持有媒体副作用。
 */

export const useChatMessageSender = (dependencies) => {
  const { proxy } = dependencies
  const lifecycle = createOutboundMessageLifecycle(dependencies)
  const media = createMediaMessageTransferController({
    ...dependencies,
    lifecycle
  })

  const sendChatMessage = async (
    { contactId, contactType, messageContent },
    retryMessage = null
  ) => {
    if (typeof messageContent !== 'string' || !messageContent.trim()) {
      proxy.Message.warning('不能发送空消息。')
      return
    }
    if (messageContent.length > CHAT_CONSTANTS.MAX_MESSAGE_LENGTH) {
      proxy.Message.warning(`消息内容不能超过 ${CHAT_CONSTANTS.MAX_MESSAGE_LENGTH} 个字符。`)
      return
    }
    const localMessage =
      retryMessage ||
      lifecycle.createPendingMessage({
        contactId,
        contactType,
        messageType: 2,
        messageContent
      })
    if (retryMessage) {
      if (!localMessage.clientMessageId) {
        localMessage.clientMessageId = lifecycle.createClientMessageId()
      }
      try {
        await lifecycle.markMessageSending(localMessage)
      } catch (error) {
        console.error('save retry text message status failed', error)
        await lifecycle.markMessageFailed(
          localMessage,
          'Message retry failed. Local status could not be saved.'
        )
        return
      }
    } else {
      lifecycle.appendSentMessageIfMissing(localMessage)
      try {
        await lifecycle.persistPendingMessage(localMessage)
      } catch (error) {
        console.error('save pending text message failed', error)
        await lifecycle.markMessageFailed(
          localMessage,
          'Message could not be saved locally. Retry later.'
        )
        return
      }
    }
    const result = await proxy.Request({
      url: proxy.Api.sendMessage,
      params: {
        contactId,
        contactType,
        messageType: 2,
        messageContent,
        clientMessageId: localMessage.clientMessageId
      },
      showLoading: false,
      returnError: true
    })
    if (!result || isRequestFailure(result)) {
      await lifecycle.markMessageFailed(localMessage, getSendFailureMessage(result))
      return
    }
    try {
      await lifecycle.replaceLocalWithServerMessage(localMessage, result.data)
    } catch (error) {
      lifecycle.markMessageLocalSyncFailed(localMessage, result.data, error)
    }
  }

  const onSendChatMessage = (payload) => lifecycle.enqueueSendTask(() => sendChatMessage(payload))
  const onSendImageMessage = (payload) =>
    lifecycle.enqueueSendTask(() => media.sendMediaMessage(payload, 0), {
      onRejected: () => media.releaseRejectedMediaSource(payload)
    })
  const onSendFileMessage = (payload) =>
    lifecycle.enqueueSendTask(() => media.sendMediaMessage(payload, 2), {
      onRejected: () => media.releaseRejectedMediaSource(payload)
    })
  const onSendVideoMessage = (payload) =>
    lifecycle.enqueueSendTask(() => media.sendMediaMessage(payload, 1), {
      onRejected: () => media.releaseRejectedMediaSource(payload)
    })
  const retryFailedMessage = (message = {}) => {
    if (message.status != 0) return
    if (message.messageType == 5) return media.retryMediaMessage(message)
    return lifecycle.enqueueSendTask(() =>
      sendChatMessage(
        {
          contactId: message.contactId,
          contactType: message.contactType,
          messageContent: message.messageContent
        },
        message
      )
    )
  }

  return {
    cancelUploadMessage: media.cancelUploadMessage,
    cleanupUploadControllers: () => {
      media.cleanup()
      lifecycle.cleanup()
    },
    handleFileUploadDone: media.handleFileUploadDone,
    onSendChatMessage,
    onSendFileMessage,
    onSendImageMessage,
    onSendVideoMessage,
    retryFailedMessage,
    toggleUploadPause: media.toggleUploadPause
  }
}

/** Renderer-to-IPC persistence boundary for every outbound message state change. */
export const createOutboundMessagePersistence = ({
  currentChatSession,
  patchChatSessions,
  saveSendMessageToLocal
}) => {
  const sessionSnapshots = new Map()
  const getCurrentSessionSnapshot = () => ({ ...toRaw(currentChatSession.value) })
  const getMessageKey = (messageId) => (messageId == null ? '' : String(messageId))
  const getSessionSnapshot = (...messageIds) => {
    for (const messageId of messageIds) {
      const snapshot = sessionSnapshots.get(getMessageKey(messageId))
      if (snapshot) return snapshot
    }
    return getCurrentSessionSnapshot()
  }
  const stripTransientMessageFields = (message = {}) => {
    const dbMessage = { ...message }
    ;[
      'localPreviewUrl',
      'localCoverUrl',
      'retryFile',
      'retryCover',
      'uploading',
      'uploadProgress',
      'uploadError',
      'uploadCanceled',
      'uploadAwaitingAck',
      'uploadWaitingNetwork',
      'downloadStatus',
      'downloadProgress',
      'downloadPath',
      'downloadError',
      'uploadAcked',
      'uploadAckReceived',
      'uploadAckRevision',
      'uploadAckStatus',
      'uploadSourceReleased',
      'coverSourceId',
      'forceGet'
    ].forEach((key) => delete dbMessage[key])
    return dbMessage
  }
  const sessionMatchesCurrent = (sessionInfo) =>
    !sessionInfo?.contactId ||
    String(sessionInfo.contactId) === String(currentChatSession.value?.contactId)
  const persist = async (payload, fallbackError) => {
    const result = await saveSendMessageToLocal(payload)
    if (!result || result.success === false)
      throw new Error(result?.error || fallbackError || 'Save message failed')
    if (result.session && sessionMatchesCurrent(result.session))
      patchChatSessions?.([result.session])
    return result
  }
  const persistPendingMessage = (message) => {
    const sessionSnapshot = getCurrentSessionSnapshot()
    const messageKey = getMessageKey(message?.messageId)
    if (messageKey) sessionSnapshots.set(messageKey, sessionSnapshot)
    return persist(
      {
        mode: 'pending',
        message: stripTransientMessageFields(message),
        chatSession: sessionSnapshot
      },
      'Save pending message failed'
    )
  }
  const persistMessageStatus = (message) =>
    persist(
      {
        mode: 'status',
        message: stripTransientMessageFields(message),
        status: message.status,
        chatSession: getSessionSnapshot(message?.messageId)
      },
      'Save message status failed'
    )
  const persistServerMessage = async (localMessageId, message) => {
    const sessionSnapshot = getSessionSnapshot(localMessageId, message?.messageId)
    const result = await persist(
      {
        mode: 'replace',
        localMessageId,
        message: stripTransientMessageFields(message),
        chatSession: sessionSnapshot
      },
      'Save server message failed'
    )
    const localKey = getMessageKey(localMessageId)
    const serverKey = getMessageKey(message?.messageId)
    if (serverKey) sessionSnapshots.set(serverKey, sessionSnapshot)
    if (localKey && localKey !== serverKey) sessionSnapshots.delete(localKey)
    return result
  }
  return {
    cleanup: () => sessionSnapshots.clear(),
    persistMessageStatus,
    persistPendingMessage,
    persistServerMessage
  }
}

/** The single outgoing-message state machine used by text and media sends. */
export const createOutboundMessageLifecycle = ({
  currentChatSession,
  currentUserId,
  isNearMessageBottom,
  messageStore,
  patchChatSessions,
  proxy,
  scrollMessageToBottom
}) => {
  let localMessageSeq = -Date.now()
  let sendTaskChain = Promise.resolve()
  let pendingSendTaskCount = 0
  const localSyncRetryTimers = []
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
  const {
    cleanup: cleanupPersistence,
    persistMessageStatus,
    persistPendingMessage,
    persistServerMessage
  } = createOutboundMessagePersistence({
    currentChatSession,
    patchChatSessions,
    saveSendMessageToLocal: (payload) => window.api.invokeSaveSendMessage(payload)
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
    const appended = messageStore.appendIfMissing(message)
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
    messageStore.updateById(message.messageId, patch)
    await persistMessageStatus(message).catch((error) =>
      console.error('save failed message status failed', error)
    )
    if (errorText && (!shouldReportError || shouldReportError())) proxy.Message.error(errorText)
  }
  const markMessageSending = async (message, patch = {}) => {
    const nextPatch = { status: 2, ...patch }
    Object.assign(message, nextPatch)
    messageStore.updateById(message.messageId, nextPatch)
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
            messageStore.replaceById(localMessageId, recoveredMessage) ||
            messageStore.replaceById(recoveredMessage.messageId, recoveredMessage)
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
    if (!messageStore.replaceById(localMessage.messageId, nextMessage))
      messageStore.updateById(localMessage.messageId, nextMessage)
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
    if (!messageStore.replaceById(localMessage.messageId, nextMessage))
      appendSentMessageIfMissing(nextMessage)
    return nextMessage
  }
  const cleanup = () => {
    localSyncRetryTimers.forEach((timer) => clearTimeout(timer))
    localSyncRetryTimers.length = 0
    cleanupPersistence()
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

/** Bounded upload execution and delayed-resource cleanup. */
export const createMediaUploadCoordinator = ({ maxConcurrency = 3, onTaskError } = {}) => {
  const queue = [],
    controllers = new Map(),
    retryTimers = new Set()
  let activeCount = 0,
    disposed = false
  const run = () => {
    if (disposed) return
    while (activeCount < maxConcurrency && queue.length) {
      const task = queue.shift()
      activeCount += 1
      Promise.resolve()
        .then(task)
        .catch((error) => onTaskError?.(error))
        .finally(() => {
          activeCount -= 1
          run()
        })
    }
  }
  const enqueue = (task) => {
    if (disposed) return false
    queue.push(task)
    run()
    return true
  }
  const setController = (messageId, controller) => {
    if (disposed) {
      controller?.abort?.()
      return false
    }
    controllers.set(String(messageId), controller)
    return true
  }
  const scheduleRetry = (callback, delay) => {
    if (disposed) return null
    const timer = setTimeout(() => {
      retryTimers.delete(timer)
      if (!disposed) callback()
    }, delay)
    retryTimers.add(timer)
    return timer
  }
  const cleanup = () => {
    disposed = true
    controllers.forEach((controller) => controller?.abort?.())
    controllers.clear()
    retryTimers.forEach((timer) => clearTimeout(timer))
    retryTimers.clear()
    queue.length = 0
  }
  return {
    cleanup,
    deleteController: (messageId) => controllers.delete(String(messageId)),
    enqueue,
    getController: (messageId) => controllers.get(String(messageId)),
    isCurrentController: (messageId, controller) =>
      controllers.get(String(messageId)) === controller,
    scheduleRetry,
    setController
  }
}

/** Internal bridge from upload-task progress/ACK IPC to a message state machine. */
export const createMediaUploadAckController = ({ coordinator, lifecycle, messageStore, proxy }) => {
  let unsubscribeUploadTaskProgress = null
  const findMessage = messageStore.findById
  const releaseUploadSourceAfterAck = async (targetMessage, ackRevision, attempt = 0) => {
    if (
      targetMessage.uploadAckRevision !== ackRevision ||
      Number(targetMessage.uploadAckStatus) !== 1 ||
      targetMessage.uploadSourceReleased ||
      !targetMessage.uploadSourceId
    )
      return
    const result = await Promise.resolve(
      window.api?.invokeReleaseUploadSource?.({ uploadSourceId: targetMessage.uploadSourceId })
    ).catch((error) => {
      console.error('release acknowledged upload source failed', error)
      return null
    })
    if (result?.success === true) {
      targetMessage.uploadSourceReleased = true
      return
    }
    if (attempt < 2)
      coordinator.scheduleRetry(
        () => releaseUploadSourceAfterAck(targetMessage, ackRevision, attempt + 1),
        1000 * (attempt + 1)
      )
  }
  const handleFileUploadDone = async (message) => {
    const targetMessage = findMessage(message.messageId)
    if (!targetMessage) return
    const ackStatus = Number(message.status ?? 1),
      ackSucceeded = ackStatus === 1
    const repeatedAck =
      targetMessage.uploadAckReceived && Number(targetMessage.uploadAckStatus) === ackStatus
    const ackError = message.error || message.msg || 'File processing failed. Please retry.'
    const ackRevision = Number(targetMessage.uploadAckRevision || 0) + 1
    Object.assign(targetMessage, {
      status: ackStatus,
      uploading: false,
      uploadError: ackSucceeded ? '' : ackError,
      uploadCanceled: false,
      uploadAwaitingAck: false,
      uploadWaitingNetwork: false,
      uploadAckReceived: true,
      uploadAckRevision: ackRevision,
      uploadAckStatus: ackStatus
    })
    const controller = coordinator.getController(targetMessage.messageId)
    coordinator.deleteController(targetMessage.messageId)
    controller?.abort()
    if (ackSucceeded) {
      targetMessage.uploadProgress = 100
      targetMessage.forceGet = Date.now()
    } else if (!repeatedAck) proxy.Message.error(ackError)
    await lifecycle.persistMessageStatus(targetMessage).catch((error) => {
      console.error('save acknowledged media status failed', error)
      proxy.Message.error('Media status was confirmed, but could not be saved locally.')
    })
    Promise.resolve(
      window.api?.invokeAcknowledgeUploadTask?.({
        messageId: Number(targetMessage.messageId),
        succeeded: ackSucceeded,
        error: ackSucceeded ? '' : ackError
      })
    ).catch((error) => console.error('acknowledge upload task failed', error))
    if (
      targetMessage.uploadAckRevision === ackRevision &&
      ackSucceeded &&
      !targetMessage.uploadSourceReleased &&
      targetMessage.uploadSourceId
    )
      await releaseUploadSourceAfterAck(targetMessage, ackRevision)
  }
  const cancelUploadMessage = (message = {}) => {
    if (
      !message.messageId ||
      (!message.uploading && !message.uploadPaused && !message.uploadWaitingNetwork)
    )
      return
    coordinator.getController(message.messageId)?.abort()
    Object.assign(message, { uploadCanceled: true, uploadPaused: false })
    messageStore.updateById(message.messageId, { uploadCanceled: true })
    const cancel = window.api?.invokeCancelUploadTask
      ? window.api.invokeCancelUploadTask({ messageId: Number(message.messageId) })
      : cancelMediaUpload({ messageId: message.messageId, proxy })
    Promise.resolve(cancel).catch((error) => console.error('cancel media upload failed', error))
    lifecycle
      .markMessageFailed(message, '文件上传已取消。')
      .catch((error) => console.error('save canceled media status failed', error))
  }
  const toggleUploadPause = (message = {}) => {
    if (!message.messageId || typeof window.api?.invokePauseUploadTask !== 'function') return
    const paused = Boolean(message.uploadPaused)
    const request = paused
      ? window.api.invokeResumeUploadTask({ messageId: Number(message.messageId) })
      : window.api.invokePauseUploadTask({ messageId: Number(message.messageId) })
    request
      .then((result) => {
        if (!result?.success) throw new Error(result?.error || '上传任务状态切换失败')
        const patch = { uploading: paused, uploadPaused: !paused, uploadError: '' }
        Object.assign(message, patch)
        messageStore.updateById(message.messageId, patch)
      })
      .catch((error) => {
        console.error('toggle upload pause failed', error)
        proxy.Message.error('无法切换上传状态，请稍后重试。')
      })
  }
  const handleUploadTaskProgress = (payload = {}) => {
    const message = findMessage(payload.messageId)
    if (!message || message.uploadAckReceived) return
    const progress = Math.min(99, Math.max(0, Number(payload.progress) || 0))
    if (payload.state === 'succeeded') {
      const patch = {
        status: 1,
        uploading: false,
        uploadProgress: 100,
        uploadError: '',
        uploadCanceled: false,
        uploadPaused: false,
        uploadAwaitingAck: false,
        uploadWaitingNetwork: false
      }
      Object.assign(message, patch)
      messageStore.updateById(message.messageId, patch)
      lifecycle
        .persistMessageStatus(message)
        .catch((error) => console.error('save completed upload task status failed', error))
      return
    }
    if (payload.state === 'failed' || payload.state === 'canceled') {
      message.uploadAwaitingAck = false
      message.uploadWaitingNetwork = false
      lifecycle
        .markMessageFailed(
          message,
          payload.state === 'failed'
            ? payload.error || '文件上传失败，请重试。'
            : '文件上传已取消。'
        )
        .catch((error) => console.error('save upload task status failed', error))
      return
    }
    const patch =
      payload.state === 'awaiting_ack'
        ? {
            status: 2,
            uploading: false,
            uploadProgress: 99,
            uploadError: '文件已上传，等待服务端确认。',
            uploadCanceled: false,
            uploadPaused: false,
            uploadAwaitingAck: true,
            uploadWaitingNetwork: false
          }
        : payload.state === 'waiting_network'
          ? {
              status: 2,
              uploading: false,
              uploadProgress: progress,
              uploadError: '文件服务不可达，等待网络恢复。',
              uploadCanceled: false,
              uploadPaused: false,
              uploadAwaitingAck: false,
              uploadWaitingNetwork: true
            }
          : {
              status: 2,
              uploading: payload.state !== 'paused',
              uploadProgress: progress,
              uploadError: payload.state === 'paused' ? '上传已暂停。' : '',
              uploadCanceled: false,
              uploadPaused: payload.state === 'paused',
              uploadAwaitingAck: false,
              uploadWaitingNetwork: false
            }
    Object.assign(message, patch)
    messageStore.updateById(message.messageId, patch)
  }
  const subscribe = () => {
    unsubscribeUploadTaskProgress?.()
    unsubscribeUploadTaskProgress =
      window.api?.onUploadTaskProgress?.(handleUploadTaskProgress) || null
  }
  const releaseRejectedMediaSource = (payload = {}) => {
    if (!payload.uploadSourceId) return
    Promise.resolve(
      window.api?.invokeReleaseUploadSource?.({ uploadSourceId: payload.uploadSourceId })
    ).catch((error) => console.error('release rejected upload source failed', error))
  }
  const cleanup = () => {
    unsubscribeUploadTaskProgress?.()
    unsubscribeUploadTaskProgress = null
  }
  return {
    cancelUploadMessage,
    cleanup,
    handleFileUploadDone,
    releaseRejectedMediaSource,
    subscribe,
    toggleUploadPause
  }
}

/** Renderer-managed fallback uploader; persisted main-process tasks remain preferred. */
export const createMediaUploadExecutor = ({
  coordinator,
  currentChatSession,
  lifecycle,
  messageStore,
  proxy
}) => {
  const getLatestMessage = messageStore.findById
  const uploadMessageFile = async (message, file, cover) => {
    const sizeResult = validateFileSize(file, message.fileType)
    if (!sizeResult.valid) return lifecycle.markMessageFailed(message, sizeResult.message)
    if (message.uploadSourceId && typeof window.api?.invokeEnqueueUploadTask === 'function') {
      let coverSourceId = message.coverSourceId,
        registeredCoverSourceId = ''
      if (cover && !coverSourceId && typeof window.api?.registerUploadCover !== 'function')
        return lifecycle.markMessageFailed(
          message,
          '当前客户端不支持持久化上传封面，请更新后重试。'
        )
      if (cover && !coverSourceId) {
        try {
          const result = await window.api.registerUploadCover(cover)
          if (!result?.success || !result.coverSourceId)
            return lifecycle.markMessageFailed(message, result?.error || '无法保存上传封面。')
          coverSourceId = result.coverSourceId
          registeredCoverSourceId = coverSourceId
          message.coverSourceId = coverSourceId
        } catch (error) {
          console.error('register upload cover failed', error)
          return lifecycle.markMessageFailed(message, '无法保存上传封面。')
        }
      }
      messageStore.updateById(message.messageId, {
        status: 2,
        uploading: true,
        uploadProgress: Number(message.uploadProgress || 0),
        uploadError: '',
        uploadCanceled: false
      })
      let taskResult
      try {
        taskResult = await window.api.invokeEnqueueUploadTask({
          messageId: Number(message.messageId),
          uploadSourceId: message.uploadSourceId,
          coverSourceId,
          fileName: message.fileName || file?.name || message.messageContent,
          fileSize: Number(message.fileSize || file?.size || 0),
          fileType: Number(message.fileType)
        })
      } catch (error) {
        taskResult = { success: false, error: error?.message || '无法创建文件上传任务。' }
      }
      if (!taskResult?.success) {
        const failedUploadSourceId = message.uploadSourceId
        if (registeredCoverSourceId) {
          window.api
            .invokeReleaseUploadCover?.({ coverSourceId: registeredCoverSourceId })
            .catch(() => {})
          delete message.coverSourceId
        }
        window.api
          .invokeReleaseUploadSource?.({ uploadSourceId: failedUploadSourceId })
          .catch(() => {})
        delete message.uploadSourceId
        await lifecycle.markMessageFailed(message, taskResult?.error || '无法创建文件上传任务。')
      }
      return
    }
    const activeSessionId = currentChatSession.value?.sessionId
    if (activeSessionId && message.sessionId && activeSessionId !== message.sessionId)
      return lifecycle.markMessageFailed(message, 'Session changed during upload. Please retry.')
    const controller = new AbortController(),
      uploadKey = String(message.messageId)
    coordinator.setController(uploadKey, controller)
    const isCurrentUpload = () => coordinator.isCurrentController(uploadKey, controller)
    const updateUploadProgress = (progress) => {
      if (!isCurrentUpload() || getLatestMessage(message.messageId)?.uploadAckReceived) return
      const patch = {
        status: 2,
        uploading: true,
        uploadProgress: Math.min(99, Math.max(0, Number(progress) || 0)),
        uploadError: '',
        uploadCanceled: false
      }
      Object.assign(message, patch)
      messageStore.updateById(message.messageId, patch)
    }
    updateUploadProgress(message.uploadProgress || 0)
    let uploadCover = cover
    if (!uploadCover && message.fileType === 1 && message.uploadSourceId) {
      const thumbnail = await Promise.resolve(
        window.api?.invokeGenerateUploadSourceThumbnail?.({
          uploadSourceId: message.uploadSourceId
        })
      ).catch(() => null)
      if (thumbnail?.success && thumbnail.arrayBuffer)
        uploadCover = new Blob([thumbnail.arrayBuffer], { type: 'image/jpeg' })
    }
    const result = await uploadMediaFile({
      cover: uploadCover,
      file,
      fileType: message.fileType,
      message,
      onProgress: updateUploadProgress,
      proxy,
      signal: controller.signal
    })
    if (!isCurrentUpload()) return
    coordinator.deleteController(uploadKey)
    const latestMessage = getLatestMessage(message.messageId)
    if (latestMessage?.uploadAckReceived) return
    if (!result || isRequestFailure(result)) {
      const canceled = result?.kind === 'canceled'
      Object.assign(message, { uploadCanceled: canceled })
      messageStore.updateById(message.messageId, { uploadCanceled: canceled })
      return lifecycle.markMessageFailed(message, getUploadFailureMessage(result, canceled), {
        shouldReportError: () => !getLatestMessage(message.messageId)?.uploadAckReceived
      })
    }
    const successfulMessage = latestMessage || message
    const patch = {
      uploading: false,
      status: 2,
      uploadProgress: 99,
      uploadError: '文件已上传，等待服务端确认。',
      uploadCanceled: false,
      uploadAwaitingAck: true
    }
    Object.assign(successfulMessage, patch)
    messageStore.updateById(message.messageId, patch)
    await lifecycle.persistMessageStatus(successfulMessage).catch((error) => {
      console.error('save uploaded media status failed', error)
      proxy.Message.error('File uploaded, but local message status could not be saved.')
    })
  }
  return { uploadMessageFile }
}

/** Media message creation plus upload execution; its lifecycle is owned by this module. */
export const createMediaMessageTransferController = ({
  currentChatSession,
  lifecycle,
  messageStore,
  proxy
}) => {
  const blobUrlsToRevoke = new Set()
  const coordinator = createMediaUploadCoordinator({
    maxConcurrency: 3,
    onTaskError: (error) => console.error('upload message file failed', error)
  })
  const executor = createMediaUploadExecutor({
    coordinator,
    currentChatSession,
    lifecycle,
    messageStore,
    proxy
  })
  const acknowledger = createMediaUploadAckController({
    coordinator,
    lifecycle,
    messageStore,
    proxy
  })
  acknowledger.subscribe()
  const queueUpload = (message, file, cover) =>
    coordinator.enqueue(() => executor.uploadMessageFile(message, file, cover))
  const releaseSource = async (uploadSourceId) => {
    if (!uploadSourceId) return
    await Promise.resolve(window.api?.invokeReleaseUploadSource?.({ uploadSourceId })).catch(
      (error) => console.error('release unused upload source failed', error)
    )
  }
  const createLocalPreview = (message, file, cover, fileType) => {
    if (
      !message.localPreviewUrl &&
      (fileType === 0 || fileType === 1) &&
      typeof Blob !== 'undefined' &&
      file instanceof Blob
    ) {
      message.localPreviewUrl = URL.createObjectURL(file)
      blobUrlsToRevoke.add(message.localPreviewUrl)
    }
    if (fileType === 1 && cover && !message.localCoverUrl) {
      message.localCoverUrl = URL.createObjectURL(cover)
      blobUrlsToRevoke.add(message.localCoverUrl)
    }
  }
  const sendMediaMessage = async (
    { contactId, contactType, file, cover, uploadSourceId: registeredUploadSourceId },
    fileType,
    retryMessage = null
  ) => {
    const releaseUnusedSource = () =>
      retryMessage?.uploadSourceId ? undefined : releaseSource(registeredUploadSourceId)
    if (!file) return releaseUnusedSource()
    const sizeResult = validateFileSize(file, fileType)
    if (!sizeResult.valid) {
      await releaseUnusedSource()
      proxy.Message.warning(sizeResult.message)
      return
    }
    let uploadSourceId = retryMessage?.uploadSourceId || registeredUploadSourceId
    if (!uploadSourceId) {
      try {
        const result = await window.api.registerUploadSource(file)
        if (!result?.success || !result.uploadSourceId) {
          proxy.Message.warning(result?.error || '无法注册上传文件，请重新选择后再试。')
          return
        }
        uploadSourceId = result.uploadSourceId
      } catch (error) {
        console.error('register upload source failed', error)
        proxy.Message.warning('无法读取所选文件，请重新选择后再试。')
        return
      }
    }
    const sourceFile = typeof file.slice === 'function' ? file : { ...file, uploadSourceId }
    const localMessage =
      retryMessage ||
      lifecycle.createPendingMessage({
        contactId,
        contactType,
        messageType: 5,
        messageContent: file.name,
        file: sourceFile,
        fileType,
        filePath: '',
        uploadSourceId
      })
    Object.assign(localMessage, { uploadSourceId, retryFile: sourceFile, retryCover: cover })
    createLocalPreview(localMessage, file, cover, fileType)
    if (retryMessage) {
      if (!localMessage.clientMessageId)
        localMessage.clientMessageId = lifecycle.createClientMessageId()
      try {
        await lifecycle.markMessageSending(localMessage, {
          uploading: false,
          uploadAckReceived: false,
          uploadAckRevision: 0,
          uploadAckStatus: null,
          uploadSourceReleased: false
        })
      } catch (error) {
        console.error('save retry media message status failed', error)
        await lifecycle.markMessageFailed(
          localMessage,
          'Media retry failed. Local status could not be saved.'
        )
        return
      }
    } else {
      lifecycle.appendSentMessageIfMissing(localMessage)
      try {
        await lifecycle.persistPendingMessage(localMessage)
      } catch (error) {
        console.error('save pending media message failed', error)
        const unpersistedUploadSourceId = localMessage.uploadSourceId
        delete localMessage.uploadSourceId
        await releaseSource(unpersistedUploadSourceId)
        await lifecycle.markMessageFailed(
          localMessage,
          'Media message could not be saved locally. Retry later.'
        )
        return
      }
    }
    const result = await proxy.Request({
      url: proxy.Api.sendMessage,
      params: {
        contactId,
        contactType,
        messageType: 5,
        messageContent: file.name,
        fileSize: file.size,
        fileName: file.name,
        fileType,
        clientMessageId: localMessage.clientMessageId
      },
      showLoading: false,
      returnError: true
    })
    if (!result || isRequestFailure(result))
      return lifecycle.markMessageFailed(
        localMessage,
        getSendFailureMessage(result, '媒体消息发送失败，请检查网络后重试。')
      )
    const message = result.data
    if (!message?.messageId)
      return lifecycle.markMessageFailed(
        localMessage,
        'Media message send failed. Missing message id.'
      )
    message.uploadSourceId = uploadSourceId
    try {
      const serverMessage = await lifecycle.replaceLocalWithServerMessage(localMessage, message, {
        localPreviewUrl: localMessage.localPreviewUrl,
        localCoverUrl: localMessage.localCoverUrl,
        retryFile: sourceFile,
        retryCover: cover,
        uploading: true,
        uploadProgress: 0,
        uploadError: '',
        uploadCanceled: false,
        status: 2
      })
      queueUpload(serverMessage, sourceFile, cover)
    } catch (error) {
      lifecycle.markMessageLocalSyncFailed(localMessage, message, error, {
        recoveredStatus: 2,
        onRecovered: (recoveredMessage) => queueUpload(recoveredMessage, sourceFile, cover)
      })
    }
  }
  const retryMediaMessage = (message = {}) => {
    const retryFile =
      message.retryFile ||
      (message.uploadSourceId
        ? {
            uploadSourceId: message.uploadSourceId,
            name: message.fileName || message.messageContent,
            size: Number(message.fileSize || 0),
            type: ''
          }
        : null)
    if (!retryFile) {
      proxy.Message.warning('原文件来源已丢失，请重新选择文件后发送。')
      return
    }
    if (Number(message.messageId) > 0)
      return lifecycle
        .markMessageSending(message, {
          uploading: true,
          uploadProgress: 0,
          uploadError: '',
          uploadCanceled: false,
          uploadAckReceived: false,
          uploadAckRevision: 0,
          uploadAckStatus: null,
          uploadSourceReleased: false
        })
        .then(() => queueUpload(message, retryFile, message.retryCover))
        .catch((error) => console.error('retry media upload failed', error))
    return lifecycle.enqueueSendTask(() =>
      sendMediaMessage(
        {
          contactId: message.contactId,
          contactType: message.contactType,
          file: retryFile,
          cover: message.retryCover
        },
        message.fileType,
        message
      )
    )
  }
  const cleanup = () => {
    acknowledger.cleanup()
    coordinator.cleanup()
    blobUrlsToRevoke.forEach((url) => {
      try {
        URL.revokeObjectURL(url)
      } catch {
        /* URL may already be revoked. */
      }
    })
    blobUrlsToRevoke.clear()
  }
  return {
    cancelUploadMessage: acknowledger.cancelUploadMessage,
    cleanup,
    handleFileUploadDone: acknowledger.handleFileUploadDone,
    releaseRejectedMediaSource: acknowledger.releaseRejectedMediaSource,
    retryMediaMessage,
    sendMediaMessage,
    toggleUploadPause: acknowledger.toggleUploadPause
  }
}
