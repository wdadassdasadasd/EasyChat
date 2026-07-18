import { computed, ref } from 'vue'
import { createSubscriptionRegistry } from './subscriptionRegistry'
import { useChatMessages } from './useChatMessages'
import { useChatSessions } from './useChatSessions'
import { useFileTransfer } from './useFileTransfer'

/**
 * Chat.vue's composition root. It owns page-lifetime subscriptions while the
 * child composables remain owners of their respective domain state.
 */
export const useChatPageController = ({ currentUserId, messageListRef, proxy, route }) => {
  const groupDetailVisible = ref(false)
  const userDetailVisible = ref(false)
  const wsStatusText = ref('')
  const pageSubscriptions = createSubscriptionRegistry()
  let syncPromise = null
  let syncEventsHandler = () => Promise.resolve()

  const sessions = useChatSessions({ proxy, route })
  const messages = useChatMessages({
    currentChatSession: sessions.currentChatSession,
    currentUserId,
    loadChatSession: sessions.loadChatSession,
    markSessionRead: sessions.markSessionRead,
    messageListRef,
    onResyncRequired: (payload) => syncEventsHandler(payload),
    patchChatSessions: sessions.patchChatSessions,
    proxy
  })
  const files = useFileTransfer({ proxy })

  sessions.setSessionSelector(messages.chatSessionClickHandler)

  const totalUnreadCount = computed(() =>
    sessions.chatSessionList.value.reduce(
      (total, session) => total + Number(session.noReadCount || 0),
      0
    )
  )

  const applySyncResult = (result = {}) => {
    messages.applyPersistedV2Result(result)
    if (!result.stateChanged) sessions.loadChatSession()
  }

  const flushReadReceipts = async () => {
    const pending = await window.api.invokeGetPendingReadReceipts()
    if (!pending?.success) throw new Error(pending?.error || 'Unable to read pending receipts')
    for (const receipt of pending.receipts || []) {
      const response = await proxy.Request({
        url: proxy.Api.markRead,
        params: { contactId: receipt.contactId, readRequestId: receipt.requestId },
        showLoading: false,
        showError: false,
        returnError: true
      })
      if (!response || response.success === false) throw new Error(response?.msg || 'Read receipt failed')
      const acknowledged = await window.api.invokeAcknowledgeReadReceipt(receipt)
      if (!acknowledged?.success) throw new Error(acknowledged?.error || 'Read receipt acknowledgement failed')
    }
  }

  const syncSnapshotPages = async () => {
    const existing = await window.api.invokeGetSnapshotProgress()
    const progress = existing?.success ? existing.progress : null
    const snapshotId = progress?.snapshotId || crypto.randomUUID()
    let snapshotCursor = progress?.snapshotCursor ?? null
    let sessionCursor = progress?.nextSessionCursor ?? null
    for (;;) {
      const snapshot = await proxy.Request({
        url: proxy.Api.syncSnapshot,
        params: { snapshotCursor, sessionCursor },
        showLoading: false,
        showError: false,
        returnError: true
      })
      if (!snapshot || snapshot.success === false) throw new Error(snapshot?.msg || 'Snapshot sync failed')
      const data = snapshot.data || {}
      snapshotCursor = Number(data.snapshotCursor)
      const applied = await window.api.invokeApplySyncSnapshotPage({
        ...data,
        snapshotId,
        snapshotCursor
      })
      if (!applied?.success) throw new Error(applied?.error || 'Snapshot persistence failed')
      if (applied.complete || !data.hasMore) {
        applySyncResult(applied)
        return
      }
      sessionCursor = data.nextSessionCursor
    }
  }

  const syncEventPages = async () => {
    if (syncPromise) return syncPromise
    syncPromise = (async () => {
      await flushReadReceipts()
      const cursorResult = await window.api.invokeGetSyncCursor()
      if (!cursorResult?.success) throw new Error(cursorResult?.error || 'Unable to read sync cursor')
      let cursor = Number(cursorResult.cursor || 0)
      for (;;) {
        const response = await proxy.Request({
          url: proxy.Api.syncEvents,
          params: { cursor, limit: 200 },
          showLoading: false,
          showError: false,
          returnError: true
        })
        if (!response || response.success === false) throw new Error(response?.msg || 'Event sync failed')
        const data = response.data || {}
        if (data.cursorExpired) {
          await syncSnapshotPages()
          return
        }
        const applied = await window.api.invokeApplySyncEventsPage({
          events: Array.isArray(data.events) ? data.events : [],
          nextCursor: Number(data.nextCursor ?? cursor),
          unreadSnapshot: data.unreadSnapshot || {}
        })
        if (!applied?.success) throw new Error(applied?.error || 'Event persistence failed')
        applySyncResult(applied)
        cursor = Number(applied.nextCursor)
        if (!data.hasMore) return
      }
    })().finally(() => {
      syncPromise = null
    })
    return syncPromise
  }
  syncEventsHandler = syncEventPages

  const handleWsStatus = (payload = {}) => {
    if (payload.status === 'connected') {
      wsStatusText.value = ''
      syncEventPages()
        .then(() => messages.loadChatMessage({ refreshTail: true }))
        .catch((error) => {
          console.error('incremental event sync failed', error)
          wsStatusText.value = 'Sync failed'
        })
    } else if (payload.status === 'closed') {
      wsStatusText.value = ''
    } else if (payload.status === 'reconnecting') {
      wsStatusText.value = `Reconnecting ${payload.retryLeft ?? ''}`.trim()
    } else if (payload.status === 'failed') {
      wsStatusText.value = 'Connection failed'
    } else if (payload.status === 'connecting') {
      wsStatusText.value = 'Connecting'
    }
  }

  const handleClearMessages = () => {
    const sessionId = sessions.currentChatSession.value.sessionId
    if (!sessionId) {
      messages.clearCurrentMessages()
      return
    }

    proxy.Confirm({
      message: '确认清空聊天记录吗？',
      okfun: () => {
        pageSubscriptions.replace('clearChatMessage', () =>
          window.api.onClearChatMessageCallback((payload = {}) => {
            if (payload?.sessionId !== sessionId) return
            pageSubscriptions.replace('clearChatMessage')
            if (!payload.success) {
              proxy.Message.error('清空聊天记录失败')
              return
            }
            messages.clearCurrentMessages()
            if (payload.session) sessions.patchChatSessions([payload.session])
            proxy.Message.success('聊天记录已清空')
          })
        )
        window.api.sendClearChatMessage({ sessionId })
      }
    })
  }

  const showChatDetail = () => {
    if (sessions.currentChatSession.value.contactType == 1) {
      userDetailVisible.value = false
      groupDetailVisible.value = !groupDetailVisible.value
    } else if (sessions.currentChatSession.value.contactType == 0) {
      groupDetailVisible.value = false
      userDetailVisible.value = !userDetailVisible.value
    } else {
      groupDetailVisible.value = false
      userDetailVisible.value = false
    }
  }

  const handleToggleTop = (isTop) => {
    const contactId = sessions.currentChatSession.value.contactId
    if (contactId) sessions.setChatSessionTop(contactId, isTop ? 1 : 0)
  }

  const mount = () => {
    messages.registerMessageListeners()
    sessions.registerSessionListener()
    pageSubscriptions.replace('wsStatus', () => window.api.onWsStatusChange(handleWsStatus))
    sessions.loadChatSession()
    sessions.openChatFromRoute()
  }

  const unmount = () => {
    groupDetailVisible.value = false
    userDetailVisible.value = false
    pageSubscriptions.clear()
    sessions.removeSessionListener()
    if (typeof files.cleanupFileTransfer === 'function') files.cleanupFileTransfer()
    else files.closeVideoPreviewDialog()
    messages.cleanupChatMessages()
  }

  return {
    ...sessions,
    ...messages,
    ...files,
    groupDetailVisible,
    handleClearMessages,
    handleGroupUpdated: sessions.updateCurrentChatSession,
    handleToggleTop,
    mount,
    showChatDetail,
    totalUnreadCount,
    unmount,
    userDetailVisible,
    wsStatusText
  }
}
