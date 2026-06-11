import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@imengyu/vue3-context-menu', () => ({
  default: {
    showContextMenu: vi.fn()
  }
}))

let useChatSessions

const createHarness = () => {
  const handlers = {}
  const sent = []
  global.window = {
    electron: {
      ipcRenderer: {
        on: vi.fn((channel, handler) => {
          handlers[channel] = handler
        }),
        removeListener: vi.fn((channel, handler) => {
          if (handlers[channel] === handler) {
            delete handlers[channel]
          }
        }),
        send: vi.fn((channel, payload) => {
          sent.push({ channel, payload })
        })
      }
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
    handlers,
    ipcRenderer: global.window.electron.ipcRenderer,
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
  })

  afterEach(() => {
    vi.useRealTimers()
    delete global.window
  })

  it('keeps optimistic unread clear when markSessionRead succeeds', () => {
    const { handlers, sessions } = createHarness()
    sessions.registerSessionListener()

    sessions.markSessionRead('c1')
    expect(sessions.chatSessionList.value[0].noReadCount).toBe(0)

    handlers.markSessionReadCallback({}, { contactId: 'c1', success: true })
    vi.advanceTimersByTime(5000)

    expect(sessions.chatSessionList.value[0].noReadCount).toBe(0)
  })

  it('rolls unread count back when markSessionRead fails', () => {
    const { handlers, sessions } = createHarness()
    sessions.registerSessionListener()

    sessions.markSessionRead('c1')
    handlers.markSessionReadCallback({}, { contactId: 'c1', success: false })

    expect(sessions.chatSessionList.value[0].noReadCount).toBe(3)
  })

  it('does not overwrite new unread patch when markSessionRead later fails', () => {
    const { handlers, sessions } = createHarness()
    sessions.registerSessionListener()

    sessions.markSessionRead('c1')
    sessions.patchChatSessions([{ contactId: 'c1', noReadCountDelta: 2 }])
    handlers.markSessionReadCallback({}, { contactId: 'c1', success: false })

    expect(sessions.chatSessionList.value.find((item) => item.contactId === 'c1').noReadCount).toBe(2)
  })

  it('keeps optimistic top state when topChatSession succeeds', () => {
    const { handlers, sessions } = createHarness()
    sessions.registerSessionListener()

    sessions.setChatSessionTop('c1', 1)
    handlers.topChatSessionCallback({}, { contactId: 'c1', topType: 1, success: true })
    vi.advanceTimersByTime(5000)

    expect(sessions.chatSessionList.value.find((item) => item.contactId === 'c1').topType).toBe(1)
  })

  it('rolls top state back when topChatSession fails', () => {
    const { handlers, proxy, sessions } = createHarness()
    sessions.registerSessionListener()

    sessions.setChatSessionTop('c1', 1)
    handlers.topChatSessionCallback({}, { contactId: 'c1', topType: 1, success: false })

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

  it('removes registered listeners and clears pending timers', () => {
    const { handlers, ipcRenderer, proxy, sessions } = createHarness()
    sessions.registerSessionListener()
    sessions.markSessionRead('c1')
    sessions.setChatSessionTop('c1', 1)

    sessions.removeSessionListener()
    vi.advanceTimersByTime(5000)

    expect(Object.keys(handlers)).toEqual([])
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      'topChatSessionCallback',
      expect.any(Function)
    )
    expect(sessions.chatSessionList.value.find((item) => item.contactId === 'c1').topType).toBe(1)
    expect(proxy.Message.error).not.toHaveBeenCalled()
  })
})
