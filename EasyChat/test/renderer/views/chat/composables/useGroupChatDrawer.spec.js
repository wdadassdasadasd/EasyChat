import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useGroupChatDrawer } from '@/views/chat/composables/useGroupChatDrawer'

const createHarness = (session = {}) => {
  const currentChatSession = ref({
    contactId: 'g1',
    contactName: '第一群',
    contactType: 1,
    memberCount: 2,
    ...session
  })
  const proxy = {
    Api: { getGroupInfo4Chat: '/group/info' },
    Request: vi.fn()
  }
  return {
    currentChatSession,
    drawer: useGroupChatDrawer({ currentChatSession, proxy }),
    proxy
  }
}

describe('useGroupChatDrawer', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('only opens for group chats and resets the member search before loading', async () => {
    const { currentChatSession, drawer, proxy } = createHarness({ contactType: 0 })

    await drawer.openDrawer()

    expect(drawer.visible.value).toBe(false)
    expect(proxy.Request).not.toHaveBeenCalled()

    currentChatSession.value = {
      contactId: 'g1',
      contactName: '第一群',
      contactType: 1,
      memberCount: 2
    }
    drawer.searchKey.value = 'old'
    proxy.Request.mockResolvedValue({
      data: {
        groupInfo: { groupId: 'g1', groupName: '第一群' },
        userContactList: [
          { userId: 'u1', nickName: 'Alice' },
          { userId: 'u2', nickName: 'Bob' }
        ]
      }
    })

    await drawer.openDrawer()

    expect(drawer.visible.value).toBe(true)
    expect(drawer.searchKey.value).toBe('')
    expect(drawer.groupInfo.value).toEqual({ groupId: 'g1', groupName: '第一群' })
    drawer.searchKey.value = 'bo'
    expect(drawer.filteredMemberList.value).toEqual([{ userId: 'u2', nickName: 'Bob' }])
  })

  it('ignores an older group response after the user switches groups', async () => {
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
    currentChatSession.value = {
      contactId: 'g2',
      contactName: '第二群',
      contactType: 1,
      memberCount: 3
    }
    const secondLoad = drawer.syncVisible(true)
    resolveSecond({
      data: {
        groupInfo: { groupId: 'g2', groupName: '第二群' },
        userContactList: [{ userId: 'u3', nickName: 'Carol' }]
      }
    })
    await secondLoad
    resolveFirst({
      data: {
        groupInfo: { groupId: 'g1', groupName: '第一群' },
        userContactList: [{ userId: 'u1', nickName: 'Alice' }]
      }
    })
    await firstLoad

    expect(drawer.groupInfo.value).toEqual({ groupId: 'g2', groupName: '第二群' })
    expect(drawer.memberList.value).toEqual([{ userId: 'u3', nickName: 'Carol' }])
  })

  it('falls back to the current session when loading fails', async () => {
    const { drawer, proxy } = createHarness()
    proxy.Request.mockRejectedValue(new Error('offline'))

    await drawer.openDrawer()

    expect(drawer.groupInfo.value).toEqual({
      groupId: 'g1',
      groupName: '第一群',
      memberCount: 2
    })
    expect(drawer.memberList.value).toEqual([])
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
    resolveRequest({
      data: {
        groupInfo: { groupId: 'g1', groupName: '过期群' },
        userContactList: [{ userId: 'u1', nickName: 'Alice' }]
      }
    })
    await loading

    expect(drawer.groupInfo.value).toEqual({})
    expect(drawer.memberList.value).toEqual([])
  })
})
