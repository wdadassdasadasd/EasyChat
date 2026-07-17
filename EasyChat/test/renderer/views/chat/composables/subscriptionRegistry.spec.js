import { describe, expect, it, vi } from 'vitest'
import { createSubscriptionRegistry } from '@/views/chat/composables/subscriptionRegistry'

describe('createSubscriptionRegistry', () => {
  it('replaces a named subscription and clears every remaining subscription once', () => {
    const registry = createSubscriptionRegistry()
    const firstStop = vi.fn()
    const secondStop = vi.fn()
    const otherStop = vi.fn()

    registry.replace('message', () => firstStop)
    registry.replace('message', () => secondStop)
    registry.replace('session', () => otherStop)
    registry.clear()

    expect(firstStop).toHaveBeenCalledTimes(1)
    expect(secondStop).toHaveBeenCalledTimes(1)
    expect(otherStop).toHaveBeenCalledTimes(1)
  })
})
