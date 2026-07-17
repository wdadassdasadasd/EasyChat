import { ref } from 'vue'
import { CHAT_CONSTANTS } from '@/utils/ChatConstants'
import { getApiUrl } from '@/utils/Request'
import Utils from '@/utils/Utils'

const emptyDownloadState = () => ({ status: '', progress: 0, path: '', error: '' })

/** Owns signed download access, message-scoped download state and desktop file actions. */
export const createFileAccessController = ({ proxy }) => {
  const downloadStates = ref({})
  const isReceivingFile = ref(false)
  const activeDownloadKeys = new Set()

  const getDownloadKey = (message) => String(message?.messageId || '')
  const getDownloadState = (message) =>
    downloadStates.value[getDownloadKey(message)] || emptyDownloadState()

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

  const createDownloadUrl = async (message, { download = false, showCover = false } = {}) => {
    const result = await proxy.Request({
      url: proxy.Api.createDownloadToken,
      params: { fileId: message.messageId, showCover, download },
      showLoading: false,
      showError: false
    })
    const streamUrl = result?.data?.streamUrl
    if (!streamUrl) return ''
    return getApiUrl(streamUrl) || ''
  }

  const downloadFileMessage = async (message) => {
    if ((!Utils.isFileMessage(message) && !Utils.isVideoMessage(message)) || message.status == 0) {
      return false
    }
    const downloadKey = getDownloadKey(message)
    if (getDownloadState(message).status === 'downloading' || activeDownloadKeys.has(downloadKey)) {
      return false
    }

    const declaredSize = Number(message.fileSize || 0)
    if (declaredSize > CHAT_CONSTANTS.MAX_DOWNLOAD_SIZE) {
      const error = `File is too large. Limit: ${Utils.formatFileSize(CHAT_CONSTANTS.MAX_DOWNLOAD_SIZE)}`
      patchDownloadState(message, { status: 'failed', progress: 0, error })
      proxy.Message.error(error)
      return false
    }

    activeDownloadKeys.add(downloadKey)
    patchDownloadState(message, { status: 'downloading', progress: 0, error: '', path: '' })
    isReceivingFile.value = true
    try {
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
          url,
          fileName: Utils.getFileMessageName(message),
          fileSize: declaredSize,
          maxSize: CHAT_CONSTANTS.MAX_DOWNLOAD_SIZE,
          messageId: message.messageId
        })
      } finally {
        unsubscribeProgress?.()
      }
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
    } finally {
      activeDownloadKeys.delete(downloadKey)
      isReceivingFile.value = false
    }
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
    downloadFileMessage,
    getDownloadState,
    isReceivingFile,
    openDownloadedFile,
    showDownloadedFileInFolder
  }
}
