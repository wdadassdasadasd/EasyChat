import { validateFileSize } from '@/utils/FileLimits'
import { getSendFailureMessage, isRequestFailure } from '@/utils/RequestFailure'
import { createMediaUploadAckController } from './mediaUploadAckController'
import { createMediaUploadCoordinator } from './mediaUploadCoordinator'
import { createMediaUploadExecutor } from './mediaUploadExecutor'

/** Coordinates message creation and delegates upload execution and ACK state to focused owners. */
export const createMediaMessageTransferController = ({
  currentChatSession,
  lifecycle,
  messageList,
  proxy,
  updateMessageById
}) => {
  const blobUrlsToRevoke = new Set()
  const coordinator = createMediaUploadCoordinator({
    maxConcurrency: 3,
    onTaskError: (error) => console.error('upload message file failed', error)
  })
  const executor = createMediaUploadExecutor({
    coordinator,
    currentChatSession,
    lifecycle,
    messageList,
    proxy,
    updateMessageById
  })
  const acknowledger = createMediaUploadAckController({
    coordinator,
    lifecycle,
    messageList,
    proxy,
    updateMessageById
  })
  acknowledger.subscribe()

  const queueUpload = (message, file, cover) =>
    coordinator.enqueue(() => executor.uploadMessageFile(message, file, cover))

  const releaseSource = async (uploadSourceId) => {
    if (!uploadSourceId) return
    const request = window.api?.invokeReleaseUploadSource?.({ uploadSourceId })
    await Promise.resolve(request).catch((error) =>
      console.error('release unused upload source failed', error)
    )
  }

  const createLocalPreview = (message, file, cover, fileType) => {
    if (
      !message.localPreviewUrl &&
      (fileType === 0 || fileType === 1) &&
      typeof Blob !== 'undefined' &&
      file instanceof Blob
    ) {
      message.localPreviewUrl = URL.createObjectURL(file)
      blobUrlsToRevoke.add(message.localPreviewUrl)
    }
    if (fileType === 1 && cover && !message.localCoverUrl) {
      message.localCoverUrl = URL.createObjectURL(cover)
      blobUrlsToRevoke.add(message.localCoverUrl)
    }
  }

  const sendMediaMessage = async (
    { contactId, contactType, file, cover, uploadSourceId: registeredUploadSourceId },
    fileType,
    retryMessage = null
  ) => {
    const releaseUnusedSource = () =>
      retryMessage?.uploadSourceId ? undefined : releaseSource(registeredUploadSourceId)
    if (!file) return releaseUnusedSource()
    const sizeResult = validateFileSize(file, fileType)
    if (!sizeResult.valid) {
      await releaseUnusedSource()
      proxy.Message.warning(sizeResult.message)
      return
    }
    let uploadSourceId = retryMessage?.uploadSourceId || registeredUploadSourceId
    if (!uploadSourceId) {
      try {
        const result = await window.api.registerUploadSource(file)
        if (!result?.success || !result.uploadSourceId) {
          proxy.Message.warning(result?.error || '无法注册上传文件，请重新选择后再试。')
          return
        }
        uploadSourceId = result.uploadSourceId
      } catch (error) {
        console.error('register upload source failed', error)
        proxy.Message.warning('无法读取所选文件，请重新选择后再试。')
        return
      }
    }
    const sourceFile = typeof file.slice === 'function' ? file : { ...file, uploadSourceId }
    const localMessage =
      retryMessage ||
      lifecycle.createPendingMessage({
        contactId,
        contactType,
        messageType: 5,
        messageContent: file.name,
        file: sourceFile,
        fileType,
        filePath: '',
        uploadSourceId
      })
    Object.assign(localMessage, { uploadSourceId, retryFile: sourceFile, retryCover: cover })
    createLocalPreview(localMessage, file, cover, fileType)
    if (retryMessage) {
      if (!localMessage.clientMessageId) {
        localMessage.clientMessageId = lifecycle.createClientMessageId()
      }
      try {
        await lifecycle.markMessageSending(localMessage, {
          uploading: false,
          uploadAckReceived: false,
          uploadAckRevision: 0,
          uploadAckStatus: null,
          uploadSourceReleased: false
        })
      } catch (error) {
        console.error('save retry media message status failed', error)
        await lifecycle.markMessageFailed(
          localMessage,
          'Media retry failed. Local status could not be saved.'
        )
        return
      }
    } else {
      lifecycle.appendSentMessageIfMissing(localMessage)
      try {
        await lifecycle.persistPendingMessage(localMessage)
      } catch (error) {
        console.error('save pending media message failed', error)
        // The upload source is durable only after the pending message commits.
        // Without that row it cannot be recovered after restart, so retaining the
        // registry entry would leak an orphaned local file reference.
        const unpersistedUploadSourceId = localMessage.uploadSourceId
        delete localMessage.uploadSourceId
        await releaseSource(unpersistedUploadSourceId)
        await lifecycle.markMessageFailed(
          localMessage,
          'Media message could not be saved locally. Retry later.'
        )
        return
      }
    }
    const result = await proxy.Request({
      url: proxy.Api.sendMessage,
      params: {
        contactId,
        contactType,
        messageType: 5,
        messageContent: file.name,
        fileSize: file.size,
        fileName: file.name,
        fileType,
        clientMessageId: localMessage.clientMessageId
      },
      showLoading: false,
      returnError: true
    })
    if (!result || isRequestFailure(result)) {
      return lifecycle.markMessageFailed(
        localMessage,
        getSendFailureMessage(result, '媒体消息发送失败，请检查网络后重试。')
      )
    }
    const message = result.data
    if (!message?.messageId) {
      return lifecycle.markMessageFailed(
        localMessage,
        'Media message send failed. Missing message id.'
      )
    }
    message.uploadSourceId = uploadSourceId
    try {
      const serverMessage = await lifecycle.replaceLocalWithServerMessage(localMessage, message, {
        localPreviewUrl: localMessage.localPreviewUrl,
        localCoverUrl: localMessage.localCoverUrl,
        retryFile: sourceFile,
        retryCover: cover,
        uploading: true,
        uploadProgress: 0,
        uploadError: '',
        uploadCanceled: false,
        status: 2
      })
      queueUpload(serverMessage, sourceFile, cover)
    } catch (error) {
      lifecycle.markMessageLocalSyncFailed(localMessage, message, error, {
        recoveredStatus: 2,
        onRecovered: (recoveredMessage) => queueUpload(recoveredMessage, sourceFile, cover)
      })
    }
  }

  const retryMediaMessage = (message = {}) => {
    const retryFile =
      message.retryFile ||
      (message.uploadSourceId
        ? {
            uploadSourceId: message.uploadSourceId,
            name: message.fileName || message.messageContent,
            size: Number(message.fileSize || 0),
            type: ''
          }
        : null)
    if (!retryFile) {
      proxy.Message.warning('原文件来源已丢失，请重新选择文件后发送。')
      return
    }
    if (Number(message.messageId) > 0) {
      return lifecycle
        .markMessageSending(message, {
          uploading: true,
          uploadProgress: 0,
          uploadError: '',
          uploadCanceled: false,
          uploadAckReceived: false,
          uploadAckRevision: 0,
          uploadAckStatus: null,
          uploadSourceReleased: false
        })
        .then(() => queueUpload(message, retryFile, message.retryCover))
        .catch((error) => console.error('retry media upload failed', error))
    }
    return lifecycle.enqueueSendTask(() =>
      sendMediaMessage(
        {
          contactId: message.contactId,
          contactType: message.contactType,
          file: retryFile,
          cover: message.retryCover
        },
        message.fileType,
        message
      )
    )
  }

  const cleanup = () => {
    acknowledger.cleanup()
    coordinator.cleanup()
    blobUrlsToRevoke.forEach((url) => {
      try {
        URL.revokeObjectURL(url)
      } catch {
        /* URL may already be revoked. */
      }
    })
    blobUrlsToRevoke.clear()
  }

  return {
    cancelUploadMessage: acknowledger.cancelUploadMessage,
    cleanup,
    handleFileUploadDone: acknowledger.handleFileUploadDone,
    releaseRejectedMediaSource: acknowledger.releaseRejectedMediaSource,
    retryMediaMessage,
    sendMediaMessage,
    toggleUploadPause: acknowledger.toggleUploadPause
  }
}
