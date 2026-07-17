import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { showContextMenu } = vi.hoisted(() => ({
  showContextMenu: vi.fn()
}))

vi.mock('@imengyu/vue3-context-menu', () => ({
  default: {
    showContextMenu
  }
}))

let useChatSessions

const createHarness = ({ route = { query: {} } } = {}) => {
  const handlers = {}
  const sent = []
  const unsubscribeLoadSessionData = vi.fn(() => delete handlers.loadSessionDataCallback)
  const unsubscribeDeleteChatSession = vi.fn(() => delete handlers.delChatSessionCallback)
  const unsubscribeMarkSessionRead = vi.fn(() => delete handlers.markSessionReadCallback)
  const unsubscribeTopChatSession = vi.fn(() => delete handlers.topChatSessionCallback)
  global.window = {
    api: {
      onLoadSessionDataCallback: vi.fn((handler) => {
        handlers.loadSessionDataCallback = handler
        return unsubscribeLoadSessionData
      }),
      onDelChatSessionCallback: vi.fn((handler) => {
        handlers.delChatSessionCallback = handler
        return unsubscribeDeleteChatSession
      }),
      onMarkSessionReadCallback: vi.fn((handler) => {
        handlers.markSessionReadCallback = handler
        return unsubscribeMarkSessionRead
      }),
      onTopChatSessionCallback: vi.fn((handler) => {
        handlers.topChatSessionCallback = handler
        return unsubscribeTopChatSession
      }),
      unsubscribeLoadSessionData,
      unsubscribeDeleteChatSession,
      unsubscribeMarkSessionRead,
      unsubscribeTopChatSession,
      sendMarkSessionRead: vi.fn((data) => {
        sent.push({ method: 'sendMarkSessionRead', data })
      }),
      sendDelChatSession: vi.fn((contactId) => {
        sent.push({ method: 'sendDelChatSession', data: { contactId } })
      }),
      sendTopChatSession: vi.fn((data) => {
        sent.push({ method: 'sendTopChatSession', data })
      })
    }
  }

  const proxy = {
    Request: vi.fn(async () => ({ data: {} })),
    Api: {
      getContactUserInfo: '/contact/getContactUserInfo',
      getGroupInfo: '/group/getGroupInfo'
    },
    Message: {
      error: vi.fn()
    },
    Confirm: vi.fn()
  }
  const sessions = useChatSessions({
    proxy,
    route
  })

  sessions.chatSessionList.value = [
    {
      contactId: 'c1',
      contactType: 0,
      sessionId: 's1',
      lastReceiveTime: 100,
      noReadCount: 3,
      topType: 0,
      status: 1
    },
    {
      contactId: 'c2',
      contactType: 0,
      sessionId: 's2',
      lastReceiveTime: 200,
      noReadCount: 0,
      topType: 0,
      status: 1
    }
  ]
  sessions.currentChatSession.value = sessions.chatSessionList.value[0]

  return {
    api: global.window.api,
    handlers,
    proxy,
    sent,
    sessions
  }
}

describe('useChatSessions', () => {
  beforeAll(async () => {
    ;({ useChatSessions } = await import('@/views/chat/composables/useChatSessions'))
  })

  beforeEach(() => {
    vi.useFakeTimers()
    showContextMenu.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    delete global.window
  })

  it('keeps optimistic unread clear when markSessionRead succeeds', () => {
    const { handlers, sent, sessions } = createHarness()
    sessions.registerSessionListener()

    sessions.markSessionRead('c1')
    expect(sessions.chatSessionList.value[0].noReadCount).toBe(0)

    handlers.markSessionReadCallback({ ...sent.at(-1).data, success: true })
    vi.advanceTimersByTime(5000)

    expect(sessions.chatSessionList.value[0].noReadCount).toBe(0)
  })

  it('rolls unread count back when markSessionRead fails', () => {
    const { handlers, sent, sessions } = createHarness()
    sessions.registerSessionListener()

    sessions.markSessionRead('c1')
    handlers.markSessionReadCallback({ ...sent.at(-1).data, success: false })

    expect(sessions.chatSessionList.value[0].noReadCount).toBe(3)
  })

  it('restores previous unread plus messages received during a failed operation', () => {
    const { handlers, sent, sessions } = createHarness()
    sessions.registerSessionListener()

    sessions.markSessionRead('c1')
    sessions.patchChatSessions([{ contactId: 'c1', noReadCountDelta: 2 }])
    handlers.markSessionReadCallback({ ...sent.at(-1).data, success: false })

    expect(sessions.chatSessionList.value.find((item) => item.contactId === 'c1').noReadCount).toBe(
      5
    )
  })

  it('ignores an older callback after a newer mark-read operation starts', () => {
    const { handlers, sent, sessions } = createHarness()
    sessions.registerSessionListener()

    sessions.markSessionRead('c1')
    const firstOperation = sent.at(-1).data
    sessions.patchChatSessions([{ contactId: 'c1', noReadCountDelta: 2 }])
    sessions.markSessionRead('c1')
    const secondOperation = sent.at(-1).data

    handlers.markSessionReadCallback({ ...firstOperation, success: false })
    expect(sessions.chatSessionList.value.find((item) => item.contactId === 'c1').noReadCount).toBe(
      0
    )

    handlers.markSessionReadCallback({ ...secondOperation, success: false })
    expect(sessions.chatSessionList.value.find((item) => item.contactId === 'c1').noReadCount).toBe(
      2
    )
  })

  it('keeps optimistic top state when topChatSession succeeds', () => {
    const { handlers, sessions } = createHarness()
    sessions.registerSessionListener()

    sessions.setChatSessionTop('c1', 1)
    handlers.topChatSessionCallback({ contactId: 'c1', topType: 1, success: true })
    vi.advanceTimersByTime(5000)

    expect(sessions.chatSessionList.value.find((item) => item.contactId === 'c1').topType).toBe(1)
  })

  it('rolls top state back when topChatSession fails', () => {
    const { handlers, proxy, sessions } = createHarness()
    sessions.registerSessionListener()

    sessions.setChatSessionTop('c1', 1)
    handlers.topChatSessionCallback({ contactId: 'c1', topType: 1, success: false })

    expect(sessions.chatSessionList.value.find((item) => item.contactId === 'c1').topType).toBe(0)
    expect(proxy.Message.error).toHaveBeenCalled()
  })

  it('rolls top state back when topChatSession has no callback', () => {
    const { proxy, sessions } = createHarness()
    sessions.registerSessionListener()

    sessions.setChatSessionTop('c1', 1)
    vi.advanceTimersByTime(5000)

    expect(sessions.chatSessionList.value.find((item) => item.contactId === 'c1').topType).toBe(0)
    expect(proxy.Message.error).toHaveBeenCalled()
  })

  it('restores an optimistically deleted session when persistence fails', () => {
    const { handlers, proxy, sessions } = createHarness()
    sessions.registerSessionListener()

    sessions.onContextmenu(sessions.chatSessionList.value[0], {
      preventDefault: vi.fn(),
      x: 10,
      y: 20
    })
    const deleteAction = showContextMenu.mock.calls.at(-1)[0].items[1]
    deleteAction.onClick()
    proxy.Confirm.mock.calls.at(-1)[0].okfun()

    expect(sessions.chatSessionList.value.some((item) => item.contactId === 'c1')).toBe(false)
    expect(sessions.currentChatSession.value).toEqual({})

    handlers.delChatSessionCallback({ contactId: 'c1', success: false })

    expect(sessions.chatSessionList.value.some((item) => item.contactId === 'c1')).toBe(true)
    expect(sessions.currentChatSession.value.contactId).toBe('c1')
    expect(proxy.Message.error).toHaveBeenCalledWith('删除会话失败，已恢复。')
  })

  it('removes registered listeners and clears pending timers', () => {
    const { api, handlers, proxy, sessions } = createHarness()
    sessions.registerSessionListener()
    sessions.markSessionRead('c1')
    sessions.setChatSessionTop('c1', 1)

    sessions.removeSessionListener()
    vi.advanceTimersByTime(5000)

    expect(Object.keys(handlers)).toEqual([])
    expect(api.unsubscribeTopChatSession).toHaveBeenCalled()
    expect(api.unsubscribeDeleteChatSession).toHaveBeenCalled()
    expect(sessions.chatSessionList.value.find((item) => item.contactId === 'c1').topType).toBe(1)
    expect(proxy.Message.error).not.toHaveBeenCalled()
  })

  it('creates and selects a route-only group session after profile resolution', async () => {
    const route = { query: { chatId: 'g1', type: 'GROUP' } }
    const { proxy, sessions } = createHarness({ route })
    const selectSession = vi.fn()
    sessions.setSessionSelector(selectSession)
    proxy.Request.mockResolvedValueOnce({
      data: { groupInfo: { groupName: '项目群', memberCount: 8 } }
    })

    await sessions.openChatFromRoute()

    expect(sessions.chatSessionList.value[0]).toMatchObject({
      contactId: 'g1',
      contactType: 1,
      contactName: '项目群',
      memberCount: 8,
      noReadCount: 0
    })
    expect(selectSession).toHaveBeenCalledWith(sessions.chatSessionList.value[0])
  })

  describe('patchChatSessions unread count', () => {
    it('increments noReadCount for existing session via noReadCountDelta', () => {
      const { sessions } = createHarness()
      // c1 starts with noReadCount=3
      sessions.patchChatSessions([{ contactId: 'c1', noReadCountDelta: 2 }])
      expect(sessions.chatSessionList.value.find((s) => s.contactId === 'c1').noReadCount).toBe(5)
    })

    it('creates new session with noReadCount equal to delta', () => {
      const { sessions } = createHarness()
      sessions.patchChatSessions([{ contactId: 'c3', noReadCountDelta: 3, lastReceiveTime: 300 }])
      const created = sessions.chatSessionList.value.find((s) => s.contactId === 'c3')
      expect(created).toBeTruthy()
      expect(created.noReadCount).toBe(3)
    })

    it('zeros noReadCount when contactId is in readContactIds', () => {
      const { sessions } = createHarness()
      // c1 has noReadCount=3, should be zeroed regardless of delta
      sessions.patchChatSessions([{ contactId: 'c1', noReadCountDelta: 2 }], {
        readContactIds: ['c1']
      })
      expect(sessions.chatSessionList.value.find((s) => s.contactId === 'c1').noReadCount).toBe(0)
    })

    it('preserves positive noReadCount when explicit noReadCount=0 arrives without readContext', () => {
      const { sessions } = createHarness()
      // c1 has noReadCount=3, explicit noReadCount=0 should not overwrite it
      // because there is no readContactIds and noReadCountDelta is 0 (default)
      sessions.patchChatSessions([{ contactId: 'c1', noReadCount: 0 }])
      expect(sessions.chatSessionList.value.find((s) => s.contactId === 'c1').noReadCount).toBe(3)
    })

    it('allows noReadCount=0 to pass through when memory also has 0', () => {
      const { sessions } = createHarness()
      // c2 has noReadCount=0, explicit noReadCount=0 should stay 0
      sessions.patchChatSessions([{ contactId: 'c2', noReadCount: 0 }])
      expect(sessions.chatSessionList.value.find((s) => s.contactId === 'c2').noReadCount).toBe(0)
    })
  })

  describe('loadSessionDataHandler merge', () => {
    it('uses DB noReadCount when it is higher than memory', async () => {
      const { handlers, sessions } = createHarness()
      sessions.registerSessionListener()
      // Memory: c1 has noReadCount=3, DB returns 10 -- should use 10
      await handlers.loadSessionDataCallback([
        {
          contactId: 'c1',
          contactType: 0,
          contactName: 'TestUser',
          sessionId: 's1',
          noReadCount: 10,
          lastReceiveTime: 200,
          status: 1
        }
      ])
      expect(sessions.chatSessionList.value.find((s) => s.contactId === 'c1').noReadCount).toBe(10)
    })

    it('keeps memory noReadCount when it is higher than DB', async () => {
      const { handlers, sessions } = createHarness()
      sessions.registerSessionListener()
      // Bump memory to 7 via patchChatSessions
      sessions.patchChatSessions([{ contactId: 'c1', noReadCountDelta: 4 }])
      // DB returns stale value 3
      await handlers.loadSessionDataCallback([
        {
          contactId: 'c1',
          contactType: 0,
          contactName: 'TestUser',
          sessionId: 's1',
          noReadCount: 3,
          lastReceiveTime: 200,
          status: 1
        }
      ])
      expect(sessions.chatSessionList.value.find((s) => s.contactId === 'c1').noReadCount).toBe(7)
    })

    it('adds new DB sessions not present in memory', async () => {
      const { handlers, sessions } = createHarness()
      sessions.registerSessionListener()
      await handlers.loadSessionDataCallback([
        {
          contactId: 'c3',
          contactType: 0,
          contactName: 'NewUser',
          sessionId: 's3',
          noReadCount: 7,
          lastReceiveTime: 300,
          status: 1
        }
      ])
      expect(sessions.chatSessionList.value.find((s) => s.contactId === 'c3').noReadCount).toBe(7)
    })

    it('preserves memory-only sessions absent from DB', async () => {
      const { handlers, sessions } = createHarness()
      sessions.registerSessionListener()
      // Add a session only in memory
      sessions.chatSessionList.value.unshift({
        contactId: 'c3',
        contactType: 0,
        contactName: 'MemOnly',
        noReadCount: 2,
        status: 1,
        lastReceiveTime: 100
      })
      // DB only returns c1
      await handlers.loadSessionDataCallback([
        {
          contactId: 'c1',
          contactType: 0,
          contactName: 'TestUser',
          sessionId: 's1',
          noReadCount: 3,
          lastReceiveTime: 200,
          status: 1
        }
      ])
      expect(sessions.chatSessionList.value.find((s) => s.contactId === 'c3')).toBeTruthy()
      expect(sessions.chatSessionList.value.find((s) => s.contactId === 'c3').noReadCount).toBe(2)
    })
  })
})
