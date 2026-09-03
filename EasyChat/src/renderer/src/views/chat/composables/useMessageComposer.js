import { computed, onBeforeUnmount, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { CHAT_CONSTANTS } from '@/utils/ChatConstants'
import { isVideoFile, validateFileSize } from '@/utils/FileLimits'
import Utils from '@/utils/Utils'

/**
 * Owns text input and composer UI state. Attachment draft ownership lives in
 * usePendingMediaDrafts so it can be tested and cleaned independently.
 */
export const useMessageComposer = ({ currentChatSession, emit }) => {
  const msgContent = ref('')
  const showEmojiPopover = ref(false)
  const showSendMessagePopover = ref(false)
  const mediaDrafts = usePendingMediaDrafts()

  const canSend = computed(
    () =>
      Boolean((msgContent.value || '').trim()) ||
      mediaDrafts.pendingImageList.value.length > 0 ||
      mediaDrafts.pendingFileList.value.length > 0
  )

  const closePopover = () => {
    showEmojiPopover.value = false
    showSendMessagePopover.value = false
  }

  const showEmojiPopoverHandler = () => {
    showEmojiPopover.value = !showEmojiPopover.value
  }

  const sendEmoji = (item) => {
    msgContent.value = (msgContent.value || '') + item
  }

  const sendMessage = () => {
    const messageContent = (msgContent.value || '').trim()
    if (!messageContent && !mediaDrafts.pendingMediaList.value.length) {
      showSendMessagePopover.value = true
      return
    }

    showSendMessagePopover.value = false
    mediaDrafts.dispatchPendingMedia((media) => {
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

    if (messageContent) {
      emit('sendMessage', {
        contactId: currentChatSession.value.contactId,
        contactType: currentChatSession.value.contactType,
        messageContent
      })
      msgContent.value = ''
    }
  }

  onBeforeUnmount(mediaDrafts.cleanup)

  return {
    canSend,
    closePopover,
    dragoverHandler: mediaDrafts.dragoverHandler,
    dropHandler: mediaDrafts.dropHandler,
    fileLimit: mediaDrafts.fileLimit,
    formatFileSize: Utils.formatFileSize,
    msgContent,
    pasteHandler: mediaDrafts.pasteHandler,
    pendingFileList: mediaDrafts.pendingFileList,
    pendingImageList: mediaDrafts.pendingImageList,
    pendingMediaList: mediaDrafts.pendingMediaList,
    removePendingFile: mediaDrafts.removePendingFile,
    removePendingImage: mediaDrafts.removePendingImage,
    sendEmoji,
    sendMessage,
    showEmojiPopover,
    showEmojiPopoverHandler,
    showSendMessagePopover,
    uploadExceed: mediaDrafts.uploadExceed,
    uploadFile: mediaDrafts.uploadFile,
    uploadRef: mediaDrafts.uploadRef
  }
}

const createFallbackCover = () => new Blob(['cover'], { type: 'text/plain' })

/** Internal attachment-cover factory; all temporary browser URLs are released before resolve. */
export const createMediaCoverFactory = ({
  api = typeof window === 'undefined' ? undefined : window.api,
  documentRef = typeof document === 'undefined' ? null : document,
  ImageConstructor = typeof Image === 'undefined' ? null : Image,
  url = typeof URL === 'undefined' ? null : URL
} = {}) => {
  const createFileCover = () => {
    if (!documentRef?.createElement) return Promise.resolve(createFallbackCover())
    return new Promise((resolve) => {
      const canvas = documentRef.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const context = canvas.getContext('2d')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, 1, 1)
      canvas.toBlob((blob) => resolve(blob || createFallbackCover()), 'image/png')
    })
  }
  const createImageCover = (file) => {
    if (!documentRef?.createElement || !ImageConstructor || !url?.createObjectURL)
      return Promise.resolve(file)
    return new Promise((resolve) => {
      const image = new ImageConstructor(),
        objectUrl = url.createObjectURL(file)
      let settled = false
      const done = (result) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        url.revokeObjectURL(objectUrl)
        resolve(result)
      }
      const timeout = setTimeout(() => done(file), 3000)
      image.onload = () => {
        const ratio = Math.min(240 / image.width, 240 / image.height, 1),
          canvas = documentRef.createElement('canvas')
        canvas.width = Math.round(image.width * ratio)
        canvas.height = Math.round(image.height * ratio)
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((blob) => done(blob || file), 'image/jpeg', 0.8)
      }
      image.onerror = () => done(file)
      image.src = objectUrl
    })
  }
  const createVideoCoverWithFfmpeg = async (uploadSourceId) => {
    if (!uploadSourceId) return null
    const result = await Promise.resolve(
      api?.invokeGenerateUploadSourceThumbnail?.({ uploadSourceId })
    ).catch(() => null)
    return result?.success && result.arrayBuffer
      ? new Blob([result.arrayBuffer], { type: 'image/jpeg' })
      : null
  }
  const createVideoCover = async (file, uploadSourceId) => {
    const ffmpegCover = await createVideoCoverWithFfmpeg(uploadSourceId)
    if (ffmpegCover) return ffmpegCover
    if (!documentRef?.createElement || !url?.createObjectURL) return createFileCover()
    return new Promise((resolve) => {
      const video = documentRef.createElement('video'),
        objectUrl = url.createObjectURL(file)
      let settled = false
      const cleanup = () => {
        if (settled) return false
        settled = true
        clearTimeout(timeout)
        video.pause?.()
        video.removeAttribute?.('src')
        video.load?.()
        url.revokeObjectURL(objectUrl)
        return true
      }
      const fallback = async () => {
        if (cleanup()) resolve(await createFileCover())
      }
      const timeout = setTimeout(fallback, 5000)
      video.preload = 'metadata'
      video.muted = true
      video.playsInline = true
      video.onloadedmetadata = () => {
        video.currentTime = Math.min(1, Math.max(0, (video.duration || 0) / 4))
      }
      video.onseeked = () => {
        if (!cleanup()) return
        const ratio = Math.min(360 / (video.videoWidth || 16), 360 / (video.videoHeight || 9), 1),
          canvas = documentRef.createElement('canvas')
        canvas.width = Math.round((video.videoWidth || 16) * ratio)
        canvas.height = Math.round((video.videoHeight || 9) * ratio)
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((blob) => resolve(blob || file), 'image/jpeg', 0.82)
      }
      video.onerror = fallback
      video.src = objectUrl
    })
  }
  return { createFileCover, createImageCover, createVideoCover, createVideoCoverWithFfmpeg }
}

/** Component-local attachment drafts. Upload starts only after dispatch. */
export const usePendingMediaDrafts = ({
  api = typeof window === 'undefined' ? undefined : window.api,
  coverFactory = createMediaCoverFactory({ api }),
  fileLimit = CHAT_CONSTANTS.MAX_FILE_SELECT_COUNT,
  notify = ElMessage,
  url = typeof URL === 'undefined' ? null : URL
} = {}) => {
  const uploadRef = ref(),
    pendingImageList = ref([]),
    pendingFileList = ref([])
  let pendingMediaSeq = 0
  const pendingMediaList = computed(() =>
    [
      ...pendingImageList.value.map((item) => ({ ...item, mediaType: 'image' })),
      ...pendingFileList.value.map((item) => ({
        ...item,
        mediaType: item.fileType === 1 ? 'video' : 'file'
      }))
    ].sort((a, b) => a.order - b.order)
  )
  const nextOrder = () => ++pendingMediaSeq
  const isImageFile = (file) => file?.type?.startsWith('image/')
  const isOverLimit = () =>
    pendingImageList.value.length + pendingFileList.value.length >= fileLimit
  const warnLimit = () => notify.warning(`Select up to ${fileLimit} files at a time`)
  const addPendingImage = async (file) => {
    if (!isImageFile(file)) {
      notify.warning('Please choose an image file')
      return false
    }
    const sizeResult = validateFileSize(file, 0)
    if (!sizeResult.valid) {
      notify.warning(sizeResult.message)
      return false
    }
    if (isOverLimit()) {
      warnLimit()
      return false
    }
    const previewUrl = url.createObjectURL(file),
      cover = await coverFactory.createImageCover(file)
    pendingImageList.value.push({
      id: `${Date.now()}_${Math.random()}`,
      order: nextOrder(),
      file,
      cover,
      previewUrl,
      name: file.name,
      size: file.size
    })
    return true
  }
  const addPendingFile = async (file, fileType = 2) => {
    if (!file) return false
    const sizeResult = validateFileSize(file, fileType)
    if (!sizeResult.valid) {
      notify.warning(sizeResult.message)
      return false
    }
    if (isOverLimit()) {
      warnLimit()
      return false
    }
    let uploadSourceId = ''
    if (fileType === 1)
      uploadSourceId =
        (await Promise.resolve(api?.registerUploadSource?.(file)).catch(() => null))
          ?.uploadSourceId || ''
    const pendingFile = {
      id: `${Date.now()}_${Math.random()}`,
      order: nextOrder(),
      file,
      cover: fileType === 1 ? null : await coverFactory.createFileCover(),
      uploadSourceId,
      fileType,
      name: file.name,
      size: file.size
    }
    pendingFileList.value.push(pendingFile)
    if (fileType === 1)
      pendingFile.cover = await coverFactory.createVideoCover(file, uploadSourceId)
    return true
  }
  const addPendingMedia = (file) =>
    isImageFile(file)
      ? addPendingImage(file)
      : isVideoFile(file)
        ? addPendingFile(file, 1)
        : addPendingFile(file)
  const releasePendingUploadSource = (item) => {
    if (item?.uploadSourceId)
      Promise.resolve(
        api?.invokeReleaseUploadSource?.({ uploadSourceId: item.uploadSourceId })
      ).catch(() => {})
  }
  const removePendingImage = (id) => {
    const image = pendingImageList.value.find((item) => item.id === id)
    if (image?.previewUrl) url.revokeObjectURL(image.previewUrl)
    pendingImageList.value = pendingImageList.value.filter((item) => item.id !== id)
  }
  const clearPendingImages = () => {
    pendingImageList.value.forEach((image) => {
      if (image.previewUrl) url.revokeObjectURL(image.previewUrl)
    })
    pendingImageList.value = []
  }
  const removePendingFile = (id) => {
    pendingFileList.value.filter((item) => item.id === id).forEach(releasePendingUploadSource)
    pendingFileList.value = pendingFileList.value.filter((item) => item.id !== id)
  }
  const clearPendingFiles = ({ releaseSources = true } = {}) => {
    if (releaseSources) pendingFileList.value.forEach(releasePendingUploadSource)
    pendingFileList.value = []
  }
  const uploadFile = async (uploadRequest) => {
    await addPendingMedia(uploadRequest.file)
    uploadRequest.onSuccess?.()
    uploadRef.value?.clearFiles()
  }
  const dropHandler = async (event) => {
    event.preventDefault()
    for (const file of Array.from(event.dataTransfer?.files || [])) await addPendingMedia(file)
  }
  const pasteHandler = async (event) => {
    const images = Array.from(event.clipboardData?.items || []).filter((item) =>
      item.type.startsWith('image/')
    )
    if (!images.length) return
    event.preventDefault()
    for (const item of images) {
      const file = item.getAsFile()
      if (file) await addPendingImage(file)
    }
  }
  const dispatchPendingMedia = (dispatch) => {
    pendingMediaList.value.forEach(dispatch)
    clearPendingImages()
    clearPendingFiles({ releaseSources: false })
  }
  const cleanup = () => {
    clearPendingImages()
    clearPendingFiles()
  }
  return {
    addPendingMedia,
    cleanup,
    dispatchPendingMedia,
    dragoverHandler: (event) => event.preventDefault(),
    dropHandler,
    fileLimit,
    pasteHandler,
    pendingFileList,
    pendingImageList,
    pendingMediaList,
    removePendingFile,
    removePendingImage,
    uploadExceed: warnLimit,
    uploadFile,
    uploadRef
  }
}
