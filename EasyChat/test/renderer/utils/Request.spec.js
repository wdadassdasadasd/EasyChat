import { beforeEach, describe, expect, it, vi } from 'vitest'

const { postMock, userInfo } = vi.hoisted(() => ({
  postMock: vi.fn(),
  userInfo: { value: null }
}))

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      defaults: {
        timeout: 10000
      },
      interceptors: {
        request: {
          use: vi.fn()
        },
        response: {
          use: vi.fn()
        }
      },
      post: postMock
    }))
  }
}))

vi.mock('element-plus', () => ({
  ElLoading: {
    service: vi.fn(() => ({
      close: vi.fn()
    }))
  }
}))

vi.mock('@/router', () => ({
  default: {
    push: vi.fn()
  }
}))

vi.mock('@/stores/UserInfoStore', () => ({
  useUserInfoStore: () => ({
    clearUserInfo: vi.fn(),
    getInfo: () => userInfo.value
  })
}))

vi.mock('@/utils/Message', () => ({
  default: {
    error: vi.fn()
  }
}))

const createStorage = () => {
  const data = new Map()
  return {
    getItem: vi.fn((key) => data.get(key) ?? null),
    removeItem: vi.fn((key) => data.delete(key)),
    setItem: vi.fn((key, value) => data.set(key, value))
  }
}

describe('Request returnError', () => {
  beforeEach(() => {
    vi.resetModules()
    postMock.mockReset()
    userInfo.value = null
    global.localStorage = createStorage()
  })

  it('keeps default failed request result as null', async () => {
    postMock.mockRejectedValueOnce({
      code: 'ECONNABORTED',
      message: 'timeout of 10000ms exceeded',
      config: { url: '/chat/sendMessage' },
      showError: false
    })
    const request = (await import('@/utils/Request')).default

    const result = await request({
      url: '/chat/sendMessage',
      params: {},
      showLoading: false
    })

    expect(result).toBeNull()
  })

  it('returns structured timeout error when returnError is true', async () => {
    postMock.mockRejectedValueOnce({
      code: 'ECONNABORTED',
      message: 'timeout of 10000ms exceeded',
      config: { url: '/chat/sendMessage' },
      showError: false
    })
    const request = (await import('@/utils/Request')).default

    const result = await request({
      url: '/chat/sendMessage',
      params: {},
      showLoading: false,
      returnError: true
    })

    expect(result).toMatchObject({
      success: false,
      kind: 'timeout',
      code: 'ECONNABORTED',
      url: '/chat/sendMessage'
    })
  })

  it('returns structured canceled error when returnError is true', async () => {
    postMock.mockRejectedValueOnce({
      code: 'ERR_CANCELED',
      message: 'canceled',
      config: { url: '/chat/uploadFile' },
      showError: false
    })
    const request = (await import('@/utils/Request')).default

    const result = await request({
      url: '/chat/uploadFile',
      params: {},
      showLoading: false,
      returnError: true
    })

    expect(result).toMatchObject({
      success: false,
      kind: 'canceled',
      code: 'ERR_CANCELED',
      url: '/chat/uploadFile'
    })
  })

  it('returns structured HTTP status error when returnError is true', async () => {
    postMock.mockRejectedValueOnce({
      response: {
        status: 500,
        data: {
          message: 'server error'
        }
      },
      config: { url: '/chat/sendMessage' },
      showError: false
    })
    const request = (await import('@/utils/Request')).default

    const result = await request({
      url: '/chat/sendMessage',
      params: {},
      showLoading: false,
      returnError: true
    })

    expect(result).toMatchObject({
      success: false,
      kind: 'http_status',
      msg: 'server error',
      status: 500,
      url: '/chat/sendMessage'
    })
  })

  it('sends only the bearer authorization header', async () => {
    userInfo.value = { token: 'token-1' }
    postMock.mockResolvedValueOnce({ data: { code: 200 } })
    const request = (await import('@/utils/Request')).default

    await request({
      url: '/chat/sendMessage',
      params: { messageContent: 'hello' },
      showLoading: false
    })

    const requestConfig = postMock.mock.calls[0][2]
    expect(requestConfig.headers.Authorization).toBe('Bearer token-1')
    expect(requestConfig.headers).not.toHaveProperty('token')
  })

  it('does not send authorization to account endpoints', async () => {
    userInfo.value = { token: 'stale-token' }
    postMock.mockResolvedValueOnce({ data: { code: 200 } })
    const request = (await import('@/utils/Request')).default

    await request({
      url: '/account/login',
      params: { email: 'u1@example.com' },
      showLoading: false
    })

    const requestHeaders = postMock.mock.calls[0][2].headers
    expect(requestHeaders).not.toHaveProperty('Authorization')
    expect(requestHeaders).not.toHaveProperty('token')
  })

  it('deduplicates equivalent nested parameters regardless of object key order', async () => {
    let resolvePost
    postMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve
        })
    )
    const request = (await import('@/utils/Request')).default

    const first = request({
      url: '/contact/search',
      params: { page: 1, filter: { status: 1, keyword: 'alice' } },
      showLoading: false
    })
    const second = request({
      url: '/contact/search',
      params: { filter: { keyword: 'alice', status: 1 }, page: 1 },
      showLoading: false
    })

    expect(second).toBe(first)
    expect(postMock).toHaveBeenCalledTimes(1)
    resolvePost({ data: { code: 200 } })
    await first
  })

  it('does not reuse an in-flight request after the authenticated identity changes', async () => {
    const resolvers = []
    userInfo.value = { userId: 'alice', token: 'alice-token' }
    postMock.mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve))
    )
    const request = (await import('@/utils/Request')).default

    const first = request({
      url: '/contact/loadContact',
      params: { pageNo: 1 },
      showLoading: false
    })
    userInfo.value = { userId: 'bob', token: 'bob-token' }
    const second = request({
      url: '/contact/loadContact',
      params: { pageNo: 1 },
      showLoading: false
    })

    expect(second).not.toBe(first)
    expect(postMock).toHaveBeenCalledTimes(2)
    resolvers.forEach((resolve) => resolve({ data: { code: 200 } }))
    await Promise.all([first, second])
  })

  it('keeps array order significant for request deduplication', async () => {
    postMock.mockResolvedValue({ data: { code: 200 } })
    const request = (await import('@/utils/Request')).default

    await Promise.all([
      request({
        url: '/group/saveGroup',
        params: { memberIds: ['u1', 'u2'] },
        showLoading: false
      }),
      request({
        url: '/group/saveGroup',
        params: { memberIds: ['u2', 'u1'] },
        showLoading: false
      })
    ])

    expect(postMock).toHaveBeenCalledTimes(2)
  })

  it('skips deduplication for circular parameters', async () => {
    postMock.mockResolvedValue({ data: { code: 200 } })
    const request = (await import('@/utils/Request')).default
    const params = { keyword: 'loop' }
    params.self = params

    await Promise.all([
      request({ url: '/contact/search', params, showLoading: false }),
      request({ url: '/contact/search', params, showLoading: false })
    ])

    expect(postMock).toHaveBeenCalledTimes(2)
  })
})
