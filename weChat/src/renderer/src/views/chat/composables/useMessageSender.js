import { computed, onBeforeUnmount, ref, toRaw } from 'vue'
import { ElMessage } from 'element-plus'
import Utils from '@/utils/Utils'
import { CHAT_CONSTANTS } from '@/utils/ChatConstants'

const { MAX_FILE_SELECT_COUNT } = CHAT_CONSTANTS

export const useMessageComposer = ({ currentChatSession, emit }) => {
  const msgContent = ref('')
  const showEmojiPopover = ref(false)
  const showSendMessagePopover = ref(false)
  const uploadRef = ref()
  const fileLimit = MAX_FILE_SELECT_COUNT
  const pendingImageList = ref([])
  const pendingFileList = ref([])
  let pendingMediaSeq = 0

  // 发送框只维护待发送草稿，真正的网络请求由 useChatMessageSender 接管。
  const canSend = computed(() => {
    return (
      Boolean((msgContent.value || '').trim()) ||
      pendingImageList.value.length > 0 ||
      pendingFileList.value.length > 0
    )
  })

  const pendingMediaList = computed(() => {
    const images = pendingImageList.value.map((item) => ({
      ...item,
      mediaType: 'image'
    }))
    const files = pendingFileList.value.map((item) => ({
      ...item,
      mediaType: item.fileType === 1 ? 'video' : 'file'
    }))

    return [...images, ...files].sort((a, b) => a.order - b.order)
  })

  const nextPendingMediaOrder = () => {
    pendingMediaSeq += 1
    return pendingMediaSeq
  }

  const closePopover = () => {
    showEmojiPopover.value = false
    showSendMessagePopover.value = false
  }

  const showEmojiPopoverHandler = () => {
    showEmojiPopover.value = !showEmojiPopover.value
  }

  const sendEmoji = (item) => {
    msgContent.value = `${msgContent.value || ''}${item}`
  }

  const isImageFile = (file) => {
    return file?.type?.startsWith('image/')
  }

  const isVideoFile = (file) => {
    if (file?.type?.startsWith('video/')) {
      return true
    }
    return /\.(mp4|avi|rmvb|mkv|mov)$/i.test(file?.name || '')
  }

  const createImageCover = (file) => {
    // 图片消息先生成轻量封面，发送时和原文件一起上传给后端。
    return new Promise((resolve) => {
      const image = new Image()
      const objectUrl = URL.createObjectURL(file)

      image.onload = () => {
        const maxSize = 240
        const ratio = Math.min(maxSize / image.width, maxSize / image.height, 1)
        const canvas = document.createElement('canvas')

        canvas.width = Math.round(image.width * ratio)
        canvas.height = Math.round(image.height * ratio)

        const context = canvas.getContext('2d')
        context.drawImage(image, 0, 0, canvas.width, canvas.height)

        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(objectUrl)
            resolve(blob || file)
          },
          'image/jpeg',
          0.8
        )
      }

      image.onerror = () => {
        URL.revokeObjectURL(objectUrl)
        resolve(file)
      }

      image.src = objectUrl
    })
  }

  const createFileCover = () => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const context = canvas.getContext('2d')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, 1, 1)
      canvas.toBlob((blob) => {
        resolve(blob || new Blob(['cover'], { type: 'text/plain' }))
      }, 'image/png')
    })
  }

  const createVideoCover = (file) => {
    // 视频封面取首段画面；失败时退化为通用文件封面，避免阻塞发送。
    return new Promise((resolve) => {
      const video = document.createElement('video')
      const objectUrl = URL.createObjectURL(file)

      const cleanup = () => {
        video.pause()
        video.removeAttribute('src')
        video.load()
        URL.revokeObjectURL(objectUrl)
      }

      const fallback = async () => {
        cleanup()
        resolve(await createFileCover())
      }

      video.preload = 'metadata'
      video.muted = true
      video.playsInline = true
      video.onloadedmetadata = () => {
        const seekTime = Math.min(1, Math.max(0, (video.duration || 0) / 4))
        video.currentTime = seekTime
      }
      video.onseeked = () => {
        const maxSize = 360
        const width = video.videoWidth || 16
        const height = video.videoHeight || 9
        const ratio = Math.min(maxSize / width, maxSize / height, 1)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(width * ratio)
        canvas.height = Math.round(height * ratio)
        const context = canvas.getContext('2d')
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(
          (blob) => {
            cleanup()
            resolve(blob || file)
          },
          'image/jpeg',
          0.82
        )
      }
      video.onerror = fallback
      video.src = objectUrl
    })
  }

  const isOverFileLimit = () => {
    return pendingImageList.value.length + pendingFileList.value.length >= fileLimit
  }

  const warnFileLimit = () => {
    ElMessage.warning(`一次最多选择 ${fileLimit} 个文件`)
  }

  const addPendingImage = async (file) => {
    if (!isImageFile(file)) {
      ElMessage.warning('请选择图片文件')
      return
    }

    if (isOverFileLimit()) {
      warnFileLimit()
      return
    }

    const order = nextPendingMediaOrder()
    const previewUrl = URL.createObjectURL(file)
    const cover = await createImageCover(file)

    pendingImageList.value.push({
      id: `${Date.now()}_${Math.random()}`,
      order,
      file,
      cover,
      previewUrl,
      name: file.name,
      size: file.size
    })
  }

  const addPendingFile = async (file, fileType = 2) => {
    if (!file) {
      return
    }

    if (isOverFileLimit()) {
      warnFileLimit()
      return
    }

    const order = nextPendingMediaOrder()
    pendingFileList.value.push({
      id: `${Date.now()}_${Math.random()}`,
      order,
      file,
      cover: fileType === 1 ? await createVideoCover(file) : await createFileCover(),
      fileType,
      name: file.name,
      size: file.size
    })
  }

  const addPendingMedia = async (file) => {
    // 拖拽/选择文件共用这里，根据 MIME 和后缀拆成图片、视频、普通文件三类。
    if (isImageFile(file)) {
      await addPendingImage(file)
      return
    }
    if (isVideoFile(file)) {
      await addPendingFile(file, 1)
      return
    }

    await addPendingFile(file)
  }

  const removePendingImage = (id) => {
    const image = pendingImageList.value.find((item) => item.id === id)
    if (image?.previewUrl) {
      URL.revokeObjectURL(image.previewUrl)
    }

    pendingImageList.value = pendingImageList.value.filter((item) => item.id !== id)
  }

  const clearPendingImages = () => {
    pendingImageList.value.forEach((image) => {
      if (image.previewUrl) {
        URL.revokeObjectURL(image.previewUrl)
      }
    })
    pendingImageList.value = []
  }

  const removePendingFile = (id) => {
    pendingFileList.value = pendingFileList.value.filter((item) => item.id !== id)
  }

  const clearPendingFiles = () => {
    pendingFileList.value = []
  }

  const uploadFile = async (uploadRequest) => {
    await addPendingMedia(uploadRequest.file)
    uploadRequest.onSuccess?.()
    uploadRef.value?.clearFiles()
  }

  const uploadExceed = () => {
    warnFileLimit()
  }

  const dropHandler = async (event) => {
    event.preventDefault()

    const files = Array.from(event.dataTransfer?.files || [])
    for (const file of files) {
      await addPendingMedia(file)
    }
  }

  const dragoverHandler = (event) => {
    event.preventDefault()
  }

  const pasteHandler = async (event) => {
    const items = Array.from(event.clipboardData?.items || [])
    const imageItems = items.filter((item) => item.type.startsWith('image/'))

    if (!imageItems.length) {
      return
    }

    event.preventDefault()
    for (const item of imageItems) {
      const file = item.getAsFile()
      if (file) {
        await addPendingImage(file)
      }
    }
  }

  const sendMessage = () => {
    const messageContent = (msgContent.value || '').trim()

    if (
      !messageContent &&
      pendingImageList.value.length === 0 &&
      pendingFileList.value.length === 0
    ) {
      showSendMessagePopover.value = true
      return
    }

    showSendMessagePopover.value = false

    // 先把所有待发送媒体派发给父组件，再清空本地预览，避免同一文件重复发送。
    pendingMediaList.value.forEach((media) => {
      const eventName =
        media.mediaType === 'image'
          ? 'sendImageMessage'
          : media.fileType === 1
            ? 'sendVideoMessage'
            : 'sendFileMessage'

      emit(eventName, {
        contactId: currentChatSession.value.contactId,
        contactType: currentChatSession.value.contactType,
        file: media.file,
        cover: media.cover
      })
    })

    clearPendingImages()

    clearPendingFiles()

    if (messageContent) {
      emit('sendMessage', {
        contactId: currentChatSession.value.contactId,
        contactType: currentChatSession.value.contactType,
        messageContent
      })

      msgContent.value = ''
    }
  }

  onBeforeUnmount(() => {
    clearPendingImages()
  })

  return {
    canSend,
    closePopover,
    dragoverHandler,
    dropHandler,
    fileLimit,
    formatFileSize: Utils.formatFileSize,
    msgContent,
    pasteHandler,
    pendingFileList,
    pendingImageList,
    pendingMediaList,
    removePendingFile,
    removePendingImage,
    sendEmoji,
    sendMessage,
    showEmojiPopover,
    showEmojiPopoverHandler,
    showSendMessagePopover,
    uploadExceed,
    uploadFile,
    uploadRef
  }
}

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
  // 发送任务串行化，避免连续回车或批量媒体上传时服务端消息顺序和本地列表顺序错乱。
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

    // 文本消息先走 HTTP 拿到服务端 messageId，再通知主进程保存到本地 SQLite。
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
    // 媒体消息先创建消息记录，再异步上传文件；上传失败只改变该消息状态。
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

    // 图片/视频/文件统一走 messageType=5，fileType 决定展示组件和预览能力。
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
    // 文本消息也加入串行队列，避免连续快速发送时网络回包乱序导致消息展示顺序错误。
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
    // WebSocket 文件回执可能晚于本地上传请求结束，用 forceGet 触发封面重新拉取。
    const targetMessage = messageList.value.find((item) => {
      return item.messageId == message.messageId
    })

    if (targetMessage) {
      targetMessage.status = message.status ?? 1
      targetMessage.forceGet = Date.now()
    }
    // 文件回执不影响会话排序信息，不需要更新会话列表。
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

    sendChatMessage(
      {
        contactId: message.contactId,
        contactType: message.contactType,
        messageContent: message.messageContent
      },
      message
    ).catch((error) => {
      console.error('retry text message failed', error)
    })
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
