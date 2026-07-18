import { describe, expect, it } from 'vitest'
import { shouldRetryRendererStartup } from '../electron/startupPolicy.mjs'

describe('Electron startup retry policy', () => {
  it('retries exactly once for a renderer launch failure before preload is ready', () => {
    const events = [{ type: 'render-process-gone', reason: 'launch-failed', exitCode: 49 }]
    expect(shouldRetryRendererStartup({ attempt: 0, events })).toBe(true)
    expect(shouldRetryRendererStartup({ attempt: 1, events })).toBe(false)
    expect(
      shouldRetryRendererStartup({ attempt: 0, rendererState: [{ crashed: true }] })
    ).toBe(true)
  })

  it('does not retry business failures or unrelated child-process failures', () => {
    expect(shouldRetryRendererStartup({ attempt: 0, events: [] })).toBe(false)
    expect(
      shouldRetryRendererStartup({
        attempt: 0,
        events: [{ type: 'child-process-gone', processType: 'GPU', reason: 'crashed' }]
      })
    ).toBe(false)
  })
})
