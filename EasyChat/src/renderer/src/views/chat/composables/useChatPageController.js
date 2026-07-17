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

  const sessions = useChatSessions({ proxy, route })
  const messages = useChatMessages({
    currentChatSession: sessions.currentChatSession,
    currentUserId,
    loadChatSession: sessions.loadChatSession,
    markSessionRead: sessions.markSessionRead,
    messageListRef,
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

  const handleWsStatus = (payload = {}) => {
    if (payload.status === 'connected') {
      wsStatusText.value = ''
      sessions.loadChatSession()
      messages.loadChatMessage({ refreshTail: true })
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
    files.closeVideoPreviewDialog()
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
