import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const useChatSessions = vi.fn()
const useChatMessages = vi.fn()
const useFileTransfer = vi.fn()

vi.mock('@/views/chat/composables/useChatSessions', () => ({ useChatSessions }))
vi.mock('@/views/chat/composables/useChatMessages', () => ({ useChatMessages }))
vi.mock('@/views/chat/composables/useFileTransfer', () => ({ useFileTransfer }))

let useChatPageController

describe('useChatPageController', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    ;({ useChatPageController } = await import(
      '@/views/chat/composables/useChatPageController'
    ))
  })

  it('registers child listeners before loading and releases every page owner on unmount', () => {
    const stops = { ws: vi.fn() }
    global.window = {
      api: {
        onWsStatusChange: vi.fn(() => stops.ws)
      }
    }
    const sessions = {
      chatSessionList: ref([{ noReadCount: 2 }]),
      currentChatSession: ref({ contactId: 'u2', sessionId: 's1' }),
      loadChatSession: vi.fn(),
      markSessionRead: vi.fn(),
      openChatFromRoute: vi.fn(),
      patchChatSessions: vi.fn(),
      registerSessionListener: vi.fn(),
      removeSessionListener: vi.fn(),
      setSessionSelector: vi.fn(),
      setChatSessionTop: vi.fn(),
      updateCurrentChatSession: vi.fn()
    }
    const messages = {
      chatSessionClickHandler: vi.fn(),
      clearCurrentMessages: vi.fn(),
      cleanupChatMessages: vi.fn(),
      loadChatMessage: vi.fn(),
      registerMessageListeners: vi.fn()
    }
    const files = { closeVideoPreviewDialog: vi.fn() }
    useChatSessions.mockReturnValue(sessions)
    useChatMessages.mockReturnValue(messages)
    useFileTransfer.mockReturnValue(files)

    const controller = useChatPageController({
      currentUserId: ref('u1'),
      messageListRef: ref(null),
      proxy: { Confirm: vi.fn(), Message: { error: vi.fn(), success: vi.fn() } },
      route: { query: {} }
    })
    controller.mount()
    controller.unmount()

    expect(sessions.setSessionSelector).toHaveBeenCalledWith(messages.chatSessionClickHandler)
    expect(messages.registerMessageListeners).toHaveBeenCalledBefore(sessions.loadChatSession)
    expect(sessions.registerSessionListener).toHaveBeenCalledBefore(sessions.loadChatSession)
    expect(stops.ws).toHaveBeenCalledTimes(1)
    expect(sessions.removeSessionListener).toHaveBeenCalledTimes(1)
    expect(messages.cleanupChatMessages).toHaveBeenCalledTimes(1)
    expect(files.closeVideoPreviewDialog).toHaveBeenCalledTimes(1)
  })
})
