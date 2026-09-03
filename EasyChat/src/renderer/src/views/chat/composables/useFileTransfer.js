import { computed, ref } from 'vue'
import { CHAT_CONSTANTS } from '@/utils/ChatConstants'
import { getApiUrl } from '@/utils/Request'
import Utils from '@/utils/Utils'

/** Page-facing facade for file dialog state, download access and video preview. */
export const useFileTransfer = ({ proxy }) => {
  const selectedFileMessage = ref(null)
  const showFilePreviewDialog = ref(false)
  const fileAccess = createFileAccessController({ proxy })
  const videoPreview = createVideoPreviewController({ fileAccess, proxy })

  const selectedFileDownloadState = computed(() =>
    fileAccess.getDownloadState(selectedFileMessage.value)
  )
  // A download belongs to a message, not to the page. Keeping this derived from
  // the selected message prevents one completed download from clearing another
  // message's in-flight UI state.
  const isReceivingFile = computed(() => fileAccess.isDownloading(selectedFileMessage.value))
  const selectedVideoDownloadState = computed(() =>
    fileAccess.getDownloadState(videoPreview.selectedVideoMessage.value)
  )
  const openFilePreviewDialog = (message) => {
    if (!Utils.isFileMessage(message)) return
    selectedFileMessage.value = message
    showFilePreviewDialog.value = true
  }
  const closeFilePreviewDialog = () => {
    selectedFileMessage.value = null
  }
  const receiveSelectedFileMessage = async () => {
    const message = selectedFileMessage.value
    if (!message || Utils.isFileReceiveDisabled(message)) return
    await fileAccess.downloadFileMessage(message)
  }
  const downloadSelectedVideoMessage = async () => {
    if (videoPreview.selectedVideoMessage.value) {
      await fileAccess.downloadFileMessage(videoPreview.selectedVideoMessage.value)
    }
  }
  const cancelSelectedFileDownload = async () => {
    if (selectedFileMessage.value)
      return await fileAccess.cancelDownloadFileMessage(selectedFileMessage.value)
    return false
  }
  const cancelSelectedVideoDownload = async () => {
    if (videoPreview.selectedVideoMessage.value) {
      return await fileAccess.cancelDownloadFileMessage(videoPreview.selectedVideoMessage.value)
    }
    return false
  }
  const cleanupFileTransfer = () => {
    closeFilePreviewDialog()
    videoPreview.cleanup()
  }

  return {
    cleanupFileTransfer,
    cancelSelectedFileDownload,
    cancelSelectedVideoDownload,
    closeFilePreviewDialog,
    closeVideoPreviewDialog: videoPreview.closeVideoPreviewDialog,
    downloadSelectedVideoMessage,
    isReceivingFile,
    isLoadingVideo: videoPreview.isLoadingVideo,
    markVideoPlaybackError: videoPreview.markVideoPlaybackError,
    openDownloadedFile: fileAccess.openDownloadedFile,
    openFilePreviewDialog,
    openSelectedVideoExternal: videoPreview.openSelectedVideoExternal,
    openVideoPreviewDialog: videoPreview.openVideoPreviewDialog,
    receiveSelectedFileMessage,
    selectedFileDownloadState,
    selectedFileMessage,
    selectedVideoDownloadState,
    selectedVideoMessage: videoPreview.selectedVideoMessage,
    showDownloadedFileInFolder: fileAccess.showDownloadedFileInFolder,
    showFilePreviewDialog,
    showVideoPreviewDialog: videoPreview.showVideoPreviewDialog,
    videoDownloadProgress: videoPreview.videoDownloadProgress,
    videoPlaybackError: videoPreview.videoPlaybackError,
    videoPreviewUrl: videoPreview.videoPreviewUrl
  }
}

const emptyDownloadState = () => ({ status: '', progress: 0, path: '', error: '' })

/** Internal signed-download and desktop file-access controller. */
export const createFileAccessController = ({ proxy }) => {
  const downloadStates = ref({}),
    activeDownloadKeys = new Set(),
    activeDownloadCancels = new Map()
  const getDownloadKey = (message) => String(message?.messageId || '')
  const getDownloadState = (message) =>
    downloadStates.value[getDownloadKey(message)] || emptyDownloadState()
  const isDownloading = (message) => getDownloadState(message).status === 'downloading'
  const patchDownloadState = (message, patch = {}) => {
    const key = getDownloadKey(message)
    if (!key) return
    const next = { ...getDownloadState(message), ...patch }
    downloadStates.value = { ...downloadStates.value, [key]: next }
    Object.assign(message, {
      downloadStatus: next.status,
      downloadProgress: next.progress,
      downloadPath: next.path,
      downloadError: next.error
    })
  }
  const createDownloadUrl = async (
    message,
    { download = false, showCover = false, signal, returnDetails = false } = {}
  ) => {
    const result = await proxy.Request({
      url: proxy.Api.createDownloadToken,
      params: { fileId: message.messageId, showCover, download },
      showLoading: false,
      showError: false,
      signal,
      returnError: true
    })
    const streamUrl = result?.data?.streamUrl,
      url = streamUrl ? getApiUrl(streamUrl) || '' : ''
    return returnDetails
      ? {
          url,
          error:
            result?.msg ||
            result?.error ||
            (result?.kind === 'network' ? '文件服务不可达，请检查网络后重试。' : ''),
          kind: result?.kind || ''
        }
      : url
  }
  const downloadFileMessage = async (message) => {
    if ((!Utils.isFileMessage(message) && !Utils.isVideoMessage(message)) || message.status == 0)
      return false
    const downloadKey = getDownloadKey(message)
    if (getDownloadState(message).status === 'downloading' || activeDownloadKeys.has(downloadKey))
      return false
    const declaredSize = Number(message.fileSize || 0)
    if (declaredSize > CHAT_CONSTANTS.MAX_DOWNLOAD_SIZE) {
      const error = `File is too large. Limit: ${Utils.formatFileSize(CHAT_CONSTANTS.MAX_DOWNLOAD_SIZE)}`
      patchDownloadState(message, { status: 'failed', progress: 0, error })
      proxy.Message.error(error)
      return false
    }
    activeDownloadKeys.add(downloadKey)
    patchDownloadState(message, { status: 'downloading', progress: 0, error: '', path: '' })
    const controller = new AbortController()
    activeDownloadCancels.set(downloadKey, async () => {
      controller.abort()
      return await window.api.invokeCancelDownloadChatFile({ messageId: message.messageId })
    })
    try {
      const downloadAccess = await createDownloadUrl(message, {
        download: true,
        signal: controller.signal,
        returnDetails: true
      })
      if (controller.signal.aborted) {
        patchDownloadState(message, { status: 'canceled', progress: 0, error: '', path: '' })
        return false
      }
      if (!downloadAccess.url) {
        patchDownloadState(message, {
          status: 'failed',
          progress: 0,
          error: downloadAccess.error || 'Download link could not be created.'
        })
        proxy.Message.error(downloadAccess.error || 'Download failed')
        return false
      }
      const progressHandler = (payload = {}) => {
        if (String(payload.messageId) !== String(message.messageId)) return
        patchDownloadState(message, {
          status: 'downloading',
          progress: Number(payload.progress || 0),
          error: '',
          path: ''
        })
      }
      const unsubscribeProgress = window.api.onDownloadChatFileProgress(progressHandler)
      let result
      try {
        result = await window.api.invokeDownloadChatFile({
          url: downloadAccess.url,
          fileName: Utils.getFileMessageName(message),
          fileSize: declaredSize,
          maxSize: CHAT_CONSTANTS.MAX_DOWNLOAD_SIZE,
          messageId: message.messageId
        })
      } finally {
        unsubscribeProgress?.()
      }
      if (!result?.success) {
        if (result?.kind === 'canceled' || controller.signal.aborted) {
          patchDownloadState(message, { status: 'canceled', progress: 0, error: '', path: '' })
          return false
        }
        patchDownloadState(message, {
          status: 'failed',
          progress: Number(result?.progress || 0),
          error: result?.error || 'Download failed'
        })
        proxy.Message.error(result?.error || 'Download failed')
        return false
      }
      patchDownloadState(message, {
        status: 'done',
        progress: 100,
        path: result.filePath,
        error: ''
      })
      proxy.Message.success('Download complete')
      return true
    } finally {
      activeDownloadKeys.delete(downloadKey)
      activeDownloadCancels.delete(downloadKey)
    }
  }
  const cancelDownloadFileMessage = async (message) => {
    const downloadKey = getDownloadKey(message)
    if (!downloadKey || !activeDownloadKeys.has(downloadKey)) return false
    patchDownloadState(message, { status: 'canceled', progress: 0, error: '', path: '' })
    const cancel = activeDownloadCancels.get(downloadKey)
    if (cancel) await cancel()
    return true
  }
  const openDownloadedFile = async (message) => {
    const path = getDownloadState(message).path
    if (!path) return
    const result = await window.api.invokeOpenDownloadedFile({ filePath: path })
    if (!result?.success) proxy.Message.error(result?.error || 'Open file failed')
  }
  const showDownloadedFileInFolder = async (message) => {
    const path = getDownloadState(message).path
    if (path) await window.api.invokeShowDownloadedFileInFolder({ filePath: path })
  }
  return {
    createDownloadUrl,
    cancelDownloadFileMessage,
    downloadFileMessage,
    getDownloadState,
    isDownloading,
    openDownloadedFile,
    showDownloadedFileInFolder
  }
}

export const MAX_VIDEO_PREVIEW_BLOB_BYTES = 128 * 1024 * 1024

/** Internal video-preview owner that releases every browser-owned playback URL. */
export const createVideoPreviewController = ({ fileAccess, proxy }) => {
  const selectedVideoMessage = ref(null),
    showVideoPreviewDialog = ref(false),
    isLoadingVideo = ref(false),
    videoDownloadProgress = ref(0),
    videoPlaybackError = ref(''),
    videoPreviewUrl = ref('')
  let videoPreviewBlob = null,
    ownsVideoPreviewUrl = false,
    previewSeq = 0,
    disposed = false,
    previewAbortController = null
  const abortVideoPreviewLoad = () => {
    previewAbortController?.abort()
    previewAbortController = null
  }
  const revokeVideoPreviewUrl = () => {
    if (videoPreviewUrl.value && ownsVideoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl.value)
    videoPreviewUrl.value = ''
    videoPreviewBlob = null
    videoDownloadProgress.value = 0
    videoPlaybackError.value = ''
    ownsVideoPreviewUrl = false
  }
  const parseBlobError = async (blob) => {
    if (!blob || (!blob.type?.includes('json') && blob.size > 2048)) return ''
    try {
      const trimmed = (await blob.text()).trim()
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return ''
      try {
        const json = JSON.parse(trimmed)
        return json.info || json.msg || json.message || trimmed
      } catch {
        return trimmed
      }
    } catch {
      return ''
    }
  }
  const readLocalVideoBlob = async (message, onProgress) => {
    if (
      !message?.filePath ||
      !window.api ||
      Number(message.fileSize || 0) > MAX_VIDEO_PREVIEW_BLOB_BYTES
    )
      return null
    const result = await window.api.invokeReadLocalVideoFile({ filePath: message.filePath }),
      buffer = result?.arrayBuffer || result?.buffer
    if (!result?.success || !buffer) return null
    onProgress?.(100)
    return new Blob([buffer], { type: Utils.getVideoMimeType(Utils.getFileMessageName(message)) })
  }
  const fetchVideoBlobFallback = async (message, onProgress, { signal, abort } = {}) => {
    if (signal?.aborted) return { canceled: true }
    if (Number(message?.fileSize || 0) > MAX_VIDEO_PREVIEW_BLOB_BYTES) return { tooLarge: true }
    let tooLarge = false
    onProgress?.(0)
    const blob = await proxy.Request({
      url: proxy.Api.downloadFile,
      params: { fileId: message.messageId, showCover: false },
      responseType: 'blob',
      showLoading: false,
      showError: false,
      timeout: 0,
      signal,
      returnError: true,
      downloadProgressCallback: (event) => {
        if (Number(event?.total || 0) > MAX_VIDEO_PREVIEW_BLOB_BYTES) {
          tooLarge = true
          abort?.()
          return
        }
        if (event?.total)
          onProgress?.(Math.min(99, Math.max(0, Math.round((event.loaded / event.total) * 100))))
      }
    })
    if (signal?.aborted) return { canceled: !tooLarge, tooLarge }
    if (!blob || blob?.success === false)
      return { blob: await readLocalVideoBlob(message, onProgress) }
    if ((await parseBlobError(blob)) || blob.type?.includes('json'))
      return { blob: await readLocalVideoBlob(message, onProgress) }
    onProgress?.(100)
    return {
      blob: new Blob([blob], { type: Utils.getVideoMimeType(Utils.getFileMessageName(message)) })
    }
  }
  const closeVideoPreviewDialog = () => {
    previewSeq += 1
    abortVideoPreviewLoad()
    selectedVideoMessage.value = null
    isLoadingVideo.value = false
    revokeVideoPreviewUrl()
  }
  const openVideoPreviewDialog = async (message) => {
    if (!Utils.isVideoMessage(message) || Utils.isVideoPreviewDisabled(message)) return
    abortVideoPreviewLoad()
    const controller = new AbortController()
    previewAbortController = controller
    const requestSeq = ++previewSeq,
      isCurrent = () =>
        !disposed &&
        requestSeq === previewSeq &&
        previewAbortController === controller &&
        selectedVideoMessage.value?.messageId == message.messageId
    selectedVideoMessage.value = message
    showVideoPreviewDialog.value = true
    revokeVideoPreviewUrl()
    if (message.localPreviewUrl) {
      videoPreviewUrl.value = message.localPreviewUrl
      return
    }
    isLoadingVideo.value = true
    const streamUrl = await fileAccess.createDownloadUrl(message, {
      download: false,
      signal: controller.signal
    })
    if (!isCurrent()) return
    isLoadingVideo.value = false
    if (streamUrl) {
      videoPreviewUrl.value = streamUrl
      return
    }
    isLoadingVideo.value = true
    const fallback = await fetchVideoBlobFallback(
      message,
      (progress) => {
        if (isCurrent()) videoDownloadProgress.value = progress
      },
      { signal: controller.signal, abort: () => controller.abort() }
    )
    if (!isCurrent()) return
    isLoadingVideo.value = false
    if (fallback.tooLarge) {
      videoPlaybackError.value = '视频过大，无法直接预览，请下载后播放'
      return
    }
    if (!fallback.blob) {
      videoPlaybackError.value = '视频暂时无法预览，可以下载后打开'
      return
    }
    videoPreviewBlob = fallback.blob
    videoPreviewUrl.value = URL.createObjectURL(fallback.blob)
    ownsVideoPreviewUrl = true
  }
  const markVideoPlaybackError = () => {
    videoPlaybackError.value = '当前视频编码暂不支持内置预览，可以下载或用系统播放器打开'
  }
  const openSelectedVideoExternal = async () => {
    const message = selectedVideoMessage.value
    if (!message || !window.api) return
    if (
      message.filePath &&
      (await window.api.invokeOpenLocalVideoFile({ filePath: message.filePath }))?.success
    )
      return
    const state = fileAccess.getDownloadState(message)
    if (
      state.path &&
      (await window.api.invokeOpenDownloadedFile({ filePath: state.path }))?.success
    )
      return
    const fallback = videoPreviewBlob
      ? { blob: videoPreviewBlob }
      : await fetchVideoBlobFallback(message, undefined, {
          signal: previewAbortController?.signal,
          abort: () => previewAbortController?.abort()
        })
    if (!fallback.blob) return
    const result = await window.api.invokeOpenTempVideoFile({
      fileName: Utils.getFileMessageName(message),
      buffer: await fallback.blob.arrayBuffer()
    })
    if (!result?.success) proxy.Message.error(result?.error || '打开系统播放器失败')
  }
  const cleanup = () => {
    disposed = true
    closeVideoPreviewDialog()
  }
  return {
    cleanup,
    closeVideoPreviewDialog,
    markVideoPlaybackError,
    openSelectedVideoExternal,
    openVideoPreviewDialog,
    selectedVideoMessage,
    showVideoPreviewDialog,
    isLoadingVideo,
    videoDownloadProgress,
    videoPlaybackError,
    videoPreviewUrl
  }
}
