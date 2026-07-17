import { describe, expect, it, vi } from 'vitest'
import { createMediaUploadCoordinator } from '@/views/chat/composables/mediaUploadCoordinator'

describe('createMediaUploadCoordinator', () => {
  it('runs uploads within the configured concurrency bound', async () => {
    const started = []
    const resolvers = []
    const coordinator = createMediaUploadCoordinator({ maxConcurrency: 2 })
    const task = (id) => () => {
      started.push(id)
      return new Promise((resolve) => resolvers.push(resolve))
    }

    coordinator.enqueue(task(1))
    coordinator.enqueue(task(2))
    coordinator.enqueue(task(3))
    await Promise.resolve()

    expect(started).toEqual([1, 2])
    resolvers.shift()()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(started).toEqual([1, 2, 3])
  })

  it('aborts active controllers and cancels delayed retries during cleanup', () => {
    vi.useFakeTimers()
    const abort = vi.fn()
    const retry = vi.fn()
    const coordinator = createMediaUploadCoordinator()
    coordinator.setController(1, { abort })
    coordinator.scheduleRetry(retry, 1000)

    coordinator.cleanup()
    vi.advanceTimersByTime(1000)

    expect(abort).toHaveBeenCalledTimes(1)
    expect(retry).not.toHaveBeenCalled()
    expect(coordinator.enqueue(vi.fn())).toBe(false)
    vi.useRealTimers()
  })
})
