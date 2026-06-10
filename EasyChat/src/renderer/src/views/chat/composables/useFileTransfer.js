import { computed, ref } from 'vue'
import { CHAT_CONSTANTS } from '@/utils/ChatConstants'
import { getApiUrl } from '@/utils/Request'
import Utils from '@/utils/Utils'

export const useFileTransfer = ({ proxy }) => {
  const selectedFileMessage = ref(null)
  const selectedVideoMessage = ref(null)
  const showFilePreviewDialog = ref(false)
  const showVideoPreviewDialog = ref(false)
  const isReceivingFile = ref(false)
  const isLoadingVideo = ref(false)
  const videoDownloadProgress = ref(0)
  const videoPlaybackError = ref('')
  const videoPreviewUrl = ref('')
  const downloadStates = ref({})
  let videoPreviewBlob = null
  let ownsVideoPreviewUrl = false

  const getDownloadKey = (message) => String(message?.messageId || '')

  const getDownloadState = (message) => {
    const key = getDownloadKey(message)
    return (
      downloadStates.value[key] || {
        status: '',
        progress: 0,
        path: '',
        error: ''
      }
    )
  }

  const patchDownloadState = (message, patch = {}) => {
    const key = getDownloadKey(message)
    if (!key) {
      return
    }
    const next = {
      ...getDownloadState(message),
      ...patch
    }
    downloadStates.value = {
      ...downloadStates.value,
      [key]: next
    }
    Object.assign(message, {
      downloadStatus: next.status,
      downloadProgress: next.progress,
      downloadPath: next.path,
      downloadError: next.error
    })
  }

  const selectedFileDownloadState = computed(() => getDownloadState(selectedFileMessage.value))
  const selectedVideoDownloadState = computed(() => getDownloadState(selectedVideoMessage.value))

  const revokeVideoPreviewUrl = () => {
    if (videoPreviewUrl.value && ownsVideoPreviewUrl) {
      URL.revokeObjectURL(videoPreviewUrl.value)
    }
    videoPreviewUrl.value = ''
    videoPreviewBlob = null
    videoDownloadProgress.value = 0
    videoPlaybackError.value = ''
    ownsVideoPreviewUrl = false
  }

  const createDownloadUrl = async (message, { download = false, showCover = false } = {}) => {
    const result = await proxy.Request({
      url: proxy.Api.createDownloadToken,
      params: {
        fileId: message.messageId,
        showCover,
        download
      },
      showLoading: false,
      showError: false
    })
    const streamUrl = result?.data?.streamUrl
    return streamUrl ? getApiUrl(streamUrl) : ''
  }

  const parseBlobError = async (blob) => {
    if (!blob) {
      return ''
    }
    const contentType = blob.type || ''
    if (!contentType.includes('json') && blob.size > 2048) {
      return ''
    }
    try {
      const text = await blob.text()
      const trimmed = text.trim()
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        return ''
      }
      try {
        const json = JSON.parse(trimmed)
        return json.info || json.msg || json.message || trimmed
      } catch (e) {
        return trimmed
      }
    } catch (e) {
      return ''
    }
  }

  const readLocalVideoBlob = async (message) => {
    const filePath = message?.filePath
    if (!filePath || !window.electron?.ipcRenderer?.invoke) {
      return null
    }

    const maxReadSize = 128 * 1024 * 1024
    if (Number(message.fileSize || 0) > maxReadSize) {
      return null
    }

    const result = await window.electron.ipcRenderer.invoke('readLocalVideoFile', { filePath })
    const buffer = result?.arrayBuffer || result?.buffer
    if (!result?.success || !buffer) {
      return null
    }

    videoDownloadProgress.value = 100
    return new Blob([buffer], { type: Utils.getVideoMimeType(Utils.getFileMessageName(message)) })
  }

  const fetchVideoBlobFallback = async (message) => {
    videoDownloadProgress.value = 0
    videoPlaybackError.value = ''
    const blob = await proxy.Request({
      url: proxy.Api.downloadFile,
      params: {
        fileId: message.messageId,
        showCover: false
      },
      responseType: 'blob',
      showLoading: false,
      showError: false,
      timeout: 0,
      downloadProgressCallback: (event) => {
        if (!event?.total) {
          return
        }
        videoDownloadProgress.value = Math.min(
          99,
          Math.max(0, Math.round((event.loaded / event.total) * 100))
        )
      }
    })
    if (!blob) {
      return await readLocalVideoBlob(message)
    }
    const errorText = await parseBlobError(blob)
    if (errorText || blob.type?.includes('json')) {
      return await readLocalVideoBlob(message)
    }
    videoDownloadProgress.value = 100
    return new Blob([blob], { type: Utils.getVideoMimeType(Utils.getFileMessageName(message)) })
  }

  const openFilePreviewDialog = (message) => {
    if (!Utils.isFileMessage(message)) {
      return
    }
    selectedFileMessage.value = message
    showFilePreviewDialog.value = true
  }

  const closeFilePreviewDialog = () => {
    selectedFileMessage.value = null
    isReceivingFile.value = false
  }

  const closeVideoPreviewDialog = () => {
    selectedVideoMessage.value = null
    isLoadingVideo.value = false
    revokeVideoPreviewUrl()
  }

  const downloadFileMessage = async (message) => {
    if ((!Utils.isFileMessage(message) && !Utils.isVideoMessage(message)) || message.status == 0) {
      return false
    }

    const currentState = getDownloadState(message)
    if (currentState.status === 'downloading') {
      return false
    }

    const declaredSize = Number(message.fileSize || 0)
    if (declaredSize > CHAT_CONSTANTS.MAX_DOWNLOAD_SIZE) {
      const error = `File is too large. Limit: ${Utils.formatFileSize(CHAT_CONSTANTS.MAX_DOWNLOAD_SIZE)}`
      patchDownloadState(message, { status: 'failed', progress: 0, error })
      proxy.Message.error(error)
      return false
    }

    const url = await createDownloadUrl(message, { download: true })
    if (!url) {
      patchDownloadState(message, {
        status: 'failed',
        progress: 0,
        error: 'Download link could not be created.'
      })
      proxy.Message.error('Download failed')
      return false
    }

    patchDownloadState(message, { status: 'downloading', progress: 0, error: '', path: '' })
    isReceivingFile.value = true
    const progressHandler = (_e, payload = {}) => {
      if (String(payload.messageId) !== String(message.messageId)) {
        return
      }
      patchDownloadState(message, {
        status: 'downloading',
        progress: Number(payload.progress || 0),
        error: '',
        path: ''
      })
    }
    window.electron.ipcRenderer.on('downloadChatFileProgress', progressHandler)
    let result
    try {
      result = await window.electron.ipcRenderer.invoke('downloadChatFile', {
        url,
        fileName: Utils.getFileMessageName(message),
        fileSize: declaredSize,
        maxSize: CHAT_CONSTANTS.MAX_DOWNLOAD_SIZE,
        messageId: message.messageId
      })
    } finally {
      window.electron.ipcRenderer.removeListener('downloadChatFileProgress', progressHandler)
    }
    isReceivingFile.value = false

    if (!result?.success) {
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
  }

  const openVideoPreviewDialog = async (message) => {
    if (!Utils.isVideoMessage(message) || Utils.isVideoPreviewDisabled(message)) {
      return
    }
    selectedVideoMessage.value = message
    showVideoPreviewDialog.value = true
    revokeVideoPreviewUrl()

    if (message.localPreviewUrl) {
      videoPreviewUrl.value = message.localPreviewUrl
      ownsVideoPreviewUrl = false
      return
    }

    isLoadingVideo.value = true
    const streamUrl = await createDownloadUrl(message, { download: false })
    isLoadingVideo.value = false
    if (streamUrl && selectedVideoMessage.value?.messageId == message.messageId) {
      videoPreviewUrl.value = streamUrl
      ownsVideoPreviewUrl = false
      return
    }

    isLoadingVideo.value = true
    const blob = await fetchVideoBlobFallback(message)
    isLoadingVideo.value = false
    if (!blob || selectedVideoMessage.value?.messageId != message.messageId) {
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
    if (!selectedVideoMessage.value || !window.electron?.ipcRenderer?.invoke) {
      return
    }

    if (selectedVideoMessage.value.filePath) {
      const result = await window.electron.ipcRenderer.invoke('openLocalVideoFile', {
        filePath: selectedVideoMessage.value.filePath
      })
      if (result?.success) {
        return
      }
    }

    const state = getDownloadState(selectedVideoMessage.value)
    if (state.path) {
      const result = await window.electron.ipcRenderer.invoke('openDownloadedFile', {
        filePath: state.path
      })
      if (result?.success) {
        return
      }
    }

    const blob = videoPreviewBlob || (await fetchVideoBlobFallback(selectedVideoMessage.value))
    if (!blob) {
      return
    }

    const buffer = await blob.arrayBuffer()
    const result = await window.electron.ipcRenderer.invoke('openTempVideoFile', {
      fileName: Utils.getFileMessageName(selectedVideoMessage.value),
      buffer
    })
    if (!result?.success) {
      proxy.Message.error(result?.error || '打开系统播放器失败')
    }
  }

  const downloadSelectedVideoMessage = async () => {
    if (!selectedVideoMessage.value) {
      return
    }
    await downloadFileMessage(selectedVideoMessage.value)
  }

  const receiveSelectedFileMessage = async () => {
    if (!selectedFileMessage.value || Utils.isFileReceiveDisabled(selectedFileMessage.value)) {
      return
    }
    await downloadFileMessage(selectedFileMessage.value)
  }

  const openDownloadedFile = async (message) => {
    const path = getDownloadState(message).path
    if (!path) {
      return
    }
    const result = await window.electron.ipcRenderer.invoke('openDownloadedFile', {
      filePath: path
    })
    if (!result?.success) {
      proxy.Message.error(result?.error || 'Open file failed')
    }
  }

  const showDownloadedFileInFolder = async (message) => {
    const path = getDownloadState(message).path
    if (!path) {
      return
    }
    await window.electron.ipcRenderer.invoke('showDownloadedFileInFolder', { filePath: path })
  }

  return {
    closeFilePreviewDialog,
    closeVideoPreviewDialog,
    downloadSelectedVideoMessage,
    isReceivingFile,
    isLoadingVideo,
    markVideoPlaybackError,
    openDownloadedFile,
    openFilePreviewDialog,
    openSelectedVideoExternal,
    openVideoPreviewDialog,
    receiveSelectedFileMessage,
    selectedFileDownloadState,
    selectedFileMessage,
    selectedVideoDownloadState,
    selectedVideoMessage,
    showDownloadedFileInFolder,
    showFilePreviewDialog,
    showVideoPreviewDialog,
    videoDownloadProgress,
    videoPlaybackError,
    videoPreviewUrl
  }
}
