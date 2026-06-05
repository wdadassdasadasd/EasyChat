import { nextTick, ref } from 'vue'
import { useChatMessageSender } from './useChatMessageSender'
import { useMessageScroll } from './useMessageScroll'

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
  const messageCountInfo = {
    noData: false
  }
  const messageList = ref([])
  const messageLoadingMore = ref(false)
  const messageIdSet = new Set()
  // 首屏加载需要自动贴底；向上翻页则要保持用户当前阅读位置。
  // 使用 loadSeq 绑定，防止快速切换会话时旧回包错误消费贴底标志。
  let shouldScrollToBottomAfterLoad = false
  let shouldScrollToBottomLoadSeq = null
  let pendingPrependScrollState = null

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

  const resetMessageCountInfo = () => {
    messageCountInfo.noData = false
  }

  const getReceiveContactId = (message = {}) => {
    if (message.contactType == 1) {
      return message.contactId
    }
    return message.sendUserId == currentUserId?.value ? message.contactId : message.sendUserId
  }

  const rebuildMessageIdSet = () => {
    messageIdSet.clear()
    messageList.value.forEach((message) => {
      if (message.messageId != null) {
        messageIdSet.add(String(message.messageId))
      }
    })
  }

  const appendMessageIfMissing = (message) => {
    if (!message) {
      return false
    }
    const messageId = message.messageId != null ? String(message.messageId) : ''
    if (messageId && messageIdSet.has(messageId)) {
      return false
    }
    messageList.value.push(message)
    if (messageId) {
      messageIdSet.add(messageId)
    }
    return true
  }

  const updateMessageById = (messageId, patch = {}) => {
    const index = messageList.value.findIndex((message) => {
      return String(message?.messageId) === String(messageId)
    })
    if (index === -1) {
      return false
    }
    messageList.value[index] = Object.assign({}, messageList.value[index], patch)
    return true
  }

  const replaceMessageById = (messageId, nextMessage) => {
    const index = messageList.value.findIndex((message) => {
      return String(message?.messageId) === String(messageId)
    })
    if (index === -1 || !nextMessage) {
      return false
    }
    const previousMessage = messageList.value[index]
    if (
      previousMessage?.localPreviewUrl &&
      previousMessage.localPreviewUrl !== nextMessage.localPreviewUrl
    ) {
      URL.revokeObjectURL(previousMessage.localPreviewUrl)
    }
    if (previousMessage?.messageId != null) {
      messageIdSet.delete(String(previousMessage.messageId))
    }
    messageList.value[index] = nextMessage
    if (nextMessage.messageId != null) {
      messageIdSet.add(String(nextMessage.messageId))
    }
    return true
  }

  const prependMessagesIfMissing = (messages = []) => {
    const prependList = []
    messages.forEach((message) => {
      const messageId = message?.messageId != null ? String(message.messageId) : ''
      if (messageId && messageIdSet.has(messageId)) {
        return
      }
      prependList.push(message)
      if (messageId) {
        messageIdSet.add(messageId)
      }
    })
    if (prependList.length > 0) {
      messageList.value = prependList.concat(messageList.value)
    }
    return prependList.length
  }

  const replaceMessageList = (messages = []) => {
    messageList.value.forEach((message) => {
      if (message.localPreviewUrl) {
        URL.revokeObjectURL(message.localPreviewUrl)
      }
    })
    messageList.value = messages
    rebuildMessageIdSet()
  }

  const getOldestMessageId = () => {
    const messageIds = messageList.value
      .map((message) => Number(message.messageId || 0))
      .filter((messageId) => messageId > 0)
    if (messageIds.length === 0) {
      return null
    }
    return Math.min(...messageIds)
  }

  const scrollToMessageId = async (messageId) => {
    if (!messageId) {
      return false
    }
    await nextTick()
    await new Promise((resolve) => {
      window.requestAnimationFrame(resolve)
    })
    const target = document.getElementById(`message${messageId}`)
    if (!target) {
      return false
    }
    target.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    })
    return true
  }

  const {
    handleFileUploadDone,
    onSendChatMessage,
    onSendFileMessage,
    onSendImageMessage,
    onSendVideoMessage,
    retryFailedMessage
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

  const revokeMessagePreviewUrls = (messages = []) => {
    messages.forEach((message) => {
      if (message?.localPreviewUrl) {
        URL.revokeObjectURL(message.localPreviewUrl)
      }
    })
  }

  const resetVirtualHeightMap = () => {
    messageListRef?.value?.resetHeightMap?.()
  }

  const clearCurrentMessages = () => {
    // 清空当前会话后主动标记无更多数据，避免滚动到顶部又触发旧消息分页加载。
    startMessagePanelRender()
    revokeMessagePreviewUrls(messageList.value)
    messageList.value = []
    messageIdSet.clear()
    messageLoadingMore.value = false
    pendingPrependScrollState = null
    shouldScrollToBottomAfterLoad = false
    shouldScrollToBottomLoadSeq = null
    resetMessageCountInfo()
    messageCountInfo.noData = true
    resetVirtualHeightMap()
    markMessagePanelReady()
  }

  const capturePrependScrollState = () => {
    // 优先走 ChatMessageList 暴露的虚拟列表 getScrollState，获取虚拟总高度。
    const messageList = messageListRef?.value
    if (messageList && typeof messageList.getScrollState === 'function') {
      const state = messageList.getScrollState()
      if (state) {
        return state
      }
    }
    const messagePanel = getMessagePanel()
    if (!messagePanel) {
      return null
    }
    return {
      scrollHeight: messagePanel.scrollHeight,
      scrollTop: messagePanel.scrollTop
    }
  }

  const restorePrependScrollPosition = async () => {
    const scrollState = pendingPrependScrollState
    pendingPrependScrollState = null
    if (!scrollState) {
      return
    }

    // 历史消息 prepend 后 scrollHeight 会变大，用高度差把视口还原到用户原来的阅读位置。
    // 统一切换前后都走虚拟列表 getScrollState，避免虚拟高度和 DOM 高度混用导致偏移。
    await nextTick()
    await new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        const currentState = capturePrependScrollState()
        if (currentState) {
          const heightDiff = currentState.scrollHeight - scrollState.scrollHeight
          const messagePanel = getMessagePanel()
          if (messagePanel) {
            messagePanel.scrollTop = scrollState.scrollTop + heightDiff
          }
        }
        resolve()
      })
    })
  }

  const loadChatMessage = ({ keepScrollPosition = false } = {}) => {
    if (!currentChatSession.value.sessionId) {
      messageCountInfo.noData = true
      markMessagePanelReady()
      return false
    }
    if (messageCountInfo.noData || (keepScrollPosition && messageLoadingMore.value)) {
      return false
    }
    const beforeMessageId = keepScrollPosition ? getOldestMessageId() : null
    if (keepScrollPosition && !beforeMessageId) {
      messageCountInfo.noData = true
      return false
    }
    // loadSeq 用来识别过期分页回包，防止快速切换会话时旧回包写入新会话。
    const loadSeq = getActiveMessageLoadSeq()
    if (keepScrollPosition) {
      pendingPrependScrollState = capturePrependScrollState()
      messageLoadingMore.value = true
    }
    window.ipcRenderer.send('loadChatMessage', {
      sessionId: currentChatSession.value.sessionId,
      beforeMessageId,
      loadSeq
    })
    return true
  }

  const loadMoreChatMessage = () => {
    loadChatMessage({ keepScrollPosition: true })
  }

  const chatSessionClickHandler = (item) => {
    markSessionRead?.(item.contactId)
    if (currentChatSession.value.contactId == item.contactId) {
      // 同一会话从路由补齐 sessionId 后，需要补拉一次历史消息。
      const shouldLoadMessages = !currentChatSession.value.sessionId && item.sessionId
      currentChatSession.value = Object.assign({}, currentChatSession.value, item)
      if (shouldLoadMessages) {
        revokeMessagePreviewUrls(messageList.value)
        messageList.value = []
        messageIdSet.clear()
        messageLoadingMore.value = false
        pendingPrependScrollState = null
        resetMessageCountInfo()
        resetVirtualHeightMap()
        shouldScrollToBottomAfterLoad = true
        shouldScrollToBottomLoadSeq = getActiveMessageLoadSeq()
        loadChatMessage()
      }
      return
    }

    // 切换会话时重置分页游标和渲染序列，旧会话的滚动/分页状态不带入新会话。
    startMessagePanelRender()
    currentChatSession.value = Object.assign({}, item)
    revokeMessagePreviewUrls(messageList.value)
    messageList.value = []
    messageIdSet.clear()
    messageLoadingMore.value = false
    pendingPrependScrollState = null
    resetMessageCountInfo()
    resetVirtualHeightMap()
    shouldScrollToBottomAfterLoad = true
    shouldScrollToBottomLoadSeq = getActiveMessageLoadSeq()
    loadChatMessage()
  }

  const onLoadChatMessageCallback = async (e, payload = {}) => {
    const { dataList, hasMore, loadMode, sessionId, loadSeq, targetMessageId } = payload
    if (payload?.success === false) {
      messageLoadingMore.value = false
      pendingPrependScrollState = null
      proxy.Message.error(payload.error || 'Load messages failed')
      markMessagePanelReady()
      return
    }
    // 主进程分页回调必须同时校验会话和渲染序列，避免异步回包串会话。
    const isExpiredLoad = loadSeq != null && loadSeq !== getActiveMessageLoadSeq()
    const isWrongSession = sessionId != null && sessionId !== currentChatSession.value.sessionId
    if (isExpiredLoad || isWrongSession) {
      messageLoadingMore.value = false
      pendingPrependScrollState = null
      // 仅过期回包不清除贴底标志，让当前活跃请求的 loadSeq 负责消费。
      return
    }
    const loadedMessages = Array.isArray(dataList) ? dataList : []
    loadedMessages.sort((a, b) => {
      return a.messageId - b.messageId
    })

    if (loadMode === 'context') {
      replaceMessageList(loadedMessages)
      messageCountInfo.noData = false
      messageLoadingMore.value = false
      pendingPrependScrollState = null
      markMessagePanelReady()
      const located = await scrollToMessageId(targetMessageId)
      if (!located && targetMessageId) {
        proxy.Message.warning('该消息暂时无法定位')
      }
      return
    }

    if (!hasMore || loadedMessages.length === 0) {
      messageCountInfo.noData = true
    }
    prependMessagesIfMissing(loadedMessages)
    if (shouldScrollToBottomAfterLoad && shouldScrollToBottomLoadSeq === loadSeq) {
      shouldScrollToBottomAfterLoad = false
      shouldScrollToBottomLoadSeq = null
      showMessagePanelAtBottom(getMessagePanelRenderSeq())
    } else if (messageLoadingMore.value) {
      await restorePrependScrollPosition()
    }
    messageLoadingMore.value = false
  }

  const locateChatMessage = async (message = {}) => {
    if (!message?.messageId || !currentChatSession.value.sessionId) {
      return
    }
    if (await scrollToMessageId(message.messageId)) {
      return
    }

    startMessagePanelRender()
    messageLoadingMore.value = true
    pendingPrependScrollState = null
    window.ipcRenderer.send('loadChatMessage', {
      sessionId: currentChatSession.value.sessionId,
      targetMessageId: message.messageId,
      loadSeq: getActiveMessageLoadSeq()
    })
  }

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

  // 保存监听器引用，便于精确移除而不影响其他窗口。
  let receiveMessageHandler = null
  let receiveMessageBatchHandler = null
  let loadChatMessageHandler = null

  const registerMessageListeners = () => {
    receiveMessageHandler = (e, message) => {
      console.log('收到消息', message)
      if (typeof message === 'string') {
        try {
          message = JSON.parse(message)
        } catch (error) {
          console.error('parse receiveMessage failed', error)
          proxy.Message.error('Receive message parse failed')
          return
        }
      }
      if (message?.success === false) {
        proxy.Message.error(message.error || 'Receive message failed')
        return
      }
      if (message.messageType == 0) {
        loadChatSession()
        return
      }
      if (message.messageType == 6) {
        handleFileUploadDone(message)
        return
      }
      const receiveContactId = getReceiveContactId(message)
      const isCurrentSession =
        message.sessionId == currentChatSession.value.sessionId ||
        receiveContactId == currentChatSession.value.contactId
      if (isCurrentSession) {
        markSessionRead?.(receiveContactId)
        const exists = message.messageId != null && messageIdSet.has(String(message.messageId))
        if (!exists) {
          const shouldStickToBottom = isNearMessageBottom()
          appendMessageIfMissing(message)
          scrollMessageToBottom({ force: shouldStickToBottom })
        }
      }
      const isSelfMsg = String(message.sendUserId) === String(currentUserId?.value)
      patchChatSessions([
        {
          contactId: receiveContactId,
          contactType: message.contactType,
          sessionId: message.sessionId,
          lastMessage: message.messageContent || '',
          lastReceiveTime: message.sendTime || Date.now(),
          noReadCountDelta: isCurrentSession || isSelfMsg ? 0 : 1
        }
      ])
    }
    window.ipcRenderer.on('receiveMessage', receiveMessageHandler)

    receiveMessageBatchHandler = (e, payload = {}) => {
      if (payload?.success === false) {
        proxy.Message.error(payload.error || 'Receive messages failed')
        return
      }
      const messages = Array.isArray(payload.messages) ? payload.messages : []
      const sessions = Array.isArray(payload.sessions) ? payload.sessions : []
      handleReceiveMessages(messages, sessions)
    }
    window.ipcRenderer.on('receiveMessageBatch', receiveMessageBatchHandler)

    loadChatMessageHandler = onLoadChatMessageCallback
    window.ipcRenderer.on('loadChatMessageCallback', loadChatMessageHandler)
  }

  const removeMessageListeners = () => {
    if (receiveMessageHandler) {
      window.ipcRenderer.removeListener('receiveMessage', receiveMessageHandler)
      receiveMessageHandler = null
    }
    if (receiveMessageBatchHandler) {
      window.ipcRenderer.removeListener('receiveMessageBatch', receiveMessageBatchHandler)
      receiveMessageBatchHandler = null
    }
    if (loadChatMessageHandler) {
      window.ipcRenderer.removeListener('loadChatMessageCallback', loadChatMessageHandler)
      loadChatMessageHandler = null
    }
  }

  const cleanupChatMessages = () => {
    removeMessageListeners()
    cleanupMessageScroll()
    messageLoadingMore.value = false
    pendingPrependScrollState = null
    shouldScrollToBottomAfterLoad = false
    shouldScrollToBottomLoadSeq = null
    messageIdSet.clear()
    messageList.value.forEach((message) => {
      if (message.localPreviewUrl) {
        URL.revokeObjectURL(message.localPreviewUrl)
      }
    })
  }

  return {
    chatSessionClickHandler,
    cleanupChatMessages,
    clearCurrentMessages,
    clearInitialBottomLock,
    locateChatMessage,
    loadChatMessage,
    loadMoreChatMessage,
    messageList,
    messageLoadingMore,
    messagePanelPhase,
    onSendChatMessage,
    onSendFileMessage,
    onSendImageMessage,
    onSendVideoMessage,
    registerMessageListeners,
    retryFailedMessage,
    settleScrollToBottom
  }
}
