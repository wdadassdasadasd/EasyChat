import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/main/store', () => ({ default: {} }))
vi.mock('../../../src/main/db/ADB', () => ({
  insertOrIgnore: vi.fn(),
  queryOne: vi.fn(),
  runStrict: vi.fn(async () => 1),
  runInTransaction: vi.fn(),
  update: vi.fn()
}))

describe('UserSettingModel contact apply unread snapshot', () => {
  beforeEach(() => vi.clearAllMocks())

  it('overwrites the persisted count instead of incrementing it', async () => {
    const { runStrict } = await import('../../../src/main/db/ADB')
    const { setContactApplyNoReadCount } = await import('../../../src/main/db/UserSettingModel')

    await setContactApplyNoReadCount('u1', 4)

    expect(runStrict).toHaveBeenCalledWith(
      'update user_setting set contact_no_read=? where user_id=?',
      [4, 'u1']
    )
  })

  it.each([undefined, null, -1, 1.5, 'invalid'])('normalizes %p to zero', async (value) => {
    const { runStrict } = await import('../../../src/main/db/ADB')
    const { setContactApplyNoReadCount } = await import('../../../src/main/db/UserSettingModel')

    await setContactApplyNoReadCount('u1', value)

    expect(runStrict).toHaveBeenCalledWith(expect.any(String), [0, 'u1'])
  })
})
