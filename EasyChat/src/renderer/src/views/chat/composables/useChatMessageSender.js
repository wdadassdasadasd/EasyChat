import { CHAT_CONSTANTS } from '@/utils/ChatConstants'
import { getSendFailureMessage, isRequestFailure } from '@/utils/RequestFailure'
import { createMediaMessageTransferController } from './outbound/mediaMessageTransferController'
import { createOutboundMessageLifecycle } from './outbound/outboundMessageLifecycle'

/**
 * 出站消息发送链路的执行入口。
 *
 * 只组装文本发送、出站生命周期和媒体传输控制器；不直接持有媒体副作用。
 */

export const useChatMessageSender = (dependencies) => {
  const { proxy } = dependencies
  const lifecycle = createOutboundMessageLifecycle(dependencies)
  const media = createMediaMessageTransferController({
    ...dependencies,
    lifecycle
  })

  const sendChatMessage = async (
    { contactId, contactType, messageContent },
    retryMessage = null
  ) => {
    if (typeof messageContent !== 'string' || !messageContent.trim()) {
      proxy.Message.warning('不能发送空消息。')
      return
    }
    if (messageContent.length > CHAT_CONSTANTS.MAX_MESSAGE_LENGTH) {
      proxy.Message.warning(`消息内容不能超过 ${CHAT_CONSTANTS.MAX_MESSAGE_LENGTH} 个字符。`)
      return
    }
    const localMessage =
      retryMessage ||
      lifecycle.createPendingMessage({
        contactId,
        contactType,
        messageType: 2,
        messageContent
      })
    if (retryMessage) {
      try {
        await lifecycle.markMessageSending(localMessage)
      } catch (error) {
        console.error('save retry text message status failed', error)
        await lifecycle.markMessageFailed(
          localMessage,
          'Message retry failed. Local status could not be saved.'
        )
        return
      }
    } else {
      lifecycle.appendSentMessageIfMissing(localMessage)
      try {
        await lifecycle.persistPendingMessage(localMessage)
      } catch (error) {
        console.error('save pending text message failed', error)
        await lifecycle.markMessageFailed(
          localMessage,
          'Message could not be saved locally. Retry later.'
        )
        return
      }
    }
    const result = await proxy.Request({
      url: proxy.Api.sendMessage,
      params: { contactId, contactType, messageType: 2, messageContent },
      showLoading: false,
      returnError: true
    })
    if (!result || isRequestFailure(result)) {
      await lifecycle.markMessageFailed(localMessage, getSendFailureMessage(result))
      return
    }
    try {
      await lifecycle.replaceLocalWithServerMessage(localMessage, result.data)
    } catch (error) {
      lifecycle.markMessageLocalSyncFailed(localMessage, result.data, error)
    }
  }

  const onSendChatMessage = (payload) => lifecycle.enqueueSendTask(() => sendChatMessage(payload))
  const onSendImageMessage = (payload) =>
    lifecycle.enqueueSendTask(() => media.sendMediaMessage(payload, 0), {
      onRejected: () => media.releaseRejectedMediaSource(payload)
    })
  const onSendFileMessage = (payload) =>
    lifecycle.enqueueSendTask(() => media.sendMediaMessage(payload, 2), {
      onRejected: () => media.releaseRejectedMediaSource(payload)
    })
  const onSendVideoMessage = (payload) =>
    lifecycle.enqueueSendTask(() => media.sendMediaMessage(payload, 1), {
      onRejected: () => media.releaseRejectedMediaSource(payload)
    })
  const retryFailedMessage = (message = {}) => {
    if (message.status != 0) return
    if (message.messageType == 5) return media.retryMediaMessage(message)
    return lifecycle.enqueueSendTask(() =>
      sendChatMessage(
        {
          contactId: message.contactId,
          contactType: message.contactType,
          messageContent: message.messageContent
        },
        message
      )
    )
  }

  return {
    cancelUploadMessage: media.cancelUploadMessage,
    cleanupUploadControllers: () => {
      media.cleanup()
      lifecycle.cleanup()
    },
    handleFileUploadDone: media.handleFileUploadDone,
    onSendChatMessage,
    onSendFileMessage,
    onSendImageMessage,
    onSendVideoMessage,
    retryFailedMessage,
    toggleUploadPause: media.toggleUploadPause
  }
}
