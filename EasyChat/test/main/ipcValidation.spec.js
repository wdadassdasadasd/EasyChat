import { describe, expect, it } from 'vitest'

import {
  validateDownload,
  validateLoadChatMessage,
  validateOpenChat,
  validateSaveSendMessage,
  validateStoreWrite,
  validateUploadSourceChunk,
  validateWindowOperation
} from '../../src/main/ipcValidation'

const expectValidationError = (callback) => {
  expect(callback).toThrow(
    expect.objectContaining({
      kind: 'validation_error'
    })
  )
}

describe('IPC validation', () => {
  it('accepts the current login and history payload contracts', () => {
    expect(() =>
      validateOpenChat({
        userId: 'u1',
        token: 'token-1',
        email: 'u1@example.com'
      })
    ).not.toThrow()
    expect(() =>
      validateLoadChatMessage({
        sessionId: 's1',
        beforeMessageId: 10,
        loadSeq: 2
      })
    ).not.toThrow()
  })

  it('rejects malformed identifiers and window operations', () => {
    expectValidationError(() => validateLoadChatMessage({ sessionId: '', beforeMessageId: -1 }))
    expectValidationError(() => validateWindowOperation({ action: 'execute', data: {} }))
  })

  it('restricts local settings to known URL keys and protocols', () => {
    expect(() =>
      validateStoreWrite({
        key: 'prodWsDomain',
        value: 'wss://chat.example.com/ws'
      })
    ).not.toThrow()
    expectValidationError(() =>
      validateStoreWrite({ key: 'prodWsDomain', value: 'file:///tmp/socket' })
    )
    expectValidationError(() => validateStoreWrite({ key: 'token', value: 'secret' }))
  })

  it('rejects non-http downloads and relative file paths', () => {
    expectValidationError(() =>
      validateDownload({
        url: 'file:///etc/passwd',
        messageId: 1,
        fileName: 'data.txt'
      })
    )
  })

  it('requires bounded numeric upload chunk ranges', () => {
    expect(() =>
      validateUploadSourceChunk({ uploadSourceId: 'source-1', start: 0, end: 1024 }, 4096)
    ).not.toThrow()
    expectValidationError(() =>
      validateUploadSourceChunk({ uploadSourceId: 'source-1', end: 1024 }, 4096)
    )
    expectValidationError(() =>
      validateUploadSourceChunk({ uploadSourceId: 'source-1', start: 0, end: 4097 }, 4096)
    )
  })

  it('enforces text length and replace identifiers', () => {
    expect(() =>
      validateSaveSendMessage({
        mode: 'pending',
        message: {
          messageId: -1,
          sessionId: 's1',
          messageType: 2,
          messageContent: 'x'.repeat(500)
        }
      })
    ).not.toThrow()
    expectValidationError(() =>
      validateSaveSendMessage({
        mode: 'pending',
        message: {
          messageId: -1,
          sessionId: 's1',
          messageType: 2,
          messageContent: 'x'.repeat(501)
        }
      })
    )
    expectValidationError(() =>
      validateSaveSendMessage({
        mode: 'replace',
        message: { messageId: 10, sessionId: 's1' }
      })
    )
  })
})
