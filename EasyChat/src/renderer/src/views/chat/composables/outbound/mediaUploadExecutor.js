import { validateFileSize } from '@/utils/FileLimits'
import { uploadMediaFile } from '@/utils/MediaUploadTransport'
import { getUploadFailureMessage, isRequestFailure } from '@/utils/RequestFailure'

/** Executes a persisted media upload without owning ACK reconciliation. */
export const createMediaUploadExecutor = ({
  coordinator,
  currentChatSession,
  lifecycle,
  messageList,
  proxy,
  updateMessageById
}) => {
  const getLatestMessage = (messageId) =>
    messageList.value.find((item) => item.messageId == messageId)

  const uploadMessageFile = async (message, file, cover) => {
    const sizeResult = validateFileSize(file, message.fileType)
    if (!sizeResult.valid) return lifecycle.markMessageFailed(message, sizeResult.message)
    if (message.uploadSourceId && typeof window.api?.invokeEnqueueUploadTask === 'function') {
      let coverSourceId = message.coverSourceId
      let registeredCoverSourceId = ''
      if (cover && !coverSourceId && typeof window.api?.registerUploadCover !== 'function') {
        return lifecycle.markMessageFailed(
          message,
          '当前客户端不支持持久化上传封面，请更新后重试。'
        )
      }
      if (cover && !coverSourceId) {
        try {
          const result = await window.api.registerUploadCover(cover)
          if (!result?.success || !result.coverSourceId) {
            return lifecycle.markMessageFailed(message, result?.error || '无法保存上传封面。')
          }
          coverSourceId = result.coverSourceId
          registeredCoverSourceId = coverSourceId
          message.coverSourceId = coverSourceId
        } catch (error) {
          console.error('register upload cover failed', error)
          return lifecycle.markMessageFailed(message, '无法保存上传封面。')
        }
      }
      updateMessageById?.(message.messageId, {
        status: 2,
        uploading: true,
        uploadProgress: Number(message.uploadProgress || 0),
        uploadError: '',
        uploadCanceled: false
      })
      let taskResult
      try {
        taskResult = await window.api.invokeEnqueueUploadTask({
          messageId: Number(message.messageId),
          uploadSourceId: message.uploadSourceId,
          coverSourceId,
          fileName: message.fileName || file?.name || message.messageContent,
          fileSize: Number(message.fileSize || file?.size || 0),
          fileType: Number(message.fileType)
        })
      } catch (error) {
        taskResult = { success: false, error: error?.message || '无法创建文件上传任务。' }
      }
      if (!taskResult?.success) {
        const failedUploadSourceId = message.uploadSourceId
        if (registeredCoverSourceId) {
          window.api
            .invokeReleaseUploadCover?.({ coverSourceId: registeredCoverSourceId })
            .catch(() => {})
          delete message.coverSourceId
        }
        window.api
          .invokeReleaseUploadSource?.({ uploadSourceId: failedUploadSourceId })
          .catch(() => {})
        delete message.uploadSourceId
        await lifecycle.markMessageFailed(message, taskResult?.error || '无法创建文件上传任务。')
      }
      return
    }

    // Legacy renderer-managed uploads still depend on the selected session.
    const activeSessionId = currentChatSession.value?.sessionId
    if (activeSessionId && message.sessionId && activeSessionId !== message.sessionId) {
      return lifecycle.markMessageFailed(message, 'Session changed during upload. Please retry.')
    }

    const controller = new AbortController()
    const uploadKey = String(message.messageId)
    coordinator.setController(uploadKey, controller)
    const isCurrentUpload = () => coordinator.isCurrentController(uploadKey, controller)
    const updateUploadProgress = (progress) => {
      if (!isCurrentUpload() || getLatestMessage(message.messageId)?.uploadAckReceived) return
      const patch = {
        status: 2,
        uploading: true,
        uploadProgress: Math.min(99, Math.max(0, Number(progress) || 0)),
        uploadError: '',
        uploadCanceled: false
      }
      Object.assign(message, patch)
      updateMessageById?.(message.messageId, patch)
    }
    updateUploadProgress(message.uploadProgress || 0)
    let uploadCover = cover
    if (!uploadCover && message.fileType === 1 && message.uploadSourceId) {
      const request = window.api?.invokeGenerateUploadSourceThumbnail?.({
        uploadSourceId: message.uploadSourceId
      })
      const thumbnail = await Promise.resolve(request).catch(() => null)
      if (thumbnail?.success && thumbnail.arrayBuffer) {
        uploadCover = new Blob([thumbnail.arrayBuffer], { type: 'image/jpeg' })
      }
    }
    const result = await uploadMediaFile({
      cover: uploadCover,
      file,
      fileType: message.fileType,
      message,
      onProgress: updateUploadProgress,
      proxy,
      signal: controller.signal
    })
    if (!isCurrentUpload()) return
    coordinator.deleteController(uploadKey)
    const latestMessage = getLatestMessage(message.messageId)
    if (latestMessage?.uploadAckReceived) return
    if (!result || isRequestFailure(result)) {
      const canceled = result?.kind === 'canceled'
      Object.assign(message, { uploadCanceled: canceled })
      updateMessageById?.(message.messageId, { uploadCanceled: canceled })
      return lifecycle.markMessageFailed(message, getUploadFailureMessage(result, canceled), {
        shouldReportError: () => !getLatestMessage(message.messageId)?.uploadAckReceived
      })
    }
    const successfulMessage = latestMessage || message
    const patch = {
      uploading: false,
      status: 1,
      uploadProgress: 100,
      uploadError: '',
      uploadCanceled: false
    }
    Object.assign(successfulMessage, patch)
    updateMessageById?.(message.messageId, patch)
    await lifecycle.persistMessageStatus(successfulMessage).catch((error) => {
      console.error('save uploaded media status failed', error)
      proxy.Message.error('File uploaded, but local message status could not be saved.')
    })
  }

  return { uploadMessageFile }
}
