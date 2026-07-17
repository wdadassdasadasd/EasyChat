import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useUserChatDrawer } from '@/views/chat/composables/useUserChatDrawer'

const createHarness = (session = {}) => {
  const currentChatSession = ref({
    contactId: 'u1',
    contactName: 'Alice',
    contactType: 0,
    ...session
  })
  const proxy = {
    Api: { getContactUserInfo: '/contact/info' },
    Request: vi.fn()
  }
  return {
    currentChatSession,
    drawer: useUserChatDrawer({ currentChatSession, proxy }),
    proxy
  }
}

describe('useUserChatDrawer', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('only opens for direct chats and loads the current contact profile', async () => {
    const { currentChatSession, drawer, proxy } = createHarness({ contactType: 1 })

    await drawer.openDrawer()

    expect(drawer.visible.value).toBe(false)
    expect(proxy.Request).not.toHaveBeenCalled()

    currentChatSession.value = { contactId: 'u1', contactName: 'Alice', contactType: 0 }
    proxy.Request.mockResolvedValue({ data: { userId: 'u1', nickName: 'Alice 完整资料' } })

    await drawer.openDrawer()

    expect(drawer.visible.value).toBe(true)
    expect(drawer.userInfo.value).toEqual({ userId: 'u1', nickName: 'Alice 完整资料' })
  })

  it('clears the previous profile and ignores a stale contact response', async () => {
    const { currentChatSession, drawer, proxy } = createHarness()
    let resolveFirst
    let resolveSecond
    proxy.Request
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve
          })
      )

    const firstLoad = drawer.openDrawer()
    currentChatSession.value = { contactId: 'u2', contactName: 'Bob', contactType: 0 }
    const secondLoad = drawer.syncVisible(true)
    expect(drawer.userInfo.value).toEqual({})
    resolveSecond({ data: { userId: 'u2', nickName: 'Bob 完整资料' } })
    await secondLoad
    resolveFirst({ data: { userId: 'u1', nickName: 'Alice 旧资料' } })
    await firstLoad

    expect(drawer.userInfo.value).toEqual({ userId: 'u2', nickName: 'Bob 完整资料' })
  })

  it('uses the current session as a fallback when loading fails', async () => {
    const { drawer, proxy } = createHarness()
    proxy.Request.mockRejectedValue(new Error('offline'))

    await drawer.openDrawer()

    expect(drawer.userInfo.value).toEqual({
      userId: 'u1',
      contactId: 'u1',
      nickName: 'Alice',
      contactName: 'Alice'
    })
    expect(drawer.loading.value).toBe(false)
  })

  it('does not write a completed response after cleanup', async () => {
    const { drawer, proxy } = createHarness()
    let resolveRequest
    proxy.Request.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve
        })
    )

    const loading = drawer.openDrawer()
    drawer.cleanup()
    resolveRequest({ data: { userId: 'u1', nickName: '过期资料' } })
    await loading

    expect(drawer.userInfo.value).toEqual({})
  })
})
