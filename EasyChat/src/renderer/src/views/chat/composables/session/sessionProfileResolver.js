/**
 * Resolves display data needed by the session list without owning list state.
 */
export const createSessionProfileResolver = ({ proxy }) => {
  const getContactTypeValue = (type) => (type === 'GROUP' || type == 1 ? 1 : 0)

  const getRealSessionName = (session = {}) => {
    const realName = session.contactName || session.groupName || session.nickName || ''
    return realName && realName != session.contactId ? realName : ''
  }

  const needsSessionProfile = (session = {}) => {
    if (!session?.contactId) return false
    if (!getRealSessionName(session)) return true
    return session.contactType == 1 && session.memberCount == null
  }

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
    if (!session?.contactId) return session
    if (!needsSessionProfile(session)) return session

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
        const sessionIndex = pendingIndexes[nextIndex]
        nextIndex += 1
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
