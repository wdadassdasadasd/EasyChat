/**
 * Resolves display data needed by the session list without owning list state.
 */
export const createSessionProfileResolver = ({ proxy }) => {
  const getContactTypeValue = (type) => (type === 'GROUP' || type == 1 ? 1 : 0)

  const getRealSessionName = (session = {}) => {
    const realName = session.contactName || session.groupName || session.nickName || ''
    return realName && realName != session.contactId ? realName : ''
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
    if (session.contactType != 1 && getRealSessionName(session)) return session

    const serverInfo = await getSessionInfoFromServer(session.contactId, session.contactType)
    return Object.assign({}, session, serverInfo, {
      contactName: serverInfo.contactName || session.contactName
    })
  }

  const hydrateSessionList = async (dataList = []) => Promise.all(dataList.map(fillSessionName))

  return {
    fillSessionName,
    getContactTypeValue,
    getRealSessionName,
    getSessionInfoFromServer,
    hydrateSessionList
  }
}
