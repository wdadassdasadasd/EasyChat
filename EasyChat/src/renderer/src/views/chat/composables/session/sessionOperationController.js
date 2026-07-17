/**
 * Owns optimistic session mutations and their IPC acknowledgement lifecycle.
 */
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
    if (readContactIdSet.has(contactId)) {
      nextSession.noReadCount = 0
    } else if (Number(noReadCountDelta) > 0) {
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
