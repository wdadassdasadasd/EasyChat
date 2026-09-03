import { nextTick, ref } from 'vue'
import { CHAT_CONSTANTS } from '@/utils/ChatConstants'
import { useChatMessageSender } from './useChatMessageSender'

// Message IPC subscriptions are intentionally local to this domain.  Sharing
// the helper from sessions made the message owner depend on a sibling domain.
const createMessageSubscriptionRegistry = () => {
  const subscriptions = new Map()
  const replace = (name, subscribe) => {
    subscriptions.get(name)?.()
    if (!subscribe) {
      subscriptions.delete(name)
      return
    }
    const unsubscribe = subscribe()
    subscriptions.set(name, typeof unsubscribe === 'function' ? unsubscribe : () => {})
  }
  const clear = () => {
    subscriptions.forEach((unsubscribe) => unsubscribe())
    subscriptions.clear()
  }
  return { clear, replace }
}

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
  // Sender may update messages, but it never owns the reactive list. Keep the
  // write surface explicit so message state remains exclusively in this module.
  const messageStore = {
    appendIfMissing: appendMessageIfMissing,
    findById: (messageId) => messageList.value.find((item) => item.messageId == messageId),
    replaceById: replaceMessageById,
    updateById: updateMessageById
  }
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
    currentChatSession,
    currentUserId,
    isNearMessageBottom,
    messageStore,
    patchChatSessions,
    proxy,
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

/** Internal in-memory dedupe and object-URL lifecycle for the active list. */
export const createMessageCollection = (messageList) => {
  const messageIdSet = new Set()
  const urlsFor = (message = {}) =>
    new Set([message?.localPreviewUrl, message?.localCoverUrl].filter(Boolean))
  const revoke = (message = {}, retainedUrls = new Set()) => {
    urlsFor(message).forEach((url) => {
      if (!retainedUrls.has(url)) URL.revokeObjectURL(url)
    })
  }
  const revokeList = (messages = []) => messages.forEach((message) => revoke(message))
  const rebuildIds = () => {
    messageIdSet.clear()
    messageList.value.forEach((message) => {
      if (message.messageId != null) messageIdSet.add(String(message.messageId))
    })
  }
  const appendMessageIfMissing = (message) => {
    if (!message) return false
    const messageId = message.messageId != null ? String(message.messageId) : ''
    if (messageId && messageIdSet.has(messageId)) return false
    messageList.value.push(message)
    if (messageId) messageIdSet.add(messageId)
    return true
  }
  const updateMessageById = (messageId, patch = {}) => {
    const index = messageList.value.findIndex(
      (message) => String(message?.messageId) === String(messageId)
    )
    if (index === -1) return false
    messageList.value[index] = Object.assign({}, messageList.value[index], patch)
    return true
  }
  const replaceMessageById = (messageId, nextMessage) => {
    const index = messageList.value.findIndex(
      (message) => String(message?.messageId) === String(messageId)
    )
    if (index === -1 || !nextMessage) return false
    const previousMessage = messageList.value[index]
    const nextMessageId = nextMessage.messageId != null ? String(nextMessage.messageId) : ''
    const existingServerIndex = nextMessageId
      ? messageList.value.findIndex(
          (message, itemIndex) =>
            itemIndex !== index && String(message?.messageId) === nextMessageId
        )
      : -1
    if (existingServerIndex !== -1) {
      const mergedMessage = Object.assign({}, messageList.value[existingServerIndex], nextMessage)
      revoke(previousMessage, urlsFor(mergedMessage))
      if (previousMessage?.messageId != null) messageIdSet.delete(String(previousMessage.messageId))
      messageList.value[existingServerIndex] = mergedMessage
      messageList.value.splice(index, 1)
      if (mergedMessage.messageId != null) messageIdSet.add(String(mergedMessage.messageId))
      return true
    }
    revoke(previousMessage, urlsFor(nextMessage))
    if (previousMessage?.messageId != null) messageIdSet.delete(String(previousMessage.messageId))
    messageList.value[index] = nextMessage
    if (nextMessage.messageId != null) messageIdSet.add(String(nextMessage.messageId))
    return true
  }
  const prependMessagesIfMissing = (messages = []) => {
    const prependList = []
    messages.forEach((message) => {
      const messageId = message?.messageId != null ? String(message.messageId) : ''
      if (messageId && messageIdSet.has(messageId)) return
      prependList.push(message)
      if (messageId) messageIdSet.add(messageId)
    })
    if (prependList.length) messageList.value = prependList.concat(messageList.value)
    return prependList.length
  }
  const replaceMessageList = (messages = []) => {
    const retainedUrls = new Set()
    messages.forEach((message) => urlsFor(message).forEach((url) => retainedUrls.add(url)))
    messageList.value.forEach((message) => revoke(message, retainedUrls))
    messageList.value = messages
    rebuildIds()
  }
  const clear = () => {
    revokeList(messageList.value)
    messageList.value = []
    messageIdSet.clear()
  }
  const getOldestServerMessageId = () => {
    const messageIds = messageList.value
      .map((message) => Number(message.messageId || 0))
      .filter((messageId) => messageId > 0)
    return messageIds.length ? Math.min(...messageIds) : null
  }
  return {
    appendMessageIfMissing,
    clear,
    getOldestServerMessageId,
    prependMessagesIfMissing,
    replaceMessageById,
    replaceMessageList,
    revokeMessageObjectUrlsForList: revokeList,
    updateMessageById
  }
}

/** Internal named renderer listener ownership for the message state module. */
export const createMessageSubscriptionController = ({
  applyPersistedV2Result,
  loadChatSession,
  onLoadChatMessageCallback,
  proxy,
  recoverReceiveResync
}) => {
  const subscriptions = createMessageSubscriptionRegistry()
  const register = () => {
    subscriptions.clear()
    subscriptions.replace('receiveMessageBatch', () =>
      window.api.onReceiveMessageBatch((payload = {}) => {
        if (payload?.success === false) {
          proxy.Message.error(payload.error || '消息同步异常，正在尝试恢复。')
          if (payload.resyncRequired) recoverReceiveResync(payload)
          return
        }
        applyPersistedV2Result(payload)
        if (payload.stateChanged) loadChatSession()
      })
    )
    subscriptions.replace('loadChatMessage', () =>
      window.api.onLoadChatMessageCallback(onLoadChatMessageCallback)
    )
  }
  return { register, remove: () => subscriptions.clear() }
}

const {
  BOTTOM_GAP_TOLERANCE,
  INITIAL_BOTTOM_LOCK_DURATION,
  MAX_BOTTOM_SETTLE_FRAMES,
  STABLE_FRAME_COUNT,
  NEAR_BOTTOM_THRESHOLD,
  IMAGE_LOADED_BOTTOM_TOLERANCE
} = CHAT_CONSTANTS

/** Internal scroll state machine for history, session switching and media reflow. */
export const useMessageScroll = ({ messageListRef } = {}) => {
  const messagePanelPhase = ref('ready')
  const state = {
    renderSeq: 0,
    loadSeq: 0,
    bottomLockSeq: 0,
    bottomLockTimer: null,
    bottomSettleFrame: null
  }
  const getMessageList = () => messageListRef?.value || null
  const getMessagePanel = () => {
    const messageList = getMessageList()
    if (typeof messageList?.getMessagePanelElement === 'function')
      return messageList.getMessagePanelElement()
    return document.getElementById('message-panel')
  }
  const getScrollState = () => {
    const messageList = getMessageList()
    if (typeof messageList?.getScrollState === 'function') return messageList.getScrollState()
    const panel = getMessagePanel()
    if (!panel) return null
    return {
      scrollHeight: panel.scrollHeight,
      scrollTop: panel.scrollTop,
      clientHeight: panel.clientHeight,
      bottomGap: Math.max(0, panel.scrollHeight - panel.scrollTop - panel.clientHeight)
    }
  }
  const setMessagePanelToBottom = () => {
    const messageList = getMessageList()
    if (typeof messageList?.scrollToBottom === 'function') {
      messageList.scrollToBottom()
      return
    }
    const panel = getMessagePanel()
    if (!panel) return
    const previousBehavior = panel.style.scrollBehavior
    panel.style.scrollBehavior = 'auto'
    panel.scrollTop = Math.max(0, panel.scrollHeight - panel.clientHeight)
    if (previousBehavior) panel.style.scrollBehavior = previousBehavior
    else panel.style.removeProperty('scroll-behavior')
  }
  const getBottomGap = () => {
    const messageList = getMessageList()
    if (typeof messageList?.getBottomGap === 'function') return messageList.getBottomGap()
    return getScrollState()?.bottomGap ?? 0
  }
  const cancelSettleFrame = () => {
    if (state.bottomSettleFrame) {
      cancelAnimationFrame(state.bottomSettleFrame)
      state.bottomSettleFrame = null
    }
  }
  const clearInitialBottomLock = () => {
    state.bottomLockSeq = 0
    if (state.bottomLockTimer) {
      clearTimeout(state.bottomLockTimer)
      state.bottomLockTimer = null
    }
    cancelSettleFrame()
  }
  const keepInitialBottomLock = (renderSeq) => {
    clearInitialBottomLock()
    state.bottomLockSeq = renderSeq
    state.bottomLockTimer = setTimeout(() => {
      if (state.bottomLockSeq === renderSeq) state.bottomLockSeq = 0
      state.bottomLockTimer = null
    }, INITIAL_BOTTOM_LOCK_DURATION)
  }
  const isInitialBottomLocked = () =>
    state.bottomLockSeq !== 0 && state.bottomLockSeq === state.renderSeq
  const scheduleBottomSettle = () => {
    if (state.bottomSettleFrame) return
    state.bottomSettleFrame = requestAnimationFrame(() => {
      state.bottomSettleFrame = null
      setMessagePanelToBottom()
    })
  }
  const isNearMessageBottom = (threshold = NEAR_BOTTOM_THRESHOLD) => {
    const scrollState = getScrollState()
    return !scrollState || scrollState.bottomGap < threshold
  }
  const scrollMessageToBottom = async ({ force = false } = {}) => {
    if (!force && !isNearMessageBottom()) return
    await nextTick()
    setMessagePanelToBottom()
  }
  const settleScrollToBottom = () => {
    if (isInitialBottomLocked() || isNearMessageBottom(IMAGE_LOADED_BOTTOM_TOLERANCE))
      scheduleBottomSettle()
  }
  const waitNextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))
  const showMessagePanelAtBottom = async (renderSeq = state.renderSeq) => {
    await nextTick()
    if (renderSeq !== state.renderSeq) return
    let stableFrames = 0
    let previousState = null
    for (let index = 0; index < MAX_BOTTOM_SETTLE_FRAMES; index++) {
      setMessagePanelToBottom()
      await waitNextFrame()
      if (renderSeq !== state.renderSeq) return
      const scrollState = getScrollState()
      if (!scrollState) break
      const pinned = getBottomGap() <= BOTTOM_GAP_TOLERANCE
      const stable =
        previousState &&
        Math.abs(scrollState.scrollHeight - previousState.scrollHeight) <= 1 &&
        Math.abs(scrollState.scrollTop - previousState.scrollTop) <= 1
      stableFrames = pinned && stable ? stableFrames + 1 : 0
      previousState = scrollState
      if (stableFrames >= STABLE_FRAME_COUNT) break
    }
    setMessagePanelToBottom()
    if (renderSeq !== state.renderSeq) return
    messagePanelPhase.value = 'ready'
    keepInitialBottomLock(state.renderSeq)
  }
  const startMessagePanelRender = () => {
    clearInitialBottomLock()
    cancelSettleFrame()
    state.renderSeq += 1
    state.loadSeq = state.renderSeq
    messagePanelPhase.value = 'preparing'
    return state.renderSeq
  }
  const markMessagePanelReady = () => {
    messagePanelPhase.value = 'ready'
  }
  const cleanupMessageScroll = () => {
    clearInitialBottomLock()
    cancelSettleFrame()
    messagePanelPhase.value = 'idle'
  }
  return {
    messagePanelPhase,
    clearInitialBottomLock,
    getActiveMessageLoadSeq: () => state.loadSeq,
    getMessagePanel,
    getMessagePanelRenderSeq: () => state.renderSeq,
    isNearMessageBottom,
    markMessagePanelReady,
    scrollMessageToBottom,
    settleScrollToBottom,
    showMessagePanelAtBottom,
    startMessagePanelRender,
    cleanupMessageScroll
  }
}

/** Internal viewport anchor controller used only by message history pagination. */
export const createPrependScrollAnchorController = ({ messageListRef, getMessagePanel } = {}) => {
  let pendingScrollState = null
  let lifecycleSeq = 0
  const scheduledFrames = new Map()
  const getPanel = () => getMessagePanel?.() || document.getElementById('message-panel')
  const waitNextFrame = () =>
    new Promise((resolve) => {
      const requestFrame = window.requestAnimationFrame || ((callback) => setTimeout(callback, 0))
      const cancelFrame = window.cancelAnimationFrame || clearTimeout
      let frameId = null
      let finished = false
      const finish = (completed) => {
        if (finished) return
        finished = true
        if (frameId != null) scheduledFrames.delete(frameId)
        resolve(completed)
      }
      frameId = requestFrame(() => finish(true))
      if (finished) return
      scheduledFrames.set(frameId, () => {
        cancelFrame(frameId)
        finish(false)
      })
    })
  const cancelScheduledFrames = () => {
    scheduledFrames.forEach((cancel) => cancel())
    scheduledFrames.clear()
  }
  const clear = () => {
    lifecycleSeq += 1
    pendingScrollState = null
    cancelScheduledFrames()
  }
  const getScrollState = () => {
    const listState = messageListRef?.value?.getScrollState?.()
    if (listState) return listState
    const panel = getPanel()
    if (!panel) return null
    return {
      scrollHeight: panel.scrollHeight,
      scrollTop: panel.scrollTop,
      clientHeight: panel.clientHeight,
      bottomGap: Math.max(0, panel.scrollHeight - panel.scrollTop - panel.clientHeight)
    }
  }
  const findMessageElement = (messageId) =>
    messageId ? document.getElementById(`message${messageId}`) : null
  const capturePrependScrollState = () => {
    clear()
    const scrollState = getScrollState()
    if (!scrollState) return false
    const panel = getPanel()
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
    pendingScrollState = { ...scrollState, anchorMessageId, anchorViewportTop }
    return true
  }
  const restorePrependScrollPosition = async () => {
    const scrollState = pendingScrollState
    pendingScrollState = null
    if (!scrollState) return false
    const restoreSeq = lifecycleSeq
    await nextTick()
    if (restoreSeq !== lifecycleSeq || !(await waitNextFrame()) || restoreSeq !== lifecycleSeq)
      return false
    const panel = getPanel()
    if (!panel) return false
    let restored = false
    if (scrollState.anchorMessageId) {
      const anchor = findMessageElement(scrollState.anchorMessageId)
      if (anchor) {
        panel.scrollTop +=
          anchor.getBoundingClientRect().top -
          panel.getBoundingClientRect().top -
          scrollState.anchorViewportTop
        restored = true
      }
    }
    if (!restored) {
      const currentState = getScrollState()
      if (currentState)
        panel.scrollTop =
          scrollState.scrollTop + Math.max(0, currentState.scrollHeight - scrollState.scrollHeight)
    }
    if (
      !(await waitNextFrame()) ||
      restoreSeq !== lifecycleSeq ||
      !(await waitNextFrame()) ||
      restoreSeq !== lifecycleSeq ||
      !scrollState.anchorMessageId
    )
      return restored
    const anchor = findMessageElement(scrollState.anchorMessageId)
    if (anchor) {
      const delta =
        anchor.getBoundingClientRect().top -
        panel.getBoundingClientRect().top -
        scrollState.anchorViewportTop
      if (Math.abs(delta) > 3) panel.scrollTop += delta
    }
    return restored
  }
  const scrollToMessageId = async (messageId) => {
    if (!messageId) return false
    const scrollSeq = lifecycleSeq
    await nextTick()
    if (scrollSeq !== lifecycleSeq || !(await waitNextFrame()) || scrollSeq !== lifecycleSeq)
      return false
    const target = findMessageElement(messageId)
    if (!target) return false
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return true
  }
  return {
    capturePrependScrollState,
    cleanup: clear,
    clear,
    restorePrependScrollPosition,
    scrollToMessageId
  }
}

/** Internal pagination and locate controller for the active message state. */
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
  const chatSessionClickHandler = (item) => {
    markSessionRead?.(item.contactId)
    const currentSession = currentChatSession.value || {}
    const isSameSession =
      currentSession.sessionId && item.sessionId
        ? String(currentSession.sessionId) === String(item.sessionId)
        : String(currentSession.contactId) === String(item.contactId) &&
          Number(currentSession.contactType) === Number(item.contactType)
    if (isSameSession) {
      const shouldLoadMessages =
        item.sessionId && (!currentSession.sessionId || !messageList.value.length)
      currentChatSession.value = Object.assign({}, currentSession, item)
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
    if (
      (loadSeq != null && loadSeq !== scroll.getActiveMessageLoadSeq()) ||
      (sessionId != null && sessionId !== currentChatSession.value.sessionId)
    )
      return
    if (payload.success === false) {
      messageLoadingMore.value = false
      scrollAnchor.clear()
      proxy.Message.error(payload.error || '加载消息失败')
      scroll.markMessagePanelReady()
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
      if (!(await scrollAnchor.scrollToMessageId(targetMessageId)) && targetMessageId)
        proxy.Message.warning('该消息暂时无法定位')
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
    } else if (messageLoadingMore.value) await scrollAnchor.restorePrependScrollPosition()
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
    loadMoreChatMessage: () => loadChatMessage({ keepScrollPosition: true }),
    locateChatMessage,
    onLoadChatMessageCallback
  }
}
