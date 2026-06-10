import { computed, ref } from 'vue'
import ContextMenu from '@imengyu/vue3-context-menu'

/**
 * 聊天会话列表和当前会话壳状态的管理入口。
 *
 * 负责本地会话补全、路由打开聊天、未读/置顶/删除更新，
 * 以及让 renderer 会话状态和主进程 IPC 回包保持同步。
 */
export const useChatSessions = ({ proxy, route }) => {
  const chatSessionList = ref([])
  const currentChatSession = ref({})
  // Chat.vue 注入真正的选中会话处理函数；这里保持会话模块和消息模块解耦。
  let selectSession = () => {}
  let loadSessionDataHandler = null
  let markSessionReadHandler = null
  // 标记已读的待确认操作映射：contactId → { previousNoReadCount, timeoutTimer }
  const pendingReadMap = new Map()

  const hasCurrentChat = computed(() => Object.keys(currentChatSession.value).length > 0)

  const getRealSessionName = (session = {}) => {
    const realName = session.contactName || session.groupName || session.nickName || ''
    if (realName && realName != session.contactId) {
      return realName
    }
    return ''
  }

  const getSessionName = (session = {}) => {
    return getRealSessionName(session) || session.contactId || ''
  }

  const currentChatSessionTitle = computed(() => {
    return getSessionName(currentChatSession.value)
  })

  const welcomeText = computed(() => {
    if (currentChatSession.value.contactType == 1) {
      return `${currentChatSessionTitle.value} 已创建好，快来开始群聊吧`
    }
    return `欢迎和 ${currentChatSessionTitle.value || ''} 开始聊天`
  })

  const setSessionSelector = (handler) => {
    selectSession = handler
  }

  const loadChatSession = () => {
    window.electron.ipcRenderer.send('loadSessionData')
  }

  const sortChatSessionList = (dataList) => {
    dataList.sort((a, b) => {
      const topTypeResult = b.topType - a.topType
      if (topTypeResult == 0) {
        return b.lastReceiveTime - a.lastReceiveTime
      }
      return topTypeResult
    })
  }

  const delChatSessionList = (contactId) => {
    chatSessionList.value = chatSessionList.value.filter((item) => {
      return item.contactId != contactId
    })
  }

  const getContactTypeValue = (type) => {
    if (type === 'GROUP' || type == 1) {
      return 1
    }
    return 0
  }

  const getSessionInfoFromServer = async (contactId, contactType) => {
    if (!contactId) {
      return {}
    }

    // 路由直达聊天时本地可能还没有完整会话名，需要按会话类型回源补齐展示信息。
    if (contactType == 1) {
      const result = await proxy.Request({
        url: proxy.Api.getGroupInfo,
        params: {
          groupId: contactId
        },
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
      params: {
        contactId
      },
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
    if (!session?.contactId) {
      return session
    }
    // 单聊已有真实名称时直接复用；群聊经常需要刷新 memberCount/groupName。
    if (session.contactType != 1 && getRealSessionName(session)) {
      return session
    }
    const serverInfo = await getSessionInfoFromServer(session.contactId, session.contactType)
    return Object.assign({}, session, serverInfo, {
      contactName: serverInfo.contactName || session.contactName
    })
  }

  const syncCurrentSession = (session) => {
    if (currentChatSession.value.contactId == session.contactId) {
      currentChatSession.value = Object.assign({}, currentChatSession.value, session)
    }
  }

  const hydrateSessionList = async (dataList = []) => {
    const hydratedList = await Promise.all(dataList.map(fillSessionName))
    hydratedList.forEach(syncCurrentSession)
    return hydratedList
  }

  const openChatFromRoute = async () => {
    const chatId = route.query.chatId
    if (!chatId) {
      return
    }

    // 联系人/群详情页跳转到 /chat?chatId=... 时，优先复用本地会话，否则临时创建会话壳。
    const contactType = getContactTypeValue(route.query.type)
    let session = chatSessionList.value.find((item) => item.contactId == chatId)
    if (session) {
      if (route.query.contactName && (session.contactType == 1 || !getRealSessionName(session))) {
        session = Object.assign({}, session, {
          contactName: route.query.contactName,
          memberCount: route.query.memberCount || session.memberCount
        })
      }
      session = await fillSessionName(session)
      const index = chatSessionList.value.findIndex((item) => item.contactId == chatId)
      if (index !== -1) {
        chatSessionList.value[index] = session
      }
      selectSession(session)
      return
    }

    const serverInfo = await getSessionInfoFromServer(chatId, contactType)
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

  const registerSessionListener = () => {
    removeSessionListener()

    loadSessionDataHandler = async (e, dataList) => {
      if (dataList && !Array.isArray(dataList) && dataList.success === false) {
        proxy.Message.error(dataList.error || 'Load sessions failed')
        return
      }
      // 主进程返回的是本地 SQLite 会话列表；renderer 补齐名称后再排序展示。
      const hydratedList = await hydrateSessionList(dataList || [])
      sortChatSessionList(hydratedList)
      chatSessionList.value = hydratedList
      openChatFromRoute()
    }
    window.electron.ipcRenderer.on('loadSessionDataCallback', loadSessionDataHandler)

    // 单一定时监听器：用 pendingReadMap 匹配 contactId，避免 O(n²) 链式重注册。
    markSessionReadHandler = (e, data = {}) => {
      const contactId = data?.contactId
      if (!contactId) return

      const entry = pendingReadMap.get(contactId)
      if (!entry) return

      clearTimeout(entry.timeoutTimer)
      pendingReadMap.delete(contactId)

      if (!data?.success && typeof entry.restoreNoReadCount === 'function') {
        entry.restoreNoReadCount()
      }
    }
    window.electron.ipcRenderer.on('markSessionReadCallback', markSessionReadHandler)
  }

  const removeSessionListener = () => {
    if (loadSessionDataHandler) {
      window.electron.ipcRenderer.removeListener('loadSessionDataCallback', loadSessionDataHandler)
      loadSessionDataHandler = null
    }
    if (markSessionReadHandler) {
      window.electron.ipcRenderer.removeListener('markSessionReadCallback', markSessionReadHandler)
      markSessionReadHandler = null
    }
    // 清理所有未完成的标记操作。
    pendingReadMap.forEach((entry) => {
      clearTimeout(entry.timeoutTimer)
    })
    pendingReadMap.clear()
  }

  const setChatSessionTop = (contactId, topType) => {
    // 置顶先乐观更新本地列表，再通知主进程持久化，保证右键菜单反馈及时。
    const session = chatSessionList.value.find((item) => item.contactId == contactId)
    if (session) {
      session.topType = topType
    }
    if (currentChatSession.value.contactId == contactId) {
      currentChatSession.value = Object.assign({}, currentChatSession.value, {
        topType
      })
    }
    sortChatSessionList(chatSessionList.value)
    window.electron.ipcRenderer.send('topChatSession', { contactId, topType })
  }

  const updateCurrentChatSession = (sessionInfo = {}) => {
    if (!sessionInfo.contactId) {
      return
    }

    // 抽屉里的群资料变更会回写当前会话，同时保持左侧列表排序规则一致。
    const session = chatSessionList.value.find((item) => item.contactId == sessionInfo.contactId)
    if (session) {
      Object.assign(session, sessionInfo)
    }
    if (currentChatSession.value.contactId == sessionInfo.contactId) {
      currentChatSession.value = Object.assign({}, currentChatSession.value, sessionInfo)
    }
    sortChatSessionList(chatSessionList.value)
  }

  const patchChatSessions = (sessions = [], { readContactIds = [] } = {}) => {
    const readContactIdSet = new Set(readContactIds.map((item) => String(item)))
    const sessionList = Array.isArray(sessions) ? sessions : []
    const patchedGeneration = ++_patchReadGeneration

    sessionList.forEach((rawSession = {}) => {
      if (!rawSession.contactId) {
        return
      }

      const { noReadCountDelta = 0, ...sessionInfo } = rawSession
      const contactId = String(sessionInfo.contactId)
      const index = chatSessionList.value.findIndex((item) => {
        return String(item.contactId) === contactId
      })
      const previous = index >= 0 ? chatSessionList.value[index] : {}
      const nextSession = Object.assign({}, previous, sessionInfo, {
        status: sessionInfo.status ?? previous.status ?? 1
      })

      if (readContactIdSet.has(contactId)) {
        nextSession.noReadCount = 0
      } else if (Number(noReadCountDelta) > 0) {
        nextSession.noReadCount = Number(previous.noReadCount || 0) + Number(noReadCountDelta)
      } else if (sessionInfo.noReadCount == null && previous.noReadCount != null) {
        nextSession.noReadCount = previous.noReadCount
      }

      // 外部推送更新未读数时打上新的 generation，防止 markSessionRead 超时回滚覆写
      if (nextSession.noReadCount !== previous.noReadCount) {
        nextSession._readGeneration = patchedGeneration
      }

      if (index >= 0) {
        chatSessionList.value[index] = nextSession
      } else {
        chatSessionList.value.unshift(nextSession)
      }
      syncCurrentSession(nextSession)
    })

    sortChatSessionList(chatSessionList.value)
  }

  let _readGeneration = 0
  let _patchReadGeneration = 0

  const markSessionRead = (contactId) => {
    if (!contactId) {
      return
    }

    // 已读状态乐观更新：先清零内存中的未读数再通知主进程落盘。
    const session = chatSessionList.value.find((item) => item.contactId == contactId)
    const previousNoReadCount = session ? session.noReadCount : 0
    const markGeneration = ++_readGeneration
    if (session) {
      session.noReadCount = 0
      session._readGeneration = markGeneration
    }
    if (currentChatSession.value.contactId == contactId) {
      currentChatSession.value = Object.assign({}, currentChatSession.value, {
        noReadCount: 0,
        _readGeneration: markGeneration
      })
    }

    const restoreNoReadCount = () => {
      const targetSession = chatSessionList.value.find((item) => item.contactId == contactId)
      // 使用 generation 替代 noReadCount===0 判断：仅在 5s 内未被 patchChatSessions
      // 或再次 markSessionRead 更新过时才回滚，防止覆盖外部推送的最新未读数。
      if (targetSession && targetSession._readGeneration === markGeneration) {
        targetSession.noReadCount = previousNoReadCount
      }
      if (
        currentChatSession.value.contactId == contactId &&
        currentChatSession.value._readGeneration === markGeneration
      ) {
        currentChatSession.value = Object.assign({}, currentChatSession.value, {
          noReadCount: previousNoReadCount
        })
      }
    }

    // 清除该 contactId 之前未完成的标记操作（避免重复计时器堆积）。
    const previousEntry = pendingReadMap.get(contactId)
    if (previousEntry) {
      clearTimeout(previousEntry.timeoutTimer)
      pendingReadMap.delete(contactId)
    }

    const timeoutTimer = setTimeout(() => {
      pendingReadMap.delete(contactId)
      restoreNoReadCount()
    }, 5000)

    pendingReadMap.set(contactId, {
      previousNoReadCount,
      timeoutTimer,
      restoreNoReadCount
    })

    window.electron.ipcRenderer.send('markSessionRead', contactId)
  }

  const setTop = (data) => {
    setChatSessionTop(data.contactId, data.topType == 0 ? 1 : 0)
  }

  const delChatSession = (contactId) => {
    // 删除会话只是隐藏会话入口，消息记录仍由清空记录链路单独处理。
    delChatSessionList(contactId)
    if (currentChatSession.value.contactId == contactId) {
      currentChatSession.value = {}
    }
    window.electron.ipcRenderer.send('delChatSession', contactId)
  }

  const onContextmenu = (data, e) => {
    e.preventDefault()
    ContextMenu.showContextMenu({
      x: e.x,
      y: e.y,
      items: [
        {
          label: data.topType == 0 ? '置顶' : '取消置顶',
          onClick: () => {
            setTop(data)
          }
        },
        {
          label: '删除聊天',
          onClick: () => {
            proxy.Confirm({
              message: '确认删除吗？',
              okfun: () => {
                delChatSession(data.contactId)
              }
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
    markSessionRead,
    onContextmenu,
    openChatFromRoute,
    patchChatSessions,
    registerSessionListener,
    removeSessionListener,
    setChatSessionTop,
    setSessionSelector,
    updateCurrentChatSession,
    welcomeText
  }
}
