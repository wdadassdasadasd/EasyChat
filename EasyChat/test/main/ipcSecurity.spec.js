import { beforeEach, describe, expect, it } from 'vitest'
import {
  configureTrustedRendererUrl,
  isTrustedIpcEvent,
  isTrustedRendererUrl
} from '../../src/main/ipcSecurity'

const trustedEvent = (url = 'file:///app/renderer/index.html') => {
  const sender = { getURL: () => url, isDestroyed: () => false }
  const senderFrame = { url }
  sender.mainFrame = senderFrame
  return { sender, senderFrame }
}

describe('IPC sender trust policy', () => {
  beforeEach(() => configureTrustedRendererUrl('file:///app/renderer/index.html'))

  it('accepts only the configured top-level renderer document', () => {
    expect(isTrustedRendererUrl('file:///app/renderer/index.html#/chat')).toBe(true)
    expect(isTrustedIpcEvent(trustedEvent())).toBe(true)
    expect(isTrustedIpcEvent(trustedEvent('file:///tmp/untrusted.html'))).toBe(false)
  })

  it('rejects nested frames even when their URL is trusted', () => {
    const event = trustedEvent()
    event.senderFrame = { url: 'file:///app/renderer/index.html' }
    expect(isTrustedIpcEvent(event)).toBe(false)
  })
})
