import { ref } from 'vue'
import Utils from '@/utils/Utils'

export const MAX_VIDEO_PREVIEW_BLOB_BYTES = 128 * 1024 * 1024

/** Owns video-preview state and any object URL created solely for playback. */
export const createVideoPreviewController = ({ fileAccess, proxy }) => {
  const selectedVideoMessage = ref(null)
  const showVideoPreviewDialog = ref(false)
  const isLoadingVideo = ref(false)
  const videoDownloadProgress = ref(0)
  const videoPlaybackError = ref('')
  const videoPreviewUrl = ref('')
  let videoPreviewBlob = null
  let ownsVideoPreviewUrl = false
  let previewSeq = 0
  let disposed = false
  let previewAbortController = null

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
    if (!blob) return ''
    const contentType = blob.type || ''
    if (!contentType.includes('json') && blob.size > 2048) return ''
    try {
      const text = await blob.text()
      const trimmed = text.trim()
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
    if (!message?.filePath || !window.api || Number(message.fileSize || 0) > 128 * 1024 * 1024) {
      return null
    }
    const result = await window.api.invokeReadLocalVideoFile({ filePath: message.filePath })
    const buffer = result?.arrayBuffer || result?.buffer
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
        if (!event?.total) return
        onProgress?.(Math.min(99, Math.max(0, Math.round((event.loaded / event.total) * 100))))
      }
    })
    if (signal?.aborted) return { canceled: !tooLarge, tooLarge }
    if (!blob || blob?.success === false) {
      if (signal?.aborted) return { canceled: true }
      return { blob: await readLocalVideoBlob(message, onProgress) }
    }
    const errorText = await parseBlobError(blob)
    if (signal?.aborted) return { canceled: true }
    if (errorText || blob.type?.includes('json')) {
      return { blob: await readLocalVideoBlob(message, onProgress) }
    }
    onProgress?.(100)
    return { blob: new Blob([blob], { type: Utils.getVideoMimeType(Utils.getFileMessageName(message)) }) }
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
    const requestSeq = ++previewSeq
    const isCurrent = () =>
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
    const fallback = await fetchVideoBlobFallback(message, (progress) => {
      if (isCurrent()) videoDownloadProgress.value = progress
    }, { signal: controller.signal, abort: () => controller.abort() })
    if (!isCurrent()) return
    isLoadingVideo.value = false
    if (fallback.tooLarge) {
      videoPlaybackError.value = '视频过大，无法直接预览，请下载后播放'
      return
    }
    const blob = fallback.blob
    if (!blob) {
      videoPlaybackError.value = '视频暂时无法预览，可以下载后打开'
      return
    }
    videoPreviewBlob = blob
    videoPreviewUrl.value = URL.createObjectURL(blob)
    ownsVideoPreviewUrl = true
  }

  const markVideoPlaybackError = () => {
    videoPlaybackError.value = '当前视频编码暂不支持内置预览，可以下载或用系统播放器打开'
  }

  const openSelectedVideoExternal = async () => {
    const message = selectedVideoMessage.value
    if (!message || !window.api) return
    if (message.filePath) {
      const result = await window.api.invokeOpenLocalVideoFile({ filePath: message.filePath })
      if (result?.success) return
    }
    const state = fileAccess.getDownloadState(message)
    if (state.path) {
      const result = await window.api.invokeOpenDownloadedFile({ filePath: state.path })
      if (result?.success) return
    }
    const fallback = videoPreviewBlob
      ? { blob: videoPreviewBlob }
      : await fetchVideoBlobFallback(message, undefined, {
          signal: previewAbortController?.signal,
          abort: () => previewAbortController?.abort()
        })
    const blob = fallback.blob
    if (!blob) return
    const result = await window.api.invokeOpenTempVideoFile({
      fileName: Utils.getFileMessageName(message),
      buffer: await blob.arrayBuffer()
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
