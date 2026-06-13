import { computed, onBeforeUnmount, ref } from 'vue'
import { ElMessage } from 'element-plus'
import Utils from '@/utils/Utils'
import { CHAT_CONSTANTS } from '@/utils/ChatConstants'
import { isVideoFile as isKnownVideoFile, validateFileSize } from '@/utils/FileLimits'

const { MAX_FILE_SELECT_COUNT } = CHAT_CONSTANTS

/**
 * 消息输入框的状态管理入口。
 *
 * 负责文本草稿、表情弹窗、粘贴/拖拽/选择的待发送媒体、预览封面，
 * 并向外 emit 标准化发送事件；不直接请求网络，也不直接写本地消息历史。
 */
export const useMessageComposer = ({ currentChatSession, emit }) => {
  const msgContent = ref('')
  const showEmojiPopover = ref(false)
  const showSendMessagePopover = ref(false)
  const uploadRef = ref()
  const fileLimit = MAX_FILE_SELECT_COUNT
  const pendingImageList = ref([])
  const pendingFileList = ref([])
  let pendingMediaSeq = 0

  // 输入框只维护草稿状态，真正发送由 useChatMessageSender 处理。
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
    return isKnownVideoFile(file)
  }

  const createImageCover = (file) => {
    // 发送图片前先生成轻量封面。
    const COVER_TIMEOUT_MS = 3000
    return new Promise((resolve) => {
      const image = new Image()
      const objectUrl = URL.createObjectURL(file)
      let settled = false

      const done = (result) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        URL.revokeObjectURL(objectUrl)
        resolve(result)
      }

      const timeout = setTimeout(() => {
        console.warn('createImageCover timed out, using original file as cover')
        done(file)
      }, COVER_TIMEOUT_MS)

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
            done(blob || file)
          },
          'image/jpeg',
          0.8
        )
      }

      image.onerror = () => {
        done(file)
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

  const createVideoCoverWithFfmpeg = async (uploadSourceId) => {
    // Electron 环境下优先用 ffmpeg 提取封面，绕过浏览器 HEVC 解码限制。
    if (!uploadSourceId || !window.api) {
      return null
    }
    const result = await window.api.invokeGenerateUploadSourceThumbnail({
      uploadSourceId
    })
    if (!result?.success || !result?.arrayBuffer) {
      return null
    }
    return new Blob([result.arrayBuffer], { type: 'image/jpeg' })
  }

  const createVideoCover = async (file, uploadSourceId) => {
    // 优先用 ffmpeg 提取封面，绕过浏览器 HEVC 解码限制；失败时回退到 video 元素截帧。
    const ffmpegCover = await createVideoCoverWithFfmpeg(uploadSourceId)
    if (ffmpegCover) {
      return ffmpegCover
    }

    // 设置超时防止 video 元素在特定编码/短视频下永远不触发 seeked 事件导致泄漏。
    const COVER_TIMEOUT_MS = 5000
    return new Promise((resolve) => {
      const video = document.createElement('video')
      const objectUrl = URL.createObjectURL(file)
      let settled = false

      const cleanup = () => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        video.pause()
        video.removeAttribute('src')
        video.load()
        URL.revokeObjectURL(objectUrl)
      }

      const fallback = async () => {
        cleanup()
        resolve(await createFileCover())
      }

      const timeout = setTimeout(() => {
        console.warn('createVideoCover timed out, falling back to generic cover')
        fallback()
      }, COVER_TIMEOUT_MS)

      video.preload = 'metadata'
      video.muted = true
      video.playsInline = true
      video.onloadedmetadata = () => {
        const seekTime = Math.min(1, Math.max(0, (video.duration || 0) / 4))
        video.currentTime = seekTime
      }
      video.onseeked = () => {
        cleanup()
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
    ElMessage.warning(`Select up to ${fileLimit} files at a time`)
  }

  const addPendingImage = async (file) => {
    if (!isImageFile(file)) {
      ElMessage.warning('Please choose an image file')
      return
    }

    const fileSizeResult = validateFileSize(file, 0)
    if (!fileSizeResult.valid) {
      ElMessage.warning(fileSizeResult.message)
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

    const fileSizeResult = validateFileSize(file, fileType)
    if (!fileSizeResult.valid) {
      ElMessage.warning(fileSizeResult.message)
      return
    }

    if (isOverFileLimit()) {
      warnFileLimit()
      return
    }

    const order = nextPendingMediaOrder()
    let uploadSourceId = ''
    if (fileType === 1) {
      const sourceResult = await window.api.registerUploadSource(file).catch(() => null)
      uploadSourceId = sourceResult?.uploadSourceId || ''
    }
    const pendingFile = {
      id: `${Date.now()}_${Math.random()}`,
      order,
      file,
      cover: fileType === 1 ? null : await createFileCover(),
      uploadSourceId,
      fileType,
      name: file.name,
      size: file.size
    }
    pendingFileList.value.push(pendingFile)
    if (fileType === 1) {
      pendingFile.cover = await createVideoCover(file, uploadSourceId)
    }
  }

  const addPendingMedia = async (file) => {
    // 拖拽或选择的文件按类型分流为图片、视频或普通文件消息。
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

  const releasePendingUploadSource = (item) => {
    if (!item?.uploadSourceId) return
    window.api
      .invokeReleaseUploadSource({ uploadSourceId: item.uploadSourceId })
      .catch(() => {})
  }

  const removePendingFile = (id) => {
    pendingFileList.value
      .filter((item) => item.id === id)
      .forEach(releasePendingUploadSource)
    pendingFileList.value = pendingFileList.value.filter((item) => item.id !== id)
  }

  const clearPendingFiles = ({ releaseSources = true } = {}) => {
    if (releaseSources) {
      pendingFileList.value.forEach(releasePendingUploadSource)
    }
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

    // 先派发待发送媒体，再清空本地预览，避免同一文件重复发送。
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
        cover: media.cover,
        uploadSourceId: media.uploadSourceId
      })
    })

    clearPendingImages()

    clearPendingFiles({ releaseSources: false })

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
    // H-17: 清理 pending 文件的 blob URL，释放内存
    pendingFileList.value.forEach((item) => {
      if (item.previewUrl) {
        URL.revokeObjectURL(item.previewUrl)
      }
    })
    clearPendingFiles()
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
