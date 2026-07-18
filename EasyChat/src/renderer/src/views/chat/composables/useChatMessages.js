import { ref } from 'vue'
import { useChatMessageSender } from './useChatMessageSender'
import { useMessageScroll } from './useMessageScroll'
import { createMessageCollection } from './message/messageCollection'
import { createMessageHistoryController } from './message/messageHistoryController'
import { createMessageSubscriptionController } from './message/messageSubscriptionController'

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
  onResyncRequired,
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
      const receiveContactId = getReceiveContactId(message)
      const currentSession = currentChatSession.value || {}
      // Session identity is authoritative. Contact IDs are only a legacy fallback:
      // a direct contact and a group can otherwise share the same raw ID.
      const isCurrentSession = message.sessionId
        ? String(message.sessionId) === String(currentSession.sessionId)
        : String(receiveContactId) === String(currentSession.contactId) &&
          Number(message.contactType) === Number(currentSession.contactType)
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
    // The main process never exposes SQLite to the renderer.  Ask the page
    // owner to run the durable HTTP/IPC recovery path before refreshing UI.
    // A rejected recovery intentionally leaves the current local view intact.
    Promise.resolve(onResyncRequired?.(payload)).catch((error) => {
      console.error('incremental event recovery failed', error)
    })
    if (currentChatSession.value?.sessionId) {
      messageHistory.loadChatMessage({ refreshTail: true })
    }
  }

  // Every path (WS or HTTP compensation) reaches this point only after the
  // main process committed the SQLite transaction.  This prevents a renderer
  // refresh from observing an event whose cursor/processed marker was rolled
  // back and keeps V2 side effects consistent across reconnects.
  const applyPersistedV2Result = (payload = {}) => {
    handleReceiveMessages(
      Array.isArray(payload.messages) ? payload.messages : payload.savedMessages || [],
      Array.isArray(payload.sessions) ? payload.sessions : []
    )
    for (const update of Array.isArray(payload.mediaUpdates) ? payload.mediaUpdates : []) {
      handleFileUploadDone(update)
    }
    if (payload.stateChanged) loadChatSession()
  }

  const messageSubscriptions = createMessageSubscriptionController({
    applyPersistedV2Result,
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
    applyPersistedV2Result,
    toggleUploadPause,
    registerMessageListeners,
    retryFailedMessage,
    settleScrollToBottom
  }
}
