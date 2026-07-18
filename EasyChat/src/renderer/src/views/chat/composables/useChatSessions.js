import { computed, nextTick, ref } from 'vue'
import ContextMenu from '@imengyu/vue3-context-menu'
import { createSessionOperationController } from './session/sessionOperationController'
import { createSessionProfileResolver } from './session/sessionProfileResolver'
import { createSessionSubscriptionController } from './session/sessionSubscriptionController'
import { markPerformance } from '@/utils/performanceMetrics'

/**
 * Owns renderer session state and composes profile resolution, subscriptions,
 * and optimistic session operations.
 */
export const useChatSessions = ({ proxy, route }) => {
  const chatSessionList = ref([])
  const currentChatSession = ref({})
  let selectSession = () => {}
  let sessionLoadSeq = 0
  let hasMarkedFirstSessionListRender = false
  const sessionSubscriptions = createSessionSubscriptionController()
  const profileResolver = createSessionProfileResolver({ proxy })

  const hasCurrentChat = computed(() => Object.keys(currentChatSession.value).length > 0)
  const currentChatSessionTitle = computed(() => getSessionName(currentChatSession.value))
  const welcomeText = computed(() =>
    currentChatSession.value.contactType == 1
      ? currentChatSessionTitle.value + ' 已创建好，快来开始群聊吧'
      : '欢迎和 ' + (currentChatSessionTitle.value || '') + ' 开始聊天'
  )

  const getSessionName = (session = {}) =>
    profileResolver.getRealSessionName(session) || session.contactId || ''

  const setSessionSelector = (handler) => {
    selectSession = handler
  }

  const loadChatSession = () => {
    window.api.sendLoadSessionData()
  }

  const sortChatSessionList = (dataList) => {
    dataList.sort((a, b) => {
      const topTypeResult = Number(b.topType || 0) - Number(a.topType || 0)
      return topTypeResult === 0
        ? Number(b.lastReceiveTime || 0) - Number(a.lastReceiveTime || 0)
        : topTypeResult
    })
    return dataList
  }

  const syncCurrentSession = (session) => {
    if (currentChatSession.value.contactId == session.contactId) {
      currentChatSession.value = Object.assign({}, currentChatSession.value, session)
    }
  }

  const operations = createSessionOperationController({
    chatSessionList,
    currentChatSession,
    proxy,
    sortChatSessionList
  })

  const openChatFromRoute = async () => {
    const chatId = route.query.chatId
    if (!chatId) return

    const contactType = profileResolver.getContactTypeValue(route.query.type)
    let session = chatSessionList.value.find((item) => item.contactId == chatId)
    if (session) {
      if (
        route.query.contactName &&
        (session.contactType == 1 || !profileResolver.getRealSessionName(session))
      ) {
        session = Object.assign({}, session, {
          contactName: route.query.contactName,
          memberCount: route.query.memberCount || session.memberCount
        })
      }
      session = await profileResolver.fillSessionName(session)
      const index = chatSessionList.value.findIndex((item) => item.contactId == chatId)
      if (index !== -1) chatSessionList.value[index] = session
      selectSession(session)
      return
    }

    const serverInfo = await profileResolver.getSessionInfoFromServer(chatId, contactType)
    session = {
      contactId: chatId,
      contactType,
      contactName: serverInfo.contactName || route.query.contactName || chatId,
      memberCount: serverInfo.memberCount,
      status: 1,
      topType: 0,
      noReadCount: 0
    }
    chatSessionList.value.unshift(session)
    selectSession(session)
  }

  const patchChatSessions = (sessions = [], { readContactIds = [] } = {}) => {
    const readContactIdSet = new Set(readContactIds.map((item) => String(item)))
    const sessionList = Array.isArray(sessions) ? sessions : []
    let orderChanged = false

    sessionList.forEach((rawSession = {}) => {
      if (!rawSession.contactId) return

      const { noReadCountDelta = 0, ...sessionInfo } = rawSession
      const contactId = String(sessionInfo.contactId)
      const index = chatSessionList.value.findIndex((item) => String(item.contactId) === contactId)
      const previous = index >= 0 ? chatSessionList.value[index] : {}
      const nextSession = Object.assign({}, previous, sessionInfo, {
        status: sessionInfo.status ?? previous.status ?? 1
      })
      operations.reconcileUnreadPatch({
        contactId,
        noReadCountDelta,
        nextSession,
        previous,
        readContactIdSet,
        sessionInfo
      })
      if (
        nextSession.topType !== previous.topType ||
        nextSession.lastReceiveTime !== previous.lastReceiveTime
      ) {
        orderChanged = true
      }
      if (index >= 0) chatSessionList.value[index] = nextSession
      else chatSessionList.value.unshift(nextSession)
      syncCurrentSession(nextSession)
    })

    if (orderChanged) sortChatSessionList(chatSessionList.value)
  }

  const applyProfilePatch = (profile = {}) => {
    if (!profile.contactId) return
    const index = chatSessionList.value.findIndex(
      (session) => String(session.contactId) === String(profile.contactId)
    )
    if (index < 0) return

    const profileFields = ['contactName', 'groupName', 'nickName', 'memberCount']
    const patch = profileFields.reduce((result, key) => {
      if (profile[key] !== undefined) result[key] = profile[key]
      return result
    }, {})
    if (!Object.keys(patch).length) return
    const updatedSession = Object.assign({}, chatSessionList.value[index], patch)
    chatSessionList.value[index] = updatedSession
    syncCurrentSession(updatedSession)
  }

  const mergeLoadedSessionList = (dataList = []) => {
    const mergedMap = new Map()
    chatSessionList.value.forEach((session) => {
      if (session?.contactId) mergedMap.set(String(session.contactId), session)
    })
    dataList.forEach((session) => {
      if (!session?.contactId) return
      const key = String(session.contactId)
      const existing = mergedMap.get(key)
      if (!existing) {
        mergedMap.set(key, session)
        return
      }
      existing.noReadCount = Math.max(
        Number(existing.noReadCount || 0),
        Number(session.noReadCount || 0)
      )
      if (session.contactName && session.contactName !== existing.contactName) {
        existing.contactName = session.contactName
      }
      if (session.memberCount != null) existing.memberCount = session.memberCount
    })
    const mergedList = Array.from(mergedMap.values())
    sortChatSessionList(mergedList)
    chatSessionList.value = mergedList
  }

  const hydrateSessionProfiles = (dataList, loadSeq) => {
    void profileResolver
      .hydrateSessionList(dataList || [], {
        concurrency: 4,
        shouldContinue: () => loadSeq === sessionLoadSeq,
        onResolved: (profile) => {
          if (loadSeq === sessionLoadSeq) applyProfilePatch(profile)
        }
      })
      .catch((error) => console.warn('Failed to hydrate chat session profiles', error))
  }

  const handleLoadSessionData = (dataList) => {
    if (dataList && !Array.isArray(dataList) && dataList.success === false) {
      proxy.Message.error(dataList.error || '会话列表加载失败，数据库可能不可用。')
      return
    }

    const loadSeq = ++sessionLoadSeq
    const sessionList = Array.isArray(dataList) ? dataList : []
    mergeLoadedSessionList(sessionList)
    openChatFromRoute()
    if (!hasMarkedFirstSessionListRender) {
      hasMarkedFirstSessionListRender = true
      void nextTick(() => markPerformance('session-list-first-render'))
    }
    hydrateSessionProfiles(sessionList, loadSeq)
  }

  const registerSessionListener = () => {
    removeSessionListener()
    sessionSubscriptions.register({
      onDelete: operations.handleDeleteAck,
      onLoad: handleLoadSessionData,
      onMarkRead: operations.handleReadAck,
      onTop: operations.handleTopAck
    })
  }

  const removeSessionListener = () => {
    sessionLoadSeq += 1
    sessionSubscriptions.remove()
    operations.cleanup()
  }

  const updateCurrentChatSession = (sessionInfo = {}) => {
    if (!sessionInfo.contactId) return

    const session = chatSessionList.value.find((item) => item.contactId == sessionInfo.contactId)
    if (session) Object.assign(session, sessionInfo)
    if (currentChatSession.value.contactId == sessionInfo.contactId) {
      currentChatSession.value = Object.assign({}, currentChatSession.value, sessionInfo)
    }
    sortChatSessionList(chatSessionList.value)
  }

  const setTop = (data) => {
    operations.setChatSessionTop(data.contactId, data.topType == 0 ? 1 : 0)
  }

  const onContextmenu = (data, event) => {
    event.preventDefault()
    ContextMenu.showContextMenu({
      x: event.x,
      y: event.y,
      items: [
        {
          label: data.topType == 0 ? '置顶' : '取消置顶',
          onClick: () => setTop(data)
        },
        {
          label: '删除聊天',
          onClick: () => {
            proxy.Confirm({
              message: '确认删除吗？',
              okfun: () => operations.deleteChatSession(data.contactId)
            })
          }
        }
      ]
    })
  }

  return {
    chatSessionList,
    currentChatSession,
    currentChatSessionTitle,
    hasCurrentChat,
    loadChatSession,
    markSessionRead: operations.markSessionRead,
    onContextmenu,
    openChatFromRoute,
    patchChatSessions,
    registerSessionListener,
    removeSessionListener,
    setChatSessionTop: operations.setChatSessionTop,
    setSessionSelector,
    updateCurrentChatSession,
    welcomeText
  }
}
