import { nextTick } from 'vue'

/** Owns history pagination, locate requests and prepend scroll restoration. */
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
  let pendingPrependScrollState = null
  let shouldScrollToBottomAfterLoad = false
  let shouldScrollToBottomLoadSeq = null

  const resetMessageCountInfo = () => {
    messageCountInfo.noData = false
  }

  const resetVirtualHeightMap = () => messageListRef?.value?.resetHeightMap?.()

  const scrollToMessageId = async (messageId) => {
    if (!messageId) return false
    await nextTick()
    await new Promise((resolve) => window.requestAnimationFrame(resolve))
    const target = document.getElementById(`message${messageId}`)
    if (!target) return false
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return true
  }

  const clearCurrentMessages = () => {
    scroll.startMessagePanelRender()
    collection.clear()
    messageLoadingMore.value = false
    pendingPrependScrollState = null
    shouldScrollToBottomAfterLoad = false
    shouldScrollToBottomLoadSeq = null
    resetMessageCountInfo()
    messageCountInfo.noData = true
    resetVirtualHeightMap()
    scroll.markMessagePanelReady()
  }

  const capturePrependScrollState = () => {
    const list = messageListRef?.value
    let scrollState = list?.getScrollState?.() || null
    if (!scrollState) {
      const panel = scroll.getMessagePanel()
      if (!panel) return null
      scrollState = { scrollHeight: panel.scrollHeight, scrollTop: panel.scrollTop }
    }

    const panel = scroll.getMessagePanel()
    let anchorMessageId = null
    let anchorViewportTop = 0
    if (panel) {
      const panelRect = panel.getBoundingClientRect()
      for (const row of panel.querySelectorAll('[data-msg-key]')) {
        const rect = row.getBoundingClientRect()
        if (rect.bottom > panelRect.top + 10) {
          anchorMessageId = row.dataset.msgKey || null
          anchorViewportTop = rect.top - panelRect.top
          break
        }
      }
    }
    return { ...scrollState, anchorMessageId, anchorViewportTop }
  }

  const restorePrependScrollPosition = async () => {
    const scrollState = pendingPrependScrollState
    pendingPrependScrollState = null
    if (!scrollState) return

    await nextTick()
    await new Promise((resolve) => window.requestAnimationFrame(resolve))
    const panel = scroll.getMessagePanel()
    if (!panel) return

    let restored = false
    if (scrollState.anchorMessageId) {
      const anchor = document.getElementById(`message${scrollState.anchorMessageId}`)
      if (anchor) {
        const delta = anchor.getBoundingClientRect().top - panel.getBoundingClientRect().top - scrollState.anchorViewportTop
        panel.scrollTop += delta
        restored = true
      }
    }
    if (!restored) {
      const currentState = capturePrependScrollState()
      if (currentState) panel.scrollTop = scrollState.scrollTop + Math.max(0, currentState.scrollHeight - scrollState.scrollHeight)
    }

    await new Promise((resolve) => window.requestAnimationFrame(resolve))
    await new Promise((resolve) => window.requestAnimationFrame(resolve))
    if (scrollState.anchorMessageId) {
      const anchor = document.getElementById(`message${scrollState.anchorMessageId}`)
      if (anchor) {
        const delta = anchor.getBoundingClientRect().top - panel.getBoundingClientRect().top - scrollState.anchorViewportTop
        if (Math.abs(delta) > 3) panel.scrollTop += delta
      }
    }
  }

  const loadChatMessage = ({ keepScrollPosition = false, refreshTail = false } = {}) => {
    if (!currentChatSession.value.sessionId) {
      messageCountInfo.noData = true
      scroll.markMessagePanelReady()
      pendingPrependScrollState = null
      return false
    }
    if ((!refreshTail && messageCountInfo.noData) || (keepScrollPosition && messageLoadingMore.value)) {
      pendingPrependScrollState = null
      return false
    }
    const beforeMessageId = keepScrollPosition ? collection.getOldestServerMessageId() : null
    if (keepScrollPosition && !beforeMessageId) {
      messageCountInfo.noData = true
      pendingPrependScrollState = null
      return false
    }
    const loadSeq = scroll.getActiveMessageLoadSeq()
    if (keepScrollPosition) {
      pendingPrependScrollState = capturePrependScrollState()
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
      const shouldLoadMessages = item.sessionId && (!currentChatSession.value.sessionId || !messageList.value.length)
      currentChatSession.value = Object.assign({}, currentChatSession.value, item)
      if (shouldLoadMessages) {
        collection.clear()
        messageLoadingMore.value = false
        pendingPrependScrollState = null
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
    pendingPrependScrollState = null
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
      pendingPrependScrollState = null
      proxy.Message.error(payload.error || 'Load messages failed')
      scroll.markMessagePanelReady()
      return
    }
    if (
      (loadSeq != null && loadSeq !== scroll.getActiveMessageLoadSeq()) ||
      (sessionId != null && sessionId !== currentChatSession.value.sessionId)
    ) {
      messageLoadingMore.value = false
      pendingPrependScrollState = null
      return
    }
    const loadedMessages = Array.isArray(dataList) ? dataList : []
    loadedMessages.sort((a, b) => a.messageId - b.messageId)

    if (loadMode === 'context') {
      collection.replaceMessageList(loadedMessages)
      messageCountInfo.noData = false
      messageLoadingMore.value = false
      pendingPrependScrollState = null
      scroll.markMessagePanelReady()
      if (!(await scrollToMessageId(targetMessageId)) && targetMessageId) {
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
      pendingPrependScrollState = null
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
      await restorePrependScrollPosition()
    }
    messageLoadingMore.value = false
  }

  const locateChatMessage = async (message = {}) => {
    if (!message.messageId || !currentChatSession.value.sessionId) return
    if (await scrollToMessageId(message.messageId)) return
    scroll.startMessagePanelRender()
    messageLoadingMore.value = true
    pendingPrependScrollState = null
    window.api.sendLoadChatMessage({
      sessionId: currentChatSession.value.sessionId,
      targetMessageId: message.messageId,
      loadSeq: scroll.getActiveMessageLoadSeq()
    })
  }

  const cleanup = () => {
    messageLoadingMore.value = false
    pendingPrependScrollState = null
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
