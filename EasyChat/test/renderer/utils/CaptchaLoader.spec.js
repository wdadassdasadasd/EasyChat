import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCaptchaLoader } from '../../../src/renderer/src/utils/CaptchaLoader.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('createCaptchaLoader', () => {
  it('stops automatic retries but lets a manual click recover', async () => {
    vi.useFakeTimers()
    const request = vi.fn().mockResolvedValue(undefined)
    const onSuccess = vi.fn()
    const onExhausted = vi.fn()
    const loader = createCaptchaLoader({ request, onSuccess, onExhausted })

    await loader.load()
    await vi.runOnlyPendingTimersAsync()
    await vi.runOnlyPendingTimersAsync()

    expect(request).toHaveBeenCalledTimes(3)
    expect(onExhausted).toHaveBeenCalledTimes(1)

    request.mockResolvedValue({ data: { checkCode: 'image', checkCodeKey: 'key' } })
    await loader.load({ manual: true })

    expect(request).toHaveBeenCalledTimes(4)
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('cancels a scheduled retry when disposed', async () => {
    vi.useFakeTimers()
    const request = vi.fn().mockResolvedValue(undefined)
    const loader = createCaptchaLoader({ request })

    await loader.load()
    loader.dispose()
    await vi.runAllTimersAsync()

    expect(request).toHaveBeenCalledTimes(1)
  })
})
