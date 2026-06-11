import { toRaw } from 'vue'

import { validateFileSize } from '@/utils/FileLimits'
import { cancelMediaUpload, uploadMediaFile } from './mediaUploadTransport'

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

  const maxUploadConcurrency = 3
  let localMessageSeq = -Date.now()
  const blobUrlsToRevoke = new Set()
  const uploadTaskQueue = []
  let activeUploadCount = 0
  const uploadControllers = new Map()

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
    return await window.electron.ipcRenderer.invoke('saveSendMessage', payload)
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

  const isRequestFailure = (result) => {
    return result && result.success === false
  }

  const getSendFailureMessage = (result, fallback = '消息发送失败，请检查网络后重试。') => {
    if (!isRequestFailure(result)) {
      return fallback
    }
    if (result.kind === 'timeout') {
      return '消息发送超时，请检查网络后重试。'
    }
    if (result.kind === 'auth_expired') {
      return '登录已过期，请重新登录后再发送。'
    }
    if (result.kind === 'api_code' && result.msg) {
      return result.msg
    }
    if (result.kind === 'http_status') {
      return '服务器暂时不可用，请稍后重试。'
    }
    if (result.kind === 'canceled') {
      return '请求已取消。'
    }
    return fallback
  }

  const getUploadFailureMessage = (result, canceled = false) => {
    if (canceled || result?.kind === 'canceled') {
      return '文件上传已取消。'
    }
    if (result?.kind === 'timeout') {
      return '文件上传超时，请检查网络后重试。'
    }
    if (result?.kind === 'api_code' && result.msg) {
      return result.msg
    }
    if (result?.kind === 'http_status') {
      return '文件上传服务暂时不可用，请稍后重试。'
    }
    return '文件上传失败，请检查网络后重试。'
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

  const enqueueSendTask = (task) => {
    sendTaskQueue = sendTaskQueue
      .catch((err) => {
        console.error('send queue: previous task failed, continuing', err)
      })
      .then(task)
      .catch((error) => {
        console.error('send message failed', error)
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
    filePath
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
      fileType,
      sendUserId: currentUserId?.value,
      sendTime: Date.now(),
      status: 2
    }
  }

  const markMessageFailed = async (message, errorText) => {
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
    if (errorText) {
      proxy.Message.error(errorText)
    }
  }

  const markMessageLocalSyncFailed = (localMessage, serverMessage, error) => {
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
    return nextMessage
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
    if (!messageContent) {
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
    uploadControllers.set(String(message.messageId), controller)
    const updateUploadProgress = (progress) => {
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
    const uploadResult = await uploadMediaFile({
      cover,
      file,
      fileType: message.fileType,
      message,
      onProgress: updateUploadProgress,
      proxy,
      signal: controller.signal
    })
    uploadControllers.delete(String(message.messageId))

    if (!uploadResult || isRequestFailure(uploadResult)) {
      const latestMessage = messageList.value.find((item) => {
        return item.messageId == message.messageId
      })
      if (latestMessage?.uploadAcked || latestMessage?.status == 1) {
        return
      }
      const canceled = controller.signal.aborted
      Object.assign(message, { uploadCanceled: canceled })
      updateMessageById?.(message.messageId, { uploadCanceled: canceled })
      await markMessageFailed(message, getUploadFailureMessage(uploadResult, canceled))
      return
    }

    message.uploading = false
    message.status = 1
    message.uploadProgress = 100
    message.uploadError = ''
    message.uploadCanceled = false
    updateMessageById?.(message.messageId, {
      uploading: false,
      status: 1,
      uploadProgress: 100,
      uploadError: '',
      uploadCanceled: false
    })
    await persistMessageStatus(message).catch((error) => {
      console.error('save uploaded media status failed', error)
      proxy.Message.error('File uploaded, but local message status could not be saved.')
    })
  }

  const sendMediaMessage = async (
    { contactId, contactType, file, cover },
    fileType,
    retryMessage = null
  ) => {
    if (!file) {
      return
    }

    const sizeResult = validateFileSize(file, fileType)
    if (!sizeResult.valid) {
      proxy.Message.warning(sizeResult.message)
      return
    }

    const filePath = file.path || window.api?.getPathForFile?.(file) || ''
    const localMessage =
      retryMessage ||
      createPendingMessage({
        contactId,
        contactType,
        messageType: 5,
        messageContent: file.name,
        file,
        fileType,
        filePath
      })
    localMessage.retryFile = file
    localMessage.retryCover = cover
    if (!localMessage.localPreviewUrl && (fileType === 0 || fileType === 1)) {
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
        await markMessageSending(localMessage, { uploading: false })
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

    let serverMessage = null
    try {
      serverMessage = await replaceLocalWithServerMessage(localMessage, message, {
        localPreviewUrl: localMessage.localPreviewUrl,
        localCoverUrl: localMessage.localCoverUrl,
        retryFile: file,
        retryCover: cover,
        uploading: true,
        uploadProgress: 0,
        uploadError: '',
        uploadCanceled: false,
        status: 2
      })
    } catch (error) {
      markMessageLocalSyncFailed(localMessage, message, error)
      return
    }
    enqueueUploadTask(() => uploadMessageFile(serverMessage, file, cover))
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
    enqueueSendTask(() => sendChatMessage(payload))
  }

  const onSendImageMessage = (payload) => {
    enqueueSendTask(() => sendImageMessage(payload))
  }

  const onSendFileMessage = (payload) => {
    enqueueSendTask(() => sendFileMessage(payload))
  }

  const onSendVideoMessage = (payload) => {
    enqueueSendTask(() => sendVideoMessage(payload))
  }

  const handleFileUploadDone = (message) => {
    // WebSocket 文件 ACK 可能晚于本地上传请求结束。
    const targetMessage = messageList.value.find((item) => {
      return item.messageId == message.messageId
    })

    if (targetMessage) {
      targetMessage.status = message.status ?? 1
      targetMessage.uploading = false
      targetMessage.uploadProgress = 100
      targetMessage.uploadError = ''
      targetMessage.uploadCanceled = false
      targetMessage.uploadAcked = true
      targetMessage.forceGet = Date.now()
    }
    // 文件 ACK 不影响会话列表排序。
  }

  const retryFailedMessage = (message = {}) => {
    if (message.status != 0) {
      return
    }

    if (message.messageType == 5) {
      if (!message.retryFile) {
        proxy.Message.warning('This file can only be retried before the app is restarted.')
        return
      }
      if (Number(message.messageId) > 0) {
        markMessageSending(message, {
          uploading: true,
          uploadProgress: 0,
          uploadError: '',
          uploadCanceled: false
        })
          .then(() => {
            enqueueUploadTask(() =>
              uploadMessageFile(message, message.retryFile, message.retryCover)
            )
          })
          .catch((error) => {
            console.error('retry media upload failed', error)
          })
        return
      }
      enqueueSendTask(() =>
        sendMediaMessage(
          {
            contactId: message.contactId,
            contactType: message.contactType,
            file: message.retryFile,
            cover: message.retryCover
          },
          message.fileType,
          message
        )
      )
      return
    }

    enqueueSendTask(() =>
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
      } catch (e) {}
    })
    blobUrlsToRevoke.clear()
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
