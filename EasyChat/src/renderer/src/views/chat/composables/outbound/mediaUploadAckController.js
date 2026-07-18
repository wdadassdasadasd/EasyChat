import { cancelMediaUpload } from '@/utils/MediaUploadTransport'

/** Owns upload task IPC, ACK authority and upload-source release retries. */
export const createMediaUploadAckController = ({
  coordinator,
  lifecycle,
  messageList,
  proxy,
  updateMessageById
}) => {
  let unsubscribeUploadTaskProgress = null
  const findMessage = (messageId) => messageList.value.find((item) => item.messageId == messageId)

  const releaseUploadSourceAfterAck = async (targetMessage, ackRevision, attempt = 0) => {
    if (
      targetMessage.uploadAckRevision !== ackRevision ||
      Number(targetMessage.uploadAckStatus) !== 1 ||
      targetMessage.uploadSourceReleased ||
      !targetMessage.uploadSourceId
    )
      return
    const request = window.api?.invokeReleaseUploadSource?.({
      uploadSourceId: targetMessage.uploadSourceId
    })
    const result = await Promise.resolve(request).catch((error) => {
      console.error('release acknowledged upload source failed', error)
      return null
    })
    if (result?.success === true) {
      targetMessage.uploadSourceReleased = true
      return
    }
    if (attempt < 2) {
      coordinator.scheduleRetry(
        () => releaseUploadSourceAfterAck(targetMessage, ackRevision, attempt + 1),
        1000 * (attempt + 1)
      )
    }
  }

  const handleFileUploadDone = async (message) => {
    const targetMessage = findMessage(message.messageId)
    if (!targetMessage) return
    const ackStatus = Number(message.status ?? 1)
    const ackSucceeded = ackStatus === 1
    const repeatedAck =
      targetMessage.uploadAckReceived && Number(targetMessage.uploadAckStatus) === ackStatus
    const ackError = message.error || message.msg || 'File processing failed. Please retry.'
    const ackRevision = Number(targetMessage.uploadAckRevision || 0) + 1
    Object.assign(targetMessage, {
      status: ackStatus,
      uploading: false,
      uploadError: ackSucceeded ? '' : ackError,
      uploadCanceled: false,
      uploadAwaitingAck: false,
      uploadWaitingNetwork: false,
      uploadAckReceived: true,
      uploadAckRevision: ackRevision,
      uploadAckStatus: ackStatus
    })
    const controller = coordinator.getController(targetMessage.messageId)
    coordinator.deleteController(targetMessage.messageId)
    controller?.abort()
    if (ackSucceeded) {
      targetMessage.uploadProgress = 100
      targetMessage.forceGet = Date.now()
    } else if (!repeatedAck) {
      proxy.Message.error(ackError)
    }
    await lifecycle.persistMessageStatus(targetMessage).catch((error) => {
      console.error('save acknowledged media status failed', error)
      proxy.Message.error('Media status was confirmed, but could not be saved locally.')
    })
    const acknowledgeRequest = window.api?.invokeAcknowledgeUploadTask?.({
      messageId: Number(targetMessage.messageId),
      succeeded: ackSucceeded,
      error: ackSucceeded ? '' : ackError
    })
    Promise.resolve(acknowledgeRequest).catch((error) =>
      console.error('acknowledge upload task failed', error)
    )
    if (
      targetMessage.uploadAckRevision === ackRevision &&
      ackSucceeded &&
      !targetMessage.uploadSourceReleased &&
      targetMessage.uploadSourceId
    ) {
      await releaseUploadSourceAfterAck(targetMessage, ackRevision)
    }
  }

  const cancelUploadMessage = (message = {}) => {
    if (!message.messageId || (!message.uploading && !message.uploadPaused && !message.uploadWaitingNetwork)) return
    coordinator.getController(message.messageId)?.abort()
    Object.assign(message, { uploadCanceled: true, uploadPaused: false })
    updateMessageById?.(message.messageId, { uploadCanceled: true })
    const cancel = window.api?.invokeCancelUploadTask
      ? window.api.invokeCancelUploadTask({ messageId: Number(message.messageId) })
      : cancelMediaUpload({ messageId: message.messageId, proxy })
    Promise.resolve(cancel).catch((error) => console.error('cancel media upload failed', error))
    lifecycle
      .markMessageFailed(message, '文件上传已取消。')
      .catch((error) => console.error('save canceled media status failed', error))
  }

  const toggleUploadPause = (message = {}) => {
    if (!message.messageId || typeof window.api?.invokePauseUploadTask !== 'function') return
    const paused = Boolean(message.uploadPaused)
    const request = paused
      ? window.api.invokeResumeUploadTask({ messageId: Number(message.messageId) })
      : window.api.invokePauseUploadTask({ messageId: Number(message.messageId) })
    request
      .then((result) => {
        if (!result?.success) throw new Error(result?.error || '上传任务状态切换失败')
        const patch = { uploading: paused, uploadPaused: !paused, uploadError: '' }
        Object.assign(message, patch)
        updateMessageById?.(message.messageId, patch)
      })
      .catch((error) => {
        console.error('toggle upload pause failed', error)
        proxy.Message.error('无法切换上传状态，请稍后重试。')
      })
  }

  const handleUploadTaskProgress = (payload = {}) => {
    const message = findMessage(payload.messageId)
    if (!message || message.uploadAckReceived) return
    const progress = Math.min(99, Math.max(0, Number(payload.progress) || 0))
    if (payload.state === 'succeeded') {
      const patch = {
        status: 1,
        uploading: false,
        uploadProgress: 100,
        uploadError: '',
        uploadCanceled: false,
        uploadPaused: false,
        uploadAwaitingAck: false,
        uploadWaitingNetwork: false
      }
      Object.assign(message, patch)
      updateMessageById?.(message.messageId, patch)
      lifecycle.persistMessageStatus(message).catch((error) => {
        console.error('save completed upload task status failed', error)
      })
      return
    }
    if (payload.state === 'failed') {
      message.uploadAwaitingAck = false
      message.uploadWaitingNetwork = false
      lifecycle
        .markMessageFailed(message, payload.error || '文件上传失败，请重试。')
        .catch((error) => console.error('save failed upload task status failed', error))
      return
    }
    if (payload.state === 'canceled') {
      message.uploadAwaitingAck = false
      message.uploadWaitingNetwork = false
      lifecycle
        .markMessageFailed(message, '文件上传已取消。')
        .catch((error) => console.error('save canceled media status failed', error))
      return
    }
    if (payload.state === 'awaiting_ack') {
      const patch = {
        status: 2,
        uploading: false,
        uploadProgress: 99,
        uploadError: '文件已上传，等待服务端确认。',
        uploadCanceled: false,
        uploadPaused: false,
        uploadAwaitingAck: true,
        uploadWaitingNetwork: false
      }
      Object.assign(message, patch)
      updateMessageById?.(message.messageId, patch)
      return
    }
    if (payload.state === 'waiting_network') {
      const patch = {
        status: 2,
        uploading: false,
        uploadProgress: progress,
        uploadError: '文件服务不可达，等待网络恢复。',
        uploadCanceled: false,
        uploadPaused: false,
        uploadAwaitingAck: false,
        uploadWaitingNetwork: true
      }
      Object.assign(message, patch)
      updateMessageById?.(message.messageId, patch)
      return
    }
    const paused = payload.state === 'paused'
    const patch = {
      status: 2,
      uploading: !paused,
      uploadProgress: progress,
      uploadError: paused ? '上传已暂停。' : '',
      uploadCanceled: false,
      uploadPaused: paused,
      uploadAwaitingAck: false,
      uploadWaitingNetwork: false
    }
    Object.assign(message, patch)
    updateMessageById?.(message.messageId, patch)
  }

  const subscribe = () => {
    unsubscribeUploadTaskProgress?.()
    unsubscribeUploadTaskProgress =
      window.api?.onUploadTaskProgress?.(handleUploadTaskProgress) || null
  }
  const releaseRejectedMediaSource = (payload = {}) => {
    if (!payload.uploadSourceId) return
    const request = window.api?.invokeReleaseUploadSource?.({
      uploadSourceId: payload.uploadSourceId
    })
    Promise.resolve(request).catch((error) =>
      console.error('release rejected upload source failed', error)
    )
  }
  const cleanup = () => {
    unsubscribeUploadTaskProgress?.()
    unsubscribeUploadTaskProgress = null
  }

  return {
    cancelUploadMessage,
    cleanup,
    handleFileUploadDone,
    releaseRejectedMediaSource,
    subscribe,
    toggleUploadPause
  }
}
