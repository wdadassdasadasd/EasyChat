import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { CHAT_CONSTANTS } from '@/utils/ChatConstants'
import { isVideoFile, validateFileSize } from '@/utils/FileLimits'
import { createMediaCoverFactory } from './mediaCoverFactory'

const { MAX_FILE_SELECT_COUNT } = CHAT_CONSTANTS

/**
 * Owns composer-local attachment drafts only. Network upload begins after the
 * caller dispatches a draft to the outbound message sender.
 */
export const usePendingMediaDrafts = ({
  api = typeof window === 'undefined' ? undefined : window.api,
  coverFactory = createMediaCoverFactory({ api }),
  fileLimit = MAX_FILE_SELECT_COUNT,
  notify = ElMessage,
  url = typeof URL === 'undefined' ? null : URL
} = {}) => {
  const uploadRef = ref()
  const pendingImageList = ref([])
  const pendingFileList = ref([])
  let pendingMediaSeq = 0

  const pendingMediaList = computed(() => {
    const images = pendingImageList.value.map((item) => ({ ...item, mediaType: 'image' }))
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

  const isImageFile = (file) => file?.type?.startsWith('image/')
  const isOverFileLimit = () =>
    pendingImageList.value.length + pendingFileList.value.length >= fileLimit
  const warnFileLimit = () => notify.warning(`Select up to ${fileLimit} files at a time`)

  const addPendingImage = async (file) => {
    if (!isImageFile(file)) {
      notify.warning('Please choose an image file')
      return false
    }
    const fileSizeResult = validateFileSize(file, 0)
    if (!fileSizeResult.valid) {
      notify.warning(fileSizeResult.message)
      return false
    }
    if (isOverFileLimit()) {
      warnFileLimit()
      return false
    }

    const order = nextPendingMediaOrder()
    const previewUrl = url.createObjectURL(file)
    const cover = await coverFactory.createImageCover(file)
    pendingImageList.value.push({
      id: `${Date.now()}_${Math.random()}`,
      order,
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
    const fileSizeResult = validateFileSize(file, fileType)
    if (!fileSizeResult.valid) {
      notify.warning(fileSizeResult.message)
      return false
    }
    if (isOverFileLimit()) {
      warnFileLimit()
      return false
    }

    const order = nextPendingMediaOrder()
    let uploadSourceId = ''
    if (fileType === 1) {
      const request = api?.registerUploadSource?.(file)
      const result = await Promise.resolve(request).catch(() => null)
      uploadSourceId = result?.uploadSourceId || ''
    }
    const pendingFile = {
      id: `${Date.now()}_${Math.random()}`,
      order,
      file,
      cover: fileType === 1 ? null : await coverFactory.createFileCover(),
      uploadSourceId,
      fileType,
      name: file.name,
      size: file.size
    }
    pendingFileList.value.push(pendingFile)
    if (fileType === 1) {
      pendingFile.cover = await coverFactory.createVideoCover(file, uploadSourceId)
    }
    return true
  }

  const addPendingMedia = async (file) => {
    if (isImageFile(file)) return addPendingImage(file)
    if (isVideoFile(file)) return addPendingFile(file, 1)
    return addPendingFile(file)
  }

  const releasePendingUploadSource = (item) => {
    if (!item?.uploadSourceId) return
    const request = api?.invokeReleaseUploadSource?.({ uploadSourceId: item.uploadSourceId })
    Promise.resolve(request).catch(() => {})
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

  const uploadExceed = () => warnFileLimit()
  const dragoverHandler = (event) => event.preventDefault()

  const dropHandler = async (event) => {
    event.preventDefault()
    for (const file of Array.from(event.dataTransfer?.files || [])) {
      await addPendingMedia(file)
    }
  }

  const pasteHandler = async (event) => {
    const imageItems = Array.from(event.clipboardData?.items || []).filter((item) =>
      item.type.startsWith('image/')
    )
    if (!imageItems.length) return
    event.preventDefault()
    for (const item of imageItems) {
      const file = item.getAsFile()
      if (file) await addPendingImage(file)
    }
  }

  const dispatchPendingMedia = (dispatch) => {
    pendingMediaList.value.forEach(dispatch)
    clearPendingImages()
    // 上传源已交给出站控制器，发送后不能在这里提前释放。
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
    dragoverHandler,
    dropHandler,
    fileLimit,
    pasteHandler,
    pendingFileList,
    pendingImageList,
    pendingMediaList,
    removePendingFile,
    removePendingImage,
    uploadExceed,
    uploadFile,
    uploadRef
  }
}
