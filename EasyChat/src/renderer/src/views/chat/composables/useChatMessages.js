import { ref } from 'vue'
import { useChatMessageSender } from './useChatMessageSender'
import { useMessageScroll } from './useMessageScroll'
import { createMessageCollection } from './messageCollection'
import { createMessageHistoryController } from './messageHistoryController'
import { createMessageSubscriptionController } from './messageSubscriptionController'

/**
 * 当前聊天窗口的消息列表总控。
 *
 * 负责历史分页、实时收消息、消息去重、滚动位置恢复，以及接入发送链路。
 * 会话列表状态由 useChatSessions 管理，发送落库细节由 useChatMessageSender 管理。
 */
export const useChatMessages = ({
  currentChatSession,
  currentUserId,
  loadChatSession,
  markSessionRead,
  messageListRef,
  patchChatSessions,
  proxy
}) => {
  const messageList = ref([])
  const messageLoadingMore = ref(false)
  const {
    appendMessageIfMissing,
    clear: clearMessageCollection,
    getOldestServerMessageId,
    prependMessagesIfMissing,
    replaceMessageById,
    replaceMessageList,
    updateMessageById
  } = createMessageCollection(messageList)
  // 首屏加载需要自动贴底；向上翻页则要保持用户当前阅读位置。
  // 使用 loadSeq 绑定，防止快速切换会话时旧回包错误消费贴底标志。
  const {
    cleanupMessageScroll,
    clearInitialBottomLock,
    getActiveMessageLoadSeq,
    getMessagePanel,
    getMessagePanelRenderSeq,
    isNearMessageBottom,
    markMessagePanelReady,
    messagePanelPhase,
    scrollMessageToBottom,
    settleScrollToBottom,
    showMessagePanelAtBottom,
    startMessagePanelRender
  } = useMessageScroll({ messageListRef })

  const getReceiveContactId = (message = {}) => {
    if (message.contactType == 1) {
      return message.contactId
    }
    return message.sendUserId == currentUserId?.value ? message.contactId : message.sendUserId
  }

  const {
    cancelUploadMessage,
    cleanupUploadControllers,
    handleFileUploadDone,
    onSendChatMessage,
    onSendFileMessage,
    onSendImageMessage,
    onSendVideoMessage,
    retryFailedMessage,
    toggleUploadPause
  } = useChatMessageSender({
    appendMessageIfMissing,
    currentChatSession,
    currentUserId,
    isNearMessageBottom,
    messageList,
    patchChatSessions,
    proxy,
    replaceMessageById,
    updateMessageById,
    scrollMessageToBottom
  })

  const messageHistory = createMessageHistoryController({
    collection: {
      appendMessageIfMissing,
      clear: clearMessageCollection,
      getOldestServerMessageId,
      prependMessagesIfMissing,
      replaceMessageList
    },
    currentChatSession,
    markSessionRead,
    messageList,
    messageListRef,
    messageLoadingMore,
    proxy,
    scroll: {
      getActiveMessageLoadSeq,
      getMessagePanel,
      getMessagePanelRenderSeq,
      isNearMessageBottom,
      markMessagePanelReady,
      scrollMessageToBottom,
      showMessagePanelAtBottom,
      startMessagePanelRender
    }
  })

  const handleReceiveMessages = (messages = [], sessions = []) => {
    const readContactIds = new Set()
    let appended = false
    const shouldStickToBottom = isNearMessageBottom()

    messages.forEach((message) => {
      if (message.messageType == 6) {
        handleFileUploadDone(message)
        return
      }

      const receiveContactId = getReceiveContactId(message)
      const isCurrentSession =
        message.sessionId == currentChatSession.value.sessionId ||
        receiveContactId == currentChatSession.value.contactId
      if (!isCurrentSession) {
        return
      }

      readContactIds.add(receiveContactId)
      appended = appendMessageIfMissing(message) || appended
    })

    readContactIds.forEach((contactId) => {
      markSessionRead?.(contactId)
    })

    patchChatSessions(sessions, {
      readContactIds: Array.from(readContactIds)
    })

    if (appended) {
      scrollMessageToBottom({ force: shouldStickToBottom })
    }
  }

  const recoverReceiveResync = (payload = {}) => {
    patchChatSessions(payload.sessions || [])
    loadChatSession?.()
    if (currentChatSession.value?.sessionId) {
      messageHistory.loadChatMessage({ refreshTail: true })
    }
  }

  const messageSubscriptions = createMessageSubscriptionController({
    handleFileUploadDone,
    handleReceiveMessages,
    loadChatSession,
    onLoadChatMessageCallback: messageHistory.onLoadChatMessageCallback,
    proxy,
    recoverReceiveResync
  })
  const registerMessageListeners = messageSubscriptions.register
  const removeMessageListeners = messageSubscriptions.remove

  const cleanupChatMessages = () => {
    removeMessageListeners()
    cleanupMessageScroll()
    cleanupUploadControllers()
    messageHistory.cleanup()
  }

  return {
    chatSessionClickHandler: messageHistory.chatSessionClickHandler,
    cleanupChatMessages,
    clearCurrentMessages: messageHistory.clearCurrentMessages,
    clearInitialBottomLock,
    locateChatMessage: messageHistory.locateChatMessage,
    loadChatMessage: messageHistory.loadChatMessage,
    loadMoreChatMessage: messageHistory.loadMoreChatMessage,
    messageList,
    messageLoadingMore,
    messagePanelPhase,
    onSendChatMessage,
    onSendFileMessage,
    onSendImageMessage,
    onSendVideoMessage,
    cancelUploadMessage,
    toggleUploadPause,
    registerMessageListeners,
    retryFailedMessage,
    settleScrollToBottom
  }
}
