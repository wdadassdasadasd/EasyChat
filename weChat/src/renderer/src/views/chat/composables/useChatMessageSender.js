import { toRaw } from 'vue'

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
  const uploadTaskQueue = []
  let activeUploadCount = 0

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
    return await window.ipcRenderer.invoke('saveSendMessage', payload)
  }

  const nextLocalMessageId = () => {
    localMessageSeq -= 1
    return localMessageSeq
  }

  const getCurrentSessionSnapshot = () => {
    return { ...toRaw(currentChatSession.value) }
  }

  const getLocalSessionId = (contactId, contactType) => {
    return currentChatSession.value.sessionId || `${contactType}_${contactId}`
  }

  const stripTransientMessageFields = (message = {}) => {
    const dbMessage = { ...message }
    delete dbMessage.localPreviewUrl
    delete dbMessage.retryFile
    delete dbMessage.retryCover
    delete dbMessage.uploading
    delete dbMessage.uploadAcked
    delete dbMessage.forceGet
    return dbMessage
  }

  const patchSessionFromSaveResult = (saveResult) => {
    if (saveResult?.session) {
      patchChatSessions?.([saveResult.session])
    }
  }

  const persistPendingMessage = async (message) => {
    const saveResult = await saveSendMessageToLocal({
      mode: 'pending',
      message: stripTransientMessageFields(message),
      chatSession: getCurrentSessionSnapshot()
    })
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
    patchSessionFromSaveResult(saveResult)
    return saveResult
  }

  const enqueueSendTask = (task) => {
    sendTaskQueue = sendTaskQueue
      .catch(() => {})
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
      uploading: false
    })
    updateMessageById?.(message.messageId, {
      status: 0,
      uploading: false
    })
    await persistMessageStatus(message).catch((error) => {
      console.error('save failed message status failed', error)
    })
    if (errorText) {
      proxy.Message.error(errorText)
    }
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
    await persistMessageStatus(message).catch((error) => {
      console.error('save sending message status failed', error)
    })
  }

  const replaceLocalWithServerMessage = async (localMessage, serverMessage, patch = {}) => {
    const nextMessage = {
      ...localMessage,
      ...serverMessage,
      ...patch,
      status: patch.status ?? serverMessage.status ?? 1
    }
    const replaced = replaceMessageById?.(localMessage.messageId, nextMessage)
    if (!replaced) {
      appendSentMessageIfMissing(nextMessage)
    }
    await persistServerMessage(localMessage.messageId, nextMessage)
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
      await markMessageSending(localMessage)
    } else {
      appendSentMessageIfMissing(localMessage)
      await persistPendingMessage(localMessage).catch((error) => {
        console.error('save pending text message failed', error)
      })
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
      showLoading: false
    })

    if (!result) {
      await markMessageFailed(
        localMessage,
        'Message send failed. Retry after checking the network.'
      )
      return
    }

    const message = result.data
    await replaceLocalWithServerMessage(localMessage, message)
  }

  const uploadMessageFile = async (message, file, cover) => {
    // 媒体消息先创建消息记录，文件上传只更新该消息状态。
    const uploadResult = await proxy.Request({
      url: proxy.Api.uploadFile,
      params: {
        messageId: message.messageId,
        file,
        cover
      },
      showLoading: false,
      timeout: 0
    })

    if (!uploadResult) {
      const latestMessage = messageList.value.find((item) => {
        return item.messageId == message.messageId
      })
      if (latestMessage?.uploadAcked || latestMessage?.status == 1) {
        return
      }
      await markMessageFailed(message, 'File upload failed. The message can be retried.')
      return
    }

    message.uploading = false
    message.status = 1
    updateMessageById?.(message.messageId, {
      uploading: false,
      status: 1
    })
    await persistMessageStatus(message)
  }

  const sendMediaMessage = async (
    { contactId, contactType, file, cover },
    fileType,
    retryMessage = null
  ) => {
    if (!file) {
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
    }

    if (retryMessage) {
      await markMessageSending(localMessage, { uploading: false })
    } else {
      appendSentMessageIfMissing(localMessage)
      await persistPendingMessage(localMessage).catch((error) => {
        console.error('save pending media message failed', error)
      })
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
      showLoading: false
    })

    if (!result) {
      await markMessageFailed(
        localMessage,
        'Media message send failed. Retry after checking the network.'
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

    const serverMessage = await replaceLocalWithServerMessage(localMessage, message, {
      localPreviewUrl: localMessage.localPreviewUrl,
      retryFile: file,
      retryCover: cover,
      uploading: true,
      status: 2
    })
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
        markMessageSending(message, { uploading: true })
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

  return {
    handleFileUploadDone,
    onSendChatMessage,
    onSendFileMessage,
    onSendImageMessage,
    onSendVideoMessage,
    retryFailedMessage
  }
}

