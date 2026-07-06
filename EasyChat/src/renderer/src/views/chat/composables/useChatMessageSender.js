import { toRaw } from 'vue'

import { CHAT_CONSTANTS } from '@/utils/ChatConstants'
import { validateFileSize } from '@/utils/FileLimits'
import {
  getSendFailureMessage,
  getUploadFailureMessage,
  isRequestFailure
} from '@/utils/RequestFailure'
import { cancelMediaUpload, uploadMediaFile } from '@/utils/MediaUploadTransport'

/**
 * 出站消息发送链路的执行入口。
 *
 * 负责把 UI 发送事件转换成本地 pending 消息，通过 IPC 落库，
 * 用服务端 messageId 替换本地临时 id，上传媒体文件，处理文件 ACK，
 * 并支持失败消息重试；不管理输入框草稿状态。
 */
export const useChatMessageSender = ({
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
  // 串行化发送任务，保证本地消息顺序和服务端回包顺序对齐。
  let sendTaskQueue = Promise.resolve()
  let queuedSendTaskCount = 0

  const maxUploadConcurrency = 3
  let localMessageSeq = -Date.now()
  const blobUrlsToRevoke = new Set()
  const uploadTaskQueue = []
  let activeUploadCount = 0
  const uploadControllers = new Map()
  const uploadSourceReleaseRetryTimers = []

  const runNextUploadTask = () => {
    if (activeUploadCount >= maxUploadConcurrency || uploadTaskQueue.length === 0) {
      return
    }

    const task = uploadTaskQueue.shift()
    activeUploadCount += 1
    task()
      .catch((error) => {
        console.error('upload message file failed', error)
      })
      .finally(() => {
        activeUploadCount -= 1
        runNextUploadTask()
      })
  }

  const enqueueUploadTask = (task) => {
    uploadTaskQueue.push(task)
    runNextUploadTask()
  }

  const saveSendMessageToLocal = async (payload) => {
    return await window.api.invokeSaveSendMessage(payload)
  }

  const nextLocalMessageId = () => {
    localMessageSeq -= 1
    return localMessageSeq
  }

  const getCurrentSessionSnapshot = () => {
    return { ...toRaw(currentChatSession.value) }
  }

  const sessionMatchesCurrent = (sessionInfo) => {
    if (!sessionInfo?.contactId) {
      return true
    }
    const current = currentChatSession.value
    return String(sessionInfo.contactId) === String(current?.contactId)
  }

  const getLocalSessionId = (contactId, contactType) => {
    return currentChatSession.value.sessionId || `${contactType}_${contactId}`
  }

  const stripTransientMessageFields = (message = {}) => {
    const dbMessage = { ...message }
    delete dbMessage.localPreviewUrl
    delete dbMessage.localCoverUrl
    delete dbMessage.retryFile
    delete dbMessage.retryCover
    delete dbMessage.uploading
    delete dbMessage.uploadProgress
    delete dbMessage.uploadError
    delete dbMessage.uploadCanceled
    delete dbMessage.downloadStatus
    delete dbMessage.downloadProgress
    delete dbMessage.downloadPath
    delete dbMessage.downloadError
    delete dbMessage.uploadAcked
    delete dbMessage.uploadAckReceived
    delete dbMessage.uploadAckRevision
    delete dbMessage.uploadAckStatus
    delete dbMessage.uploadSourceReleased
    delete dbMessage.forceGet
    return dbMessage
  }

  const patchSessionFromSaveResult = (saveResult) => {
    // 仅当落库返回的 session 仍属于当前活跃会话时才更新 UI，防止跨会话污染
    if (saveResult?.session && sessionMatchesCurrent(saveResult.session)) {
      patchChatSessions?.([saveResult.session])
    }
  }

  const assertLocalSaveSuccess = (saveResult, fallbackError) => {
    if (!saveResult || saveResult.success === false) {
      throw new Error(saveResult?.error || fallbackError || 'Save message failed')
    }
    return saveResult
  }

  const persistPendingMessage = async (message) => {
    const saveResult = await saveSendMessageToLocal({
      mode: 'pending',
      message: stripTransientMessageFields(message),
      chatSession: getCurrentSessionSnapshot()
    })
    assertLocalSaveSuccess(saveResult, 'Save pending message failed')
    patchSessionFromSaveResult(saveResult)
    return saveResult
  }

  const persistMessageStatus = async (message) => {
    const saveResult = await saveSendMessageToLocal({
      mode: 'status',
      message: stripTransientMessageFields(message),
      status: message.status,
      chatSession: getCurrentSessionSnapshot()
    })
    assertLocalSaveSuccess(saveResult, 'Save message status failed')
    patchSessionFromSaveResult(saveResult)
    return saveResult
  }

  const persistServerMessage = async (localMessageId, message) => {
    const saveResult = await saveSendMessageToLocal({
      mode: 'replace',
      localMessageId,
      message: stripTransientMessageFields(message),
      chatSession: getCurrentSessionSnapshot()
    })
    assertLocalSaveSuccess(saveResult, 'Save server message failed')
    patchSessionFromSaveResult(saveResult)
    return saveResult
  }

  const enqueueSendTask = (task, { onRejected } = {}) => {
    if (queuedSendTaskCount >= CHAT_CONSTANTS.MAX_SEND_TASK_QUEUE) {
      onRejected?.()
      proxy.Message.warning('发送任务过多，请等待当前消息处理完成后再试。')
      return false
    }

    queuedSendTaskCount += 1
    sendTaskQueue = sendTaskQueue
      .catch((err) => {
        console.error('send queue: previous task failed, continuing', err)
      })
      .then(task)
      .catch((error) => {
        console.error('send message failed', error)
      })
      .finally(() => {
        queuedSendTaskCount = Math.max(0, queuedSendTaskCount - 1)
      })

    return sendTaskQueue
  }

  const appendSentMessageIfMissing = (message) => {
    const shouldStickToBottom = isNearMessageBottom()
    const appended =
      typeof appendMessageIfMissing === 'function'
        ? appendMessageIfMissing(message)
        : (() => {
            messageList.value.push(message)
            return true
          })()

    if (appended) {
      scrollMessageToBottom({ force: shouldStickToBottom })
    }
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
  }) => {
    return {
      messageId: nextLocalMessageId(),
      sessionId: getLocalSessionId(contactId, contactType),
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
    }
  }

  const markMessageFailed = async (message, errorText, { shouldReportError } = {}) => {
    Object.assign(message, {
      status: 0,
      uploading: false,
      uploadError: errorText || ''
    })
    updateMessageById?.(message.messageId, {
      status: 0,
      uploading: false,
      uploadError: errorText || ''
    })
    await persistMessageStatus(message).catch((error) => {
      console.error('save failed message status failed', error)
    })
    if (errorText && (!shouldReportError || shouldReportError())) {
      proxy.Message.error(errorText)
    }
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
    const replaced = replaceMessageById?.(localMessage.messageId, nextMessage)
    if (!replaced) {
      updateMessageById?.(localMessage.messageId, nextMessage)
    }
    console.error('message sent but local replace failed', error)
    proxy.Message.error('消息已发出，但本地记录保存失败，请稍后重新打开会话同步。')

    // P0-4: 后台异步重试 replace，最多重试 3 次，指数退避
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
    const delay = Math.min(2000 * attempt, 10000)
    const timer = setTimeout(async () => {
      // 从列表中移除此 timer
      const idx = localSyncRetryTimers.indexOf(timer)
      if (idx >= 0) localSyncRetryTimers.splice(idx, 1)
      try {
        await persistServerMessage(localMessageId, {
          ...recoveryMessage
        })
        const recoveredMessage = {
          ...recoveryMessage
        }
        const wasReplaced =
          replaceMessageById?.(localMessageId, recoveredMessage) ||
          replaceMessageById?.(recoveredMessage.messageId, recoveredMessage)
        if (!wasReplaced) {
          appendSentMessageIfMissing(recoveredMessage)
        }
        onRecovered?.(recoveredMessage)
      } catch (retryError) {
        console.error('local sync retry failed (attempt', attempt, ')', retryError)
        scheduleLocalSyncRetry(
          localMessageId,
          recoveryMessage,
          attempt + 1,
          maxRetries,
          onRecovered
        )
      }
    }, delay)
    localSyncRetryTimers.push(timer)
  }

  const markMessageSending = async (message, patch = {}) => {
    Object.assign(message, {
      status: 2,
      ...patch
    })
    updateMessageById?.(message.messageId, {
      status: 2,
      ...patch
    })
    await persistMessageStatus(message)
  }

  const replaceLocalWithServerMessage = async (localMessage, serverMessage, patch = {}) => {
    // C-7: 验证消息所属会话是否与当前活跃会话一致，防止切换会话后跨会话写入
    const activeSessionId = currentChatSession.value?.sessionId
    const messageSessionId = localMessage.sessionId || serverMessage.sessionId
    if (activeSessionId && messageSessionId && activeSessionId !== messageSessionId) {
      await persistServerMessage(localMessage.messageId, {
        ...localMessage,
        ...serverMessage,
        ...patch,
        status: patch.status ?? serverMessage.status ?? 1
      })
      return {
        ...localMessage,
        ...serverMessage,
        ...patch,
        status: patch.status ?? serverMessage.status ?? 1
      }
    }
    const nextMessage = {
      ...localMessage,
      ...serverMessage,
      ...patch,
      status: patch.status ?? serverMessage.status ?? 1
    }
    await persistServerMessage(localMessage.messageId, nextMessage)
    const replaced = replaceMessageById?.(localMessage.messageId, nextMessage)
    if (!replaced) {
      appendSentMessageIfMissing(nextMessage)
    }
    return nextMessage
  }

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
      createPendingMessage({
        contactId,
        contactType,
        messageType: 2,
        messageContent
      })

    if (retryMessage) {
      try {
        await markMessageSending(localMessage)
      } catch (error) {
        console.error('save retry text message status failed', error)
        await markMessageFailed(
          localMessage,
          'Message retry failed. Local status could not be saved.'
        )
        return
      }
    } else {
      appendSentMessageIfMissing(localMessage)
      try {
        await persistPendingMessage(localMessage)
      } catch (error) {
        console.error('save pending text message failed', error)
        await markMessageFailed(localMessage, 'Message could not be saved locally. Retry later.')
        return
      }
    }

    // 文本消息先拿到服务端 messageId，再替换本地临时消息。
    const result = await proxy.Request({
      url: proxy.Api.sendMessage,
      params: {
        contactId,
        contactType,
        messageType: 2,
        messageContent
      },
      showLoading: false,
      returnError: true
    })

    if (!result || isRequestFailure(result)) {
      await markMessageFailed(localMessage, getSendFailureMessage(result))
      return
    }

    const message = result.data
    try {
      await replaceLocalWithServerMessage(localMessage, message)
    } catch (error) {
      markMessageLocalSyncFailed(localMessage, message, error)
    }
  }

  const uploadMessageFile = async (message, file, cover) => {
    const sizeResult = validateFileSize(file, message.fileType)
    if (!sizeResult.valid) {
      await markMessageFailed(message, sizeResult.message)
      return
    }

    // C-7: 上传前验证消息所属会话是否与当前活跃会话一致
    const activeSessionId = currentChatSession.value?.sessionId
    const messageSessionId = message.sessionId
    if (activeSessionId && messageSessionId && activeSessionId !== messageSessionId) {
      await markMessageFailed(message, 'Session changed during upload. Please retry.')
      return
    }

    const controller = new AbortController()
    const uploadKey = String(message.messageId)
    uploadControllers.set(uploadKey, controller)
    const isCurrentUpload = () => uploadControllers.get(uploadKey) === controller
    const getLatestMessage = () => {
      return messageList.value.find((item) => item.messageId == message.messageId)
    }
    const updateUploadProgress = (progress) => {
      if (!isCurrentUpload() || getLatestMessage()?.uploadAckReceived) {
        return
      }
      const nextProgress = Math.min(99, Math.max(0, Number(progress) || 0))
      Object.assign(message, {
        uploading: true,
        uploadProgress: nextProgress,
        uploadError: '',
        uploadCanceled: false
      })
      updateMessageById?.(message.messageId, {
        status: 2,
        uploading: true,
        uploadProgress: nextProgress,
        uploadError: '',
        uploadCanceled: false
      })
    }
    updateUploadProgress(message.uploadProgress || 0)

    // 媒体消息先创建消息记录，文件上传只更新该消息状态。
    let uploadCover = cover
    if (!uploadCover && message.fileType === 1 && message.uploadSourceId) {
      const thumbnailResult = await window.api
        .invokeGenerateUploadSourceThumbnail({ uploadSourceId: message.uploadSourceId })
        .catch(() => null)
      if (thumbnailResult?.success && thumbnailResult.arrayBuffer) {
        uploadCover = new Blob([thumbnailResult.arrayBuffer], { type: 'image/jpeg' })
      }
    }

    const uploadResult = await uploadMediaFile({
      cover: uploadCover,
      file,
      fileType: message.fileType,
      message,
      onProgress: updateUploadProgress,
      proxy,
      signal: controller.signal
    })
    if (!isCurrentUpload()) {
      return
    }
    uploadControllers.delete(uploadKey)

    const latestMessage = getLatestMessage()
    if (latestMessage?.uploadAckReceived) {
      return
    }

    if (!uploadResult || isRequestFailure(uploadResult)) {
      const canceled = uploadResult?.kind === 'canceled'
      Object.assign(message, { uploadCanceled: canceled })
      updateMessageById?.(message.messageId, { uploadCanceled: canceled })
      await markMessageFailed(message, getUploadFailureMessage(uploadResult, canceled), {
        shouldReportError: () => !getLatestMessage()?.uploadAckReceived
      })
      return
    }

    const successfulMessage = latestMessage || message
    Object.assign(successfulMessage, {
      uploading: false,
      status: 1,
      uploadProgress: 100,
      uploadError: '',
      uploadCanceled: false
    })
    updateMessageById?.(message.messageId, {
      uploading: false,
      status: 1,
      uploadProgress: 100,
      uploadError: '',
      uploadCanceled: false
    })
    await persistMessageStatus(successfulMessage).catch((error) => {
      console.error('save uploaded media status failed', error)
      proxy.Message.error('File uploaded, but local message status could not be saved.')
    })
  }

  const sendMediaMessage = async (
    { contactId, contactType, file, cover, uploadSourceId: registeredUploadSourceId },
    fileType,
    retryMessage = null
  ) => {
    const releaseUnusedRegisteredSource = async () => {
      if (!registeredUploadSourceId || retryMessage?.uploadSourceId) {
        return
      }
      await window.api
        .invokeReleaseUploadSource({ uploadSourceId: registeredUploadSourceId })
        .catch((error) => console.error('release unused upload source failed', error))
    }

    if (!file) {
      await releaseUnusedRegisteredSource()
      return
    }

    const sizeResult = validateFileSize(file, fileType)
    if (!sizeResult.valid) {
      await releaseUnusedRegisteredSource()
      proxy.Message.warning(sizeResult.message)
      return
    }

    let uploadSourceId = retryMessage?.uploadSourceId || registeredUploadSourceId
    if (!uploadSourceId) {
      let sourceResult
      try {
        sourceResult = await window.api.registerUploadSource(file)
      } catch (error) {
        console.error('register upload source failed', error)
        proxy.Message.warning('无法读取所选文件，请重新选择后再试。')
        return
      }
      if (!sourceResult?.success || !sourceResult.uploadSourceId) {
        proxy.Message.warning(sourceResult?.error || '无法注册上传文件，请重新选择后再试。')
        return
      }
      uploadSourceId = sourceResult.uploadSourceId
    }
    const filePath = ''
    const sourceFile = typeof file.slice === 'function' ? file : { ...file, uploadSourceId }
    const localMessage =
      retryMessage ||
      createPendingMessage({
        contactId,
        contactType,
        messageType: 5,
        messageContent: file.name,
        file: sourceFile,
        fileType,
        filePath,
        uploadSourceId
      })
    localMessage.uploadSourceId = uploadSourceId
    localMessage.retryFile = sourceFile
    localMessage.retryCover = cover
    if (
      !localMessage.localPreviewUrl &&
      (fileType === 0 || fileType === 1) &&
      typeof Blob !== 'undefined' &&
      file instanceof Blob
    ) {
      localMessage.localPreviewUrl = URL.createObjectURL(file)
      // H-16: 记录需要清理的 blob URL，消息替换/移除时 revoke
      blobUrlsToRevoke.add(localMessage.localPreviewUrl)
    }
    // 视频消息额外保存封面 blob URL，缩略图用图片渲染，避免编码不支持时 video 标签黑屏。
    if (fileType === 1 && cover && !localMessage.localCoverUrl) {
      localMessage.localCoverUrl = URL.createObjectURL(cover)
      blobUrlsToRevoke.add(localMessage.localCoverUrl)
    }

    if (retryMessage) {
      try {
        await markMessageSending(localMessage, {
          uploading: false,
          uploadAckReceived: false,
          uploadAckRevision: 0,
          uploadAckStatus: null,
          uploadSourceReleased: false
        })
      } catch (error) {
        console.error('save retry media message status failed', error)
        await markMessageFailed(
          localMessage,
          'Media retry failed. Local status could not be saved.'
        )
        return
      }
    } else {
      appendSentMessageIfMissing(localMessage)
      try {
        await persistPendingMessage(localMessage)
      } catch (error) {
        console.error('save pending media message failed', error)
        await markMessageFailed(
          localMessage,
          'Media message could not be saved locally. Retry later.'
        )
        return
      }
    }

    // 图片、视频、文件统一使用 messageType=5，fileType 决定展示方式。
    const result = await proxy.Request({
      url: proxy.Api.sendMessage,
      params: {
        contactId,
        contactType,
        messageType: 5,
        messageContent: file.name,
        fileSize: file.size,
        fileName: file.name,
        fileType
      },
      showLoading: false,
      returnError: true
    })

    if (!result || isRequestFailure(result)) {
      await markMessageFailed(
        localMessage,
        getSendFailureMessage(result, '媒体消息发送失败，请检查网络后重试。')
      )
      return
    }

    const message = result.data
    if (!message?.messageId) {
      await markMessageFailed(localMessage, 'Media message send failed. Missing message id.')
      return
    }

    if (filePath) {
      message.filePath = filePath
    }
    message.uploadSourceId = uploadSourceId

    let serverMessage = null
    try {
      serverMessage = await replaceLocalWithServerMessage(localMessage, message, {
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
    } catch (error) {
      markMessageLocalSyncFailed(localMessage, message, error, {
        recoveredStatus: 2,
        onRecovered: (recoveredMessage) => {
          enqueueUploadTask(() => uploadMessageFile(recoveredMessage, sourceFile, cover))
        }
      })
      return
    }
    enqueueUploadTask(() => uploadMessageFile(serverMessage, sourceFile, cover))
  }

  const sendImageMessage = (payload) => {
    return sendMediaMessage(payload, 0)
  }

  const sendFileMessage = (payload) => {
    return sendMediaMessage(payload, 2)
  }

  const sendVideoMessage = (payload) => {
    return sendMediaMessage(payload, 1)
  }

  const onSendChatMessage = (payload) => {
    // 文本消息也进入发送队列，避免连续发送时展示顺序错乱。
    return enqueueSendTask(() => sendChatMessage(payload))
  }

  const releaseRejectedMediaSource = (payload = {}) => {
    if (!payload.uploadSourceId) {
      return
    }
    window.api
      .invokeReleaseUploadSource({ uploadSourceId: payload.uploadSourceId })
      .catch((error) => console.error('release rejected upload source failed', error))
  }

  const onSendImageMessage = (payload) => {
    return enqueueSendTask(() => sendImageMessage(payload), {
      onRejected: () => releaseRejectedMediaSource(payload)
    })
  }

  const onSendFileMessage = (payload) => {
    return enqueueSendTask(() => sendFileMessage(payload), {
      onRejected: () => releaseRejectedMediaSource(payload)
    })
  }

  const onSendVideoMessage = (payload) => {
    return enqueueSendTask(() => sendVideoMessage(payload), {
      onRejected: () => releaseRejectedMediaSource(payload)
    })
  }

  const releaseUploadSourceAfterAck = async (targetMessage, ackRevision, attempt = 0) => {
    if (
      targetMessage.uploadAckRevision !== ackRevision ||
      Number(targetMessage.uploadAckStatus) !== 1 ||
      targetMessage.uploadSourceReleased ||
      !targetMessage.uploadSourceId
    ) {
      return
    }

    const releaseResult = await window.api
      .invokeReleaseUploadSource({ uploadSourceId: targetMessage.uploadSourceId })
      .catch((error) => {
        console.error('release acknowledged upload source failed', error)
        return null
      })
    if (releaseResult?.success === true) {
      targetMessage.uploadSourceReleased = true
      return
    }

    // ACK 不保证重复投递；在本地有限重试，且只对同一条成功 ACK 保持有效。
    if (attempt >= 2) {
      return
    }
    const timer = setTimeout(
      () => {
        const index = uploadSourceReleaseRetryTimers.indexOf(timer)
        if (index >= 0) {
          uploadSourceReleaseRetryTimers.splice(index, 1)
        }
        releaseUploadSourceAfterAck(targetMessage, ackRevision, attempt + 1)
      },
      1000 * (attempt + 1)
    )
    uploadSourceReleaseRetryTimers.push(timer)
  }

  const handleFileUploadDone = async (message) => {
    // WebSocket 文件 ACK 是媒体处理的最终状态，迟到的 HTTP 结果不能再覆盖它。
    const targetMessage = messageList.value.find((item) => {
      return item.messageId == message.messageId
    })

    if (!targetMessage) {
      return
    }

    const ackStatus = Number(message.status ?? 1)
    const ackSucceeded = ackStatus === 1
    const repeatedAck =
      targetMessage.uploadAckReceived && Number(targetMessage.uploadAckStatus) === ackStatus
    const ackError = message.error || message.msg || 'File processing failed. Please retry.'
    const ackRevision = Number(targetMessage.uploadAckRevision || 0) + 1

    Object.assign(targetMessage, {
      status: ackStatus,
      uploading: false,
      uploadError: ackSucceeded ? '' : ackError,
      uploadCanceled: false,
      uploadAckReceived: true,
      uploadAckRevision: ackRevision,
      uploadAckStatus: ackStatus
    })

    const activeController = uploadControllers.get(String(targetMessage.messageId))
    uploadControllers.delete(String(targetMessage.messageId))
    activeController?.abort()

    if (ackSucceeded) {
      targetMessage.uploadProgress = 100
      targetMessage.forceGet = Date.now()
    } else if (!repeatedAck) {
      proxy.Message.error(ackError)
    }

    await persistMessageStatus(targetMessage).catch((error) => {
      console.error('save acknowledged media status failed', error)
      proxy.Message.error('Media status was confirmed, but could not be saved locally.')
    })

    if (
      targetMessage.uploadAckRevision !== ackRevision ||
      !ackSucceeded ||
      targetMessage.uploadSourceReleased ||
      !targetMessage.uploadSourceId
    ) {
      return
    }

    await releaseUploadSourceAfterAck(targetMessage, ackRevision)
    // 文件 ACK 不影响会话列表排序。
  }

  const retryFailedMessage = (message = {}) => {
    if (message.status != 0) {
      return
    }

    if (message.messageType == 5) {
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
      if (Number(message.messageId) > 0) {
        markMessageSending(message, {
          uploading: true,
          uploadProgress: 0,
          uploadError: '',
          uploadCanceled: false,
          uploadAckReceived: false,
          uploadAckRevision: 0,
          uploadAckStatus: null,
          uploadSourceReleased: false
        })
          .then(() => {
            enqueueUploadTask(() => uploadMessageFile(message, retryFile, message.retryCover))
          })
          .catch((error) => {
            console.error('retry media upload failed', error)
          })
        return
      }
      return enqueueSendTask(() =>
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

    return enqueueSendTask(() =>
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

  const cancelUploadMessage = (message = {}) => {
    if (!message.messageId || !message.uploading) {
      return
    }
    const controller = uploadControllers.get(String(message.messageId))
    controller?.abort()
    Object.assign(message, {
      uploadCanceled: true
    })
    updateMessageById?.(message.messageId, {
      uploadCanceled: true
    })
    cancelMediaUpload({
      messageId: message.messageId,
      proxy
    }).catch((error) => {
      console.error('cancel media upload failed', error)
    })
    markMessageFailed(message, '文件上传已取消。').catch((error) => {
      console.error('save canceled media status failed', error)
    })
  }

  const localSyncRetryTimers = []

  const cleanupUploadControllers = () => {
    uploadControllers.forEach((controller) => {
      try {
        controller.abort()
      } catch (e) {
        /* ignore */
      }
    })
    uploadControllers.clear()
    // H-16: 清理所有 blob URL，防止内存泄漏
    blobUrlsToRevoke.forEach((url) => {
      try {
        URL.revokeObjectURL(url)
      } catch (e) {
        // Blob URL may already have been revoked.
      }
    })
    blobUrlsToRevoke.clear()
    // P0-4: 清理后台重试定时器
    localSyncRetryTimers.forEach((timer) => {
      try {
        clearTimeout(timer)
      } catch (e) {
        // Timer cleanup is best effort during component teardown.
      }
    })
    localSyncRetryTimers.length = 0
    uploadSourceReleaseRetryTimers.forEach((timer) => {
      clearTimeout(timer)
    })
    uploadSourceReleaseRetryTimers.length = 0
  }

  return {
    cancelUploadMessage,
    cleanupUploadControllers,
    handleFileUploadDone,
    onSendChatMessage,
    onSendFileMessage,
    onSendImageMessage,
    onSendVideoMessage,
    retryFailedMessage
  }
}
