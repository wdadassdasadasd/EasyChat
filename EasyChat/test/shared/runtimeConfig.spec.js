import { describe, expect, it } from 'vitest'
import {
  DEFAULT_API_ORIGIN,
  DEFAULT_WS_ORIGIN,
  resolveRuntimeConfig
} from '../../src/shared/runtimeConfig.js'

describe('runtimeConfig', () => {
  it('uses localhost defaults when build-time origins are absent', () => {
    expect(resolveRuntimeConfig()).toMatchObject({
      apiOrigin: DEFAULT_API_ORIGIN,
      apiBaseUrl: `${DEFAULT_API_ORIGIN}/api`,
      wsOrigin: DEFAULT_WS_ORIGIN,
      wsCspOrigin: 'ws://localhost:5051'
    })
  })

  it('accepts secure external origins', () => {
    expect(
      resolveRuntimeConfig({
        apiOrigin: 'https://chat.example.com',
        wsOrigin: 'wss://chat.example.com/ws'
      })
    ).toMatchObject({
      apiOrigin: 'https://chat.example.com',
      wsOrigin: 'wss://chat.example.com/ws',
      wsCspOrigin: 'wss://chat.example.com'
    })
  })

  it.each([
    { apiOrigin: 'http://chat.example.com', wsOrigin: 'wss://chat.example.com' },
    { apiOrigin: 'https://chat.example.com/api', wsOrigin: 'wss://chat.example.com' },
    { apiOrigin: 'https://chat.example.com', wsOrigin: 'ws://chat.example.com' }
  ])('rejects insecure or non-origin runtime settings: %o', (settings) => {
    expect(() => resolveRuntimeConfig(settings)).toThrow()
  })
})
