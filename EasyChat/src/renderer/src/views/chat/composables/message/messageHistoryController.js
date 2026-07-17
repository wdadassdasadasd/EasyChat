import { createPrependScrollAnchorController } from './prependScrollAnchorController'

/** Owns history pagination, locate requests and active-session load state. */
export const createMessageHistoryController = ({
  collection,
  currentChatSession,
  markSessionRead,
  messageList,
  messageListRef,
  messageLoadingMore,
  proxy,
  scroll
}) => {
  const messageCountInfo = { noData: false }
  const scrollAnchor = createPrependScrollAnchorController({
    getMessagePanel: scroll.getMessagePanel,
    messageListRef
  })
  let shouldScrollToBottomAfterLoad = false
  let shouldScrollToBottomLoadSeq = null

  const resetMessageCountInfo = () => {
    messageCountInfo.noData = false
  }

  const resetVirtualHeightMap = () => messageListRef?.value?.resetHeightMap?.()

  const clearCurrentMessages = () => {
    scroll.startMessagePanelRender()
    collection.clear()
    messageLoadingMore.value = false
    scrollAnchor.clear()
    shouldScrollToBottomAfterLoad = false
    shouldScrollToBottomLoadSeq = null
    resetMessageCountInfo()
    messageCountInfo.noData = true
    resetVirtualHeightMap()
    scroll.markMessagePanelReady()
  }

  const loadChatMessage = ({ keepScrollPosition = false, refreshTail = false } = {}) => {
    if (!currentChatSession.value.sessionId) {
      messageCountInfo.noData = true
      scroll.markMessagePanelReady()
      scrollAnchor.clear()
      return false
    }
    if (
      (!refreshTail && messageCountInfo.noData) ||
      (keepScrollPosition && messageLoadingMore.value)
    ) {
      scrollAnchor.clear()
      return false
    }
    const beforeMessageId = keepScrollPosition ? collection.getOldestServerMessageId() : null
    if (keepScrollPosition && !beforeMessageId) {
      messageCountInfo.noData = true
      scrollAnchor.clear()
      return false
    }
    const loadSeq = scroll.getActiveMessageLoadSeq()
    if (keepScrollPosition) {
      scrollAnchor.capturePrependScrollState()
      messageLoadingMore.value = true
    }
    window.api.sendLoadChatMessage({
      sessionId: currentChatSession.value.sessionId,
      beforeMessageId,
      loadMode: refreshTail ? 'tail' : undefined,
      loadSeq
    })
    return true
  }

  const loadMoreChatMessage = () => loadChatMessage({ keepScrollPosition: true })

  const chatSessionClickHandler = (item) => {
    markSessionRead?.(item.contactId)
    if (currentChatSession.value.contactId == item.contactId) {
      const shouldLoadMessages =
        item.sessionId && (!currentChatSession.value.sessionId || !messageList.value.length)
      currentChatSession.value = Object.assign({}, currentChatSession.value, item)
      if (shouldLoadMessages) {
        collection.clear()
        messageLoadingMore.value = false
        scrollAnchor.clear()
        resetMessageCountInfo()
        resetVirtualHeightMap()
        shouldScrollToBottomAfterLoad = true
        shouldScrollToBottomLoadSeq = scroll.getActiveMessageLoadSeq()
        loadChatMessage()
      }
      return
    }

    scroll.startMessagePanelRender()
    currentChatSession.value = Object.assign({}, item)
    collection.clear()
    messageLoadingMore.value = false
    scrollAnchor.clear()
    resetMessageCountInfo()
    resetVirtualHeightMap()
    shouldScrollToBottomAfterLoad = true
    shouldScrollToBottomLoadSeq = scroll.getActiveMessageLoadSeq()
    loadChatMessage()
  }

  const onLoadChatMessageCallback = async (payload = {}) => {
    const { dataList, hasMore, loadMode, sessionId, loadSeq, targetMessageId } = payload
    if (payload.success === false) {
      messageLoadingMore.value = false
      scrollAnchor.clear()
      proxy.Message.error(payload.error || '加载消息失败')
      scroll.markMessagePanelReady()
      return
    }
    if (
      (loadSeq != null && loadSeq !== scroll.getActiveMessageLoadSeq()) ||
      (sessionId != null && sessionId !== currentChatSession.value.sessionId)
    ) {
      messageLoadingMore.value = false
      scrollAnchor.clear()
      return
    }
    const loadedMessages = Array.isArray(dataList) ? dataList : []
    loadedMessages.sort((a, b) => a.messageId - b.messageId)

    if (loadMode === 'context') {
      collection.replaceMessageList(loadedMessages)
      messageCountInfo.noData = false
      messageLoadingMore.value = false
      scrollAnchor.clear()
      scroll.markMessagePanelReady()
      if (!(await scrollAnchor.scrollToMessageId(targetMessageId)) && targetMessageId) {
        proxy.Message.warning('该消息暂时无法定位')
      }
      return
    }
    if (loadMode === 'tail') {
      const shouldStickToBottom = scroll.isNearMessageBottom()
      const appended = loadedMessages.reduce(
        (changed, message) => collection.appendMessageIfMissing(message) || changed,
        false
      )
      messageLoadingMore.value = false
      scrollAnchor.clear()
      if (appended) scroll.scrollMessageToBottom({ force: shouldStickToBottom })
      return
    }

    if (!hasMore || !loadedMessages.length) messageCountInfo.noData = true
    collection.prependMessagesIfMissing(loadedMessages)
    if (shouldScrollToBottomAfterLoad && shouldScrollToBottomLoadSeq === loadSeq) {
      shouldScrollToBottomAfterLoad = false
      shouldScrollToBottomLoadSeq = null
      scroll.showMessagePanelAtBottom(scroll.getMessagePanelRenderSeq())
    } else if (messageLoadingMore.value) {
      await scrollAnchor.restorePrependScrollPosition()
    }
    messageLoadingMore.value = false
  }

  const locateChatMessage = async (message = {}) => {
    if (!message.messageId || !currentChatSession.value.sessionId) return
    if (await scrollAnchor.scrollToMessageId(message.messageId)) return
    scroll.startMessagePanelRender()
    messageLoadingMore.value = true
    scrollAnchor.clear()
    window.api.sendLoadChatMessage({
      sessionId: currentChatSession.value.sessionId,
      targetMessageId: message.messageId,
      loadSeq: scroll.getActiveMessageLoadSeq()
    })
  }

  const cleanup = () => {
    messageLoadingMore.value = false
    scrollAnchor.cleanup()
    shouldScrollToBottomAfterLoad = false
    shouldScrollToBottomLoadSeq = null
    collection.clear()
  }

  return {
    chatSessionClickHandler,
    cleanup,
    clearCurrentMessages,
    loadChatMessage,
    loadMoreChatMessage,
    locateChatMessage,
    onLoadChatMessageCallback
  }
}
