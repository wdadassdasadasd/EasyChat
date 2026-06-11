import { beforeEach, describe, expect, it, vi } from 'vitest'

const { postMock } = vi.hoisted(() => ({
  postMock: vi.fn()
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
    clearUserInfo: vi.fn()
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
})
