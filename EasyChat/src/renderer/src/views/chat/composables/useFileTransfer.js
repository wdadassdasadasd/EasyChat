import { computed, ref } from 'vue'
import Utils from '@/utils/Utils'
import { createFileAccessController } from './fileTransfer/fileAccessController'
import { createVideoPreviewController } from './fileTransfer/videoPreviewController'

/** Page-facing facade for file dialog state, download access and video preview. */
export const useFileTransfer = ({ proxy }) => {
  const selectedFileMessage = ref(null)
  const showFilePreviewDialog = ref(false)
  const fileAccess = createFileAccessController({ proxy })
  const videoPreview = createVideoPreviewController({ fileAccess, proxy })

  const selectedFileDownloadState = computed(() =>
    fileAccess.getDownloadState(selectedFileMessage.value)
  )
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
    fileAccess.isReceivingFile.value = false
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
  const cleanupFileTransfer = () => {
    closeFilePreviewDialog()
    videoPreview.cleanup()
  }

  return {
    cleanupFileTransfer,
    closeFilePreviewDialog,
    closeVideoPreviewDialog: videoPreview.closeVideoPreviewDialog,
    downloadSelectedVideoMessage,
    isReceivingFile: fileAccess.isReceivingFile,
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
