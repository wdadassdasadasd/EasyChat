import { computed, nextTick, ref } from 'vue'
import ContextMenu from '@imengyu/vue3-context-menu'
import { markPerformance } from '@/utils/performanceMetrics'

/** @internal Session-domain subscription registry; exposed only for focused tests. */
export const createSubscriptionRegistry = () => {
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

/** Internal optimistic-operation state for the session owner. */
export const createSessionOperationController = ({
  chatSessionList,
  currentChatSession,
  proxy,
  sortChatSessionList
}) => {
  const pendingReadMap = new Map()
  const pendingTopMap = new Map()
  const pendingDeleteMap = new Map()
  let readGeneration = 0
  let patchReadGeneration = 0

  const applySessionTopType = (contactId, topType) => {
    const session = chatSessionList.value.find((item) => item.contactId == contactId)
    if (session) session.topType = topType
    if (currentChatSession.value.contactId == contactId) {
      currentChatSession.value = Object.assign({}, currentChatSession.value, { topType })
    }
    sortChatSessionList(chatSessionList.value)
  }

  const setChatSessionTop = (contactId, topType) => {
    const pendingTopSession = chatSessionList.value.find((item) => item.contactId == contactId)
    const previousTopType =
      pendingTopSession?.topType ??
      (currentChatSession.value.contactId == contactId ? currentChatSession.value.topType : 0) ??
      0
    const previousEntry = pendingTopMap.get(contactId)
    if (previousEntry) {
      clearTimeout(previousEntry.timeoutTimer)
      pendingTopMap.delete(contactId)
    }

    applySessionTopType(contactId, topType)
    const rollback = () => {
      applySessionTopType(contactId, previousTopType)
      proxy.Message.error('会话置顶保存失败，已恢复。')
    }
    const entry = { requestedTopType: topType, rollback, timeoutTimer: null }
    entry.timeoutTimer = setTimeout(() => {
      if (pendingTopMap.get(contactId) !== entry) return
      pendingTopMap.delete(contactId)
      rollback()
    }, 5000)
    pendingTopMap.set(contactId, entry)
    window.api.sendTopChatSession({ contactId, topType })
  }

  const markSessionRead = (contactId) => {
    if (!contactId) return
    const contactKey = String(contactId)
    const session = chatSessionList.value.find((item) => String(item.contactId) === contactKey)
    const previousNoReadCount = Number(session?.noReadCount || 0)
    const markGeneration = `read-${++readGeneration}`
    const operationId = `${markGeneration}-${Date.now()}`
    if (session) {
      session.noReadCount = 0
      session._readGeneration = markGeneration
    }
    if (String(currentChatSession.value.contactId || '') === contactKey) {
      currentChatSession.value = Object.assign({}, currentChatSession.value, {
        noReadCount: 0,
        _readGeneration: markGeneration
      })
    }

    const restoreNoReadCount = () => {
      const entry = pendingReadMap.get(contactKey)
      if (!entry || entry.operationId !== operationId || entry.hasAuthoritativePatch) return
      const restoredNoReadCount = entry.previousNoReadCount + entry.receivedDelta
      const targetSession = chatSessionList.value.find(
        (item) => String(item.contactId) === contactKey
      )
      if (targetSession) targetSession.noReadCount = restoredNoReadCount
      if (String(currentChatSession.value.contactId || '') === contactKey) {
        currentChatSession.value = Object.assign({}, currentChatSession.value, {
          noReadCount: restoredNoReadCount
        })
      }
    }

    const previousEntry = pendingReadMap.get(contactKey)
    if (previousEntry) {
      clearTimeout(previousEntry.timeoutTimer)
      pendingReadMap.delete(contactKey)
    }
    const entry = {
      operationId,
      previousNoReadCount,
      receivedDelta: 0,
      hasAuthoritativePatch: false,
      timeoutTimer: null,
      restoreNoReadCount
    }
    entry.timeoutTimer = setTimeout(() => {
      if (pendingReadMap.get(contactKey) !== entry) return
      restoreNoReadCount()
      pendingReadMap.delete(contactKey)
    }, 5000)
    pendingReadMap.set(contactKey, entry)
    window.api.sendMarkSessionRead({ contactId, operationId })
  }

  const deleteChatSession = (contactId) => {
    const contactKey = String(contactId)
    const sessionIndex = chatSessionList.value.findIndex(
      (item) => String(item.contactId) === contactKey
    )
    const sessionSnapshot = sessionIndex >= 0 ? { ...chatSessionList.value[sessionIndex] } : null
    const currentSnapshot =
      String(currentChatSession.value.contactId || '') === contactKey
        ? { ...currentChatSession.value }
        : null
    chatSessionList.value = chatSessionList.value.filter((item) => item.contactId != contactId)
    if (currentChatSession.value.contactId == contactId) currentChatSession.value = {}
    const rollback = () => {
      if (
        sessionSnapshot &&
        !chatSessionList.value.some((item) => String(item.contactId) === contactKey)
      ) {
        chatSessionList.value.splice(
          Math.min(sessionIndex, chatSessionList.value.length),
          0,
          sessionSnapshot
        )
        sortChatSessionList(chatSessionList.value)
      }
      if (currentSnapshot) currentChatSession.value = currentSnapshot
      proxy.Message.error('删除会话失败，已恢复。')
    }
    const entry = { rollback, timeoutTimer: null }
    entry.timeoutTimer = setTimeout(() => {
      if (pendingDeleteMap.get(contactKey) !== entry) return
      pendingDeleteMap.delete(contactKey)
      rollback()
    }, 5000)
    pendingDeleteMap.set(contactKey, entry)
    window.api.sendDelChatSession(contactId)
  }

  const reconcileUnreadPatch = ({
    contactId,
    noReadCountDelta,
    previous,
    readContactIdSet,
    sessionInfo,
    nextSession
  }) => {
    const pendingRead = pendingReadMap.get(contactId)
    if (readContactIdSet.has(contactId)) nextSession.noReadCount = 0
    else if (Number(noReadCountDelta) > 0) {
      nextSession.noReadCount = Number(previous.noReadCount || 0) + Number(noReadCountDelta)
      if (pendingRead) pendingRead.receivedDelta += Number(noReadCountDelta)
    } else if (sessionInfo.noReadCount == null && previous.noReadCount != null) {
      nextSession.noReadCount = previous.noReadCount
    } else if (
      sessionInfo.noReadCount === 0 &&
      Number(noReadCountDelta) === 0 &&
      !readContactIdSet.has(contactId) &&
      Number(previous.noReadCount || 0) > 0
    ) {
      nextSession.noReadCount = previous.noReadCount
    }
    if (pendingRead && sessionInfo.noReadCount != null && Number(noReadCountDelta) === 0) {
      pendingRead.hasAuthoritativePatch = true
    }
    if (nextSession.noReadCount !== previous.noReadCount) {
      nextSession._readGeneration = `patch-${++patchReadGeneration}`
    }
  }

  const handleDeleteAck = (data = {}) => {
    const contactId = String(data?.contactId || '')
    const entry = pendingDeleteMap.get(contactId)
    if (!contactId || !entry) return
    clearTimeout(entry.timeoutTimer)
    pendingDeleteMap.delete(contactId)
    if (!data.success) entry.rollback()
  }
  const handleReadAck = (data = {}) => {
    const contactId = String(data?.contactId || '')
    const entry = pendingReadMap.get(contactId)
    if (!contactId || !entry || data.operationId !== entry.operationId) return
    clearTimeout(entry.timeoutTimer)
    if (!data.success) entry.restoreNoReadCount()
    pendingReadMap.delete(contactId)
  }
  const handleTopAck = (data = {}) => {
    const contactId = data?.contactId
    const entry = pendingTopMap.get(contactId)
    if (!contactId || !entry || Number(data.topType) !== Number(entry.requestedTopType)) return
    clearTimeout(entry.timeoutTimer)
    pendingTopMap.delete(contactId)
    if (!data.success) entry.rollback()
  }
  const cleanup = () => {
    ;[pendingReadMap, pendingTopMap, pendingDeleteMap].forEach((pendingMap) => {
      pendingMap.forEach((entry) => clearTimeout(entry.timeoutTimer))
      pendingMap.clear()
    })
  }
  return {
    cleanup,
    deleteChatSession,
    handleDeleteAck,
    handleReadAck,
    handleTopAck,
    markSessionRead,
    reconcileUnreadPatch,
    setChatSessionTop
  }
}

/** Internal display-data resolver owned by the session state module. */
export const createSessionProfileResolver = ({ proxy }) => {
  const getContactTypeValue = (type) => (type === 'GROUP' || type == 1 ? 1 : 0)
  const getRealSessionName = (session = {}) => {
    const realName = session.contactName || session.groupName || session.nickName || ''
    return realName && realName != session.contactId ? realName : ''
  }
  const needsSessionProfile = (session = {}) =>
    Boolean(session?.contactId) &&
    (!getRealSessionName(session) || (session.contactType == 1 && session.memberCount == null))
  const getSessionInfoFromServer = async (contactId, contactType) => {
    if (!contactId) return {}
    if (contactType == 1) {
      const result = await proxy.Request({
        url: proxy.Api.getGroupInfo,
        params: { groupId: contactId },
        showLoading: false,
        showError: false
      })
      const groupInfo = result?.data?.groupInfo || result?.data?.group || result?.data || {}
      const groupName = groupInfo.groupName || result?.data?.groupName
      return {
        contactId,
        contactType,
        contactName: groupName,
        memberCount: groupInfo.memberCount,
        groupName
      }
    }
    const result = await proxy.Request({
      url: proxy.Api.getContactUserInfo,
      params: { contactId },
      showLoading: false,
      showError: false
    })
    const userInfo = result?.data || {}
    return {
      contactId,
      contactType,
      contactName: userInfo.contactName || userInfo.nickName,
      nickName: userInfo.nickName
    }
  }
  const fillSessionName = async (session) => {
    if (!session?.contactId || !needsSessionProfile(session)) return session
    const serverInfo = await getSessionInfoFromServer(session.contactId, session.contactType)
    return Object.assign({}, session, serverInfo, {
      contactName: serverInfo.contactName || session.contactName
    })
  }
  const hydrateSessionList = async (
    dataList = [],
    { concurrency = 4, onResolved = () => {}, shouldContinue = () => true } = {}
  ) => {
    const resolvedList = dataList.slice()
    const pendingIndexes = dataList
      .map((session, index) => (needsSessionProfile(session) ? index : -1))
      .filter((index) => index >= 0)
    let nextIndex = 0
    const workerCount = Math.min(Math.max(Number(concurrency) || 1, 1), pendingIndexes.length)
    const hydrateOne = async () => {
      while (nextIndex < pendingIndexes.length && shouldContinue()) {
        const sessionIndex = pendingIndexes[nextIndex++]
        try {
          const resolved = await fillSessionName(dataList[sessionIndex])
          if (!shouldContinue()) return
          resolvedList[sessionIndex] = resolved
          onResolved(resolved, sessionIndex)
        } catch (error) {
          console.warn('Failed to resolve chat session profile', error)
        }
      }
    }
    await Promise.all(Array.from({ length: workerCount }, hydrateOne))
    return resolvedList
  }
  return {
    fillSessionName,
    getContactTypeValue,
    getRealSessionName,
    getSessionInfoFromServer,
    hydrateSessionList,
    needsSessionProfile
  }
}

/** Internal session IPC subscription adapter. */
export const createSessionSubscriptionController = () => {
  const subscriptions = createSubscriptionRegistry()
  const register = ({ onDelete, onLoad, onMarkRead, onTop }) => {
    subscriptions.clear()
    subscriptions.replace('loadSessionData', () => window.api.onLoadSessionDataCallback(onLoad))
    subscriptions.replace('deleteChatSession', () => window.api.onDelChatSessionCallback(onDelete))
    subscriptions.replace('markSessionRead', () => window.api.onMarkSessionReadCallback(onMarkRead))
    subscriptions.replace('topChatSession', () => window.api.onTopChatSessionCallback(onTop))
  }
  return { register, remove: () => subscriptions.clear() }
}
