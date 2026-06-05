import { ref } from 'vue'
import Utils from '@/utils/Utils'

/**
 * 聊天文件和视频接收流程的管理入口。
 *
 * 负责预览弹窗状态、下载进度、本地视频兜底、对象 URL 生命周期，
 * 以及普通下载和系统播放器打开等动作，避免这些逻辑堆在 Chat.vue 中。
 */
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
  let videoPreviewBlob = null
  let ownsVideoPreviewUrl = false

  const getVideoMimeType = (fileName = '') => {
    // 后端下载通常只返回 blob，前端按文件名补 MIME，帮助 video 标签识别格式。
    const suffix = String(fileName).split('.').pop()?.toLowerCase()
    const mimeMap = {
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      mkv: 'video/x-matroska',
      avi: 'video/x-msvideo',
      rmvb: 'application/vnd.rn-realmedia-vbr'
    }
    return mimeMap[suffix] || 'video/mp4'
  }

  const revokeVideoPreviewUrl = () => {
    // 只释放当前模块创建的对象 URL，发送中的本地预览 URL 由消息模块负责释放。
    if (videoPreviewUrl.value && ownsVideoPreviewUrl) {
      URL.revokeObjectURL(videoPreviewUrl.value)
    }
    videoPreviewUrl.value = ''
    videoPreviewBlob = null
    videoDownloadProgress.value = 0
    videoPlaybackError.value = ''
    ownsVideoPreviewUrl = false
  }

  const setVideoDownloadProgress = (event) => {
    if (!event?.total) {
      return
    }
    const percent = Math.round((event.loaded / event.total) * 100)
    videoDownloadProgress.value = Math.min(99, Math.max(0, percent))
  }

  const parseBlobError = async (blob) => {
    // 下载接口失败时也可能返回 JSON blob，这里尝试读出错误信息再决定是否回退。
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
    // 自己刚发送的视频优先从本地路径读取，避免服务器文件还没准备好时无法预览。
    const filePath = message?.filePath
    if (!filePath || !window.electron?.ipcRenderer?.invoke) {
      return null
    }

    const result = await window.electron.ipcRenderer.invoke('readLocalVideoFile', { filePath })
    const buffer = result?.arrayBuffer || result?.buffer
    if (!result?.success || !buffer) {
      return null
    }

    videoDownloadProgress.value = 100
    return new Blob([buffer], { type: getVideoMimeType(Utils.getFileMessageName(message)) })
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
    if (!Utils.isFileMessage(message) || message.status == 0) {
      return false
    }

    // 普通文件接收直接触发浏览器下载，不写入聊天消息列表状态。
    const blob = await proxy.Request({
      url: proxy.Api.downloadFile,
      params: {
        fileId: message.messageId,
        showCover: false
      },
      responseType: 'blob',
      showLoading: false
    })

    if (!blob) {
      return false
    }

    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = Utils.getFileMessageName(message)
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => {
      URL.revokeObjectURL(objectUrl)
    }, 1000)
    return true
  }

  const fetchVideoBlob = async (message, { showError = true, allowLocalFallback = true } = {}) => {
    // 视频预览和下载共用同一下载流程，失败时按需尝试本地文件回退。
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
      downloadProgressCallback: setVideoDownloadProgress
    })
    if (!blob) {
      if (allowLocalFallback) {
        const localBlob = await readLocalVideoBlob(message)
        if (localBlob) {
          return localBlob
        }
      }
      videoPlaybackError.value = '视频下载失败，请检查网络后重试'
      if (showError) {
        proxy.Message.error('视频下载失败')
      }
      return null
    }
    if (!blob.size) {
      videoPlaybackError.value = '视频文件为空，无法预览'
      if (showError) {
        proxy.Message.error('视频文件为空')
      }
      return null
    }
    const errorText = await parseBlobError(blob)
    if (errorText) {
      console.error('video download failed:', errorText)
      if (allowLocalFallback) {
        const localBlob = await readLocalVideoBlob(message)
        if (localBlob) {
          return localBlob
        }
      }
      videoPlaybackError.value = '视频下载失败，后端未返回有效视频文件'
      if (showError) {
        proxy.Message.error('视频下载失败')
      }
      return null
    }
    if (blob.type?.includes('json')) {
      const text = await blob.text()
      console.error('video download failed:', text)
      proxy.Message.error('视频下载失败')
      return null
    }
    videoDownloadProgress.value = 100
    return new Blob([blob], { type: getVideoMimeType(Utils.getFileMessageName(message)) })
  }

  const ensureSelectedVideoBlob = async () => {
    if (!selectedVideoMessage.value) {
      return null
    }
    if (videoPreviewBlob) {
      return videoPreviewBlob
    }
    isLoadingVideo.value = true
    const blob = await fetchVideoBlob(selectedVideoMessage.value)
    isLoadingVideo.value = false
    if (blob) {
      videoPreviewBlob = blob
    }
    return blob
  }

  const openVideoPreviewDialog = async (message) => {
    if (!Utils.isVideoMessage(message) || Utils.isVideoPreviewDisabled(message)) {
      return
    }
    // 先打开弹窗再加载视频，保证大文件下载期间用户能看到 loading 和进度。
    selectedVideoMessage.value = message
    showVideoPreviewDialog.value = true
    revokeVideoPreviewUrl()

    if (message.localPreviewUrl) {
      videoPreviewUrl.value = message.localPreviewUrl
      ownsVideoPreviewUrl = false
      // 清除上一个视频下载的 blob 缓存，防止 ensureSelectedVideoBlob 返回过期数据。
      videoPreviewBlob = null
      return
    }

    isLoadingVideo.value = true
    const blob = await fetchVideoBlob(message)
    isLoadingVideo.value = false
    if (!blob || selectedVideoMessage.value?.messageId != message.messageId) {
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

    // 系统播放器优先打开本地原文件；没有本地路径时再下载到临时文件。
    if (selectedVideoMessage.value.filePath) {
      const result = await window.electron.ipcRenderer.invoke('openLocalVideoFile', {
        filePath: selectedVideoMessage.value.filePath
      })
      if (result?.success) {
        return
      }
    }

    const blob = await ensureSelectedVideoBlob()
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

    const blob = await ensureSelectedVideoBlob()
    if (!blob) {
      return
    }
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = Utils.getFileMessageName(selectedVideoMessage.value)
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => {
      URL.revokeObjectURL(objectUrl)
    }, 1000)
  }

  const receiveSelectedFileMessage = async () => {
    if (!selectedFileMessage.value || Utils.isFileReceiveDisabled(selectedFileMessage.value)) {
      return
    }

    isReceivingFile.value = true
    const isDownloaded = await downloadFileMessage(selectedFileMessage.value)
    isReceivingFile.value = false
    if (isDownloaded) {
      showFilePreviewDialog.value = false
    }
  }

  return {
    closeFilePreviewDialog,
    closeVideoPreviewDialog,
    downloadSelectedVideoMessage,
    isReceivingFile,
    isLoadingVideo,
    markVideoPlaybackError,
    openFilePreviewDialog,
    openSelectedVideoExternal,
    openVideoPreviewDialog,
    receiveSelectedFileMessage,
    selectedFileMessage,
    selectedVideoMessage,
    showFilePreviewDialog,
    showVideoPreviewDialog,
    videoDownloadProgress,
    videoPlaybackError,
    videoPreviewUrl
  }
}
