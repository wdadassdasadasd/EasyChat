import { describe, expect, it, vi } from 'vitest'

vi.mock('electron-log/main', () => ({
  default: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    initialize: vi.fn(),
    transports: {
      file: {},
      console: {}
    },
    errorHandler: { startCatching: vi.fn() },
    eventLogger: { startLogging: vi.fn() }
  }
}))

describe('main logger redaction', () => {
  it('redacts credentials, WS query tokens, message bodies, and binary payloads', async () => {
    const { sanitizeLogValue } = await import('../../src/main/logger')
    const result = sanitizeLogValue({
      token: 'secret-token',
      nested: {
        password: 'secret-password',
        url: 'ws://localhost/chat?token=secret-token&client=desktop',
        messageContent: 'private conversation'
      },
      payload: Buffer.from([1, 2, 3])
    })

    expect(JSON.stringify(result)).not.toContain('secret-token')
    expect(JSON.stringify(result)).not.toContain('secret-password')
    expect(JSON.stringify(result)).not.toContain('private conversation')
    expect(result.nested.url).toContain('token=[REDACTED]')
    expect(result.payload).toBe('[binary:3]')
  })

  it('redacts complete bearer credentials and serialized secret fields', async () => {
    const { sanitizeLogValue } = await import('../../src/main/logger')
    const result = sanitizeLogValue(
      'Authorization: Bearer live-token-123 {"token":"json-token-456"}'
    )

    expect(result).not.toContain('live-token-123')
    expect(result).not.toContain('json-token-456')
    expect(result).toContain('Authorization: [REDACTED]')
  })
})
