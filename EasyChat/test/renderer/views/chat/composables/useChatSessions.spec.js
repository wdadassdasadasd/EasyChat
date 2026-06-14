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

const createHarness = () => {
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
    route: {
      query: {}
    }
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
    expect(sessions.chatSessionList.value.find((item) => item.contactId === 'c1').noReadCount).toBe(0)

    handlers.markSessionReadCallback({ ...secondOperation, success: false })
    expect(sessions.chatSessionList.value.find((item) => item.contactId === 'c1').noReadCount).toBe(2)
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
})
