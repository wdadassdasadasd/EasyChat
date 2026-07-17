import { describe, expect, it, vi } from 'vitest'
import { createSessionProfileResolver } from '@/views/chat/composables/session/sessionProfileResolver'

const createResolver = () => {
  const proxy = {
    Api: {
      getContactUserInfo: '/contact/getContactUserInfo',
      getGroupInfo: '/group/getGroupInfo'
    },
    Request: vi.fn(async ({ url }) => {
      if (url === '/group/getGroupInfo') {
        return { data: { groupInfo: { groupName: '项目群', memberCount: 8 } } }
      }
      return { data: { nickName: '小明' } }
    })
  }
  return { proxy, resolver: createSessionProfileResolver({ proxy }) }
}

describe('createSessionProfileResolver', () => {
  it('keeps an existing direct-chat display name without a profile request', async () => {
    const { proxy, resolver } = createResolver()

    await expect(
      resolver.fillSessionName({ contactId: 'u1', contactType: 0, contactName: '已有名称' })
    ).resolves.toMatchObject({ contactName: '已有名称' })

    expect(proxy.Request).not.toHaveBeenCalled()
  })

  it('hydrates group and direct-chat display data with their matching API', async () => {
    const { proxy, resolver } = createResolver()

    const sessions = await resolver.hydrateSessionList([
      { contactId: 'g1', contactType: 1 },
      { contactId: 'u2', contactType: 0 }
    ])

    expect(sessions).toEqual([
      expect.objectContaining({ contactId: 'g1', contactName: '项目群', memberCount: 8 }),
      expect.objectContaining({ contactId: 'u2', contactName: '小明', nickName: '小明' })
    ])
    expect(proxy.Request).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/group/getGroupInfo', params: { groupId: 'g1' } })
    )
    expect(proxy.Request).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/contact/getContactUserInfo', params: { contactId: 'u2' } })
    )
  })
})
