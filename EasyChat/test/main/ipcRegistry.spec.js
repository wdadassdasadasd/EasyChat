import fs from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { eventHandlers, invokeHandlers, trusted } = vi.hoisted(() => ({
  eventHandlers: {},
  invokeHandlers: {},
  trusted: { value: true }
}))

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn((channel, handler) => {
      eventHandlers[channel] = handler
    }),
    handle: vi.fn((channel, handler) => {
      invokeHandlers[channel] = handler
    })
  }
}))

vi.mock('../../src/main/ipcSecurity.js', () => ({
  isTrustedIpcEvent: () => trusted.value,
  buildUntrustedSenderResult: (channel) => ({ success: false, kind: 'untrusted_sender', channel })
}))

vi.mock('../../src/main/logger.js', () => ({
  default: { warn: vi.fn() }
}))

beforeEach(() => {
  trusted.value = true
  Object.keys(eventHandlers).forEach((channel) => delete eventHandlers[channel])
  Object.keys(invokeHandlers).forEach((channel) => delete invokeHandlers[channel])
  vi.clearAllMocks()
})

describe('trusted IPC registration', () => {
  it('silently rejects untrusted event and callback registrations', async () => {
    const { registerTrustedIpcOn } = await import('../../src/main/ipcRegistry.js')
    const handler = vi.fn()
    registerTrustedIpcOn('eventChannel', handler)
    trusted.value = false

    eventHandlers.eventChannel({ sender: {} }, { id: 1 })
    expect(handler).not.toHaveBeenCalled()
  })

  it('keeps trusted event behavior intact', async () => {
    const { registerTrustedIpcOn } = await import('../../src/main/ipcRegistry.js')
    const handler = vi.fn()
    const event = { sender: {} }
    registerTrustedIpcOn('callbackChannel', handler)

    eventHandlers.callbackChannel(event, { id: 1 })
    expect(handler).toHaveBeenCalledWith(event, { id: 1 })
  })

  it('returns the untrusted_sender contract for invoke registrations', async () => {
    const { registerTrustedIpcHandle } = await import('../../src/main/ipcRegistry.js')
    const handler = vi.fn(async () => ({ success: true }))
    registerTrustedIpcHandle('invokeChannel', handler)
    trusted.value = false

    await expect(invokeHandlers.invokeChannel({ sender: {} }, { id: 1 })).resolves.toEqual({
      success: false,
      kind: 'untrusted_sender',
      channel: 'invokeChannel'
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('does not allow ipc.js to bypass the registry with ipcMain registrations', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/main/ipc.js'), 'utf8')
    expect(source).not.toContain('ipcMain.on(')
    expect(source).not.toContain('ipcMain.handle(')
  })
})
