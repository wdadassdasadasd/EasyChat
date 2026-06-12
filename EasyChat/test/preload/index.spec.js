import { beforeAll, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn()
  }
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: electronMocks.exposeInMainWorld
  },
  ipcRenderer: electronMocks.ipcRenderer,
  webUtils: {
    getPathForFile: vi.fn(() => 'D:/tmp/file.txt')
  }
}))

describe('preload API bridge', () => {
  let api

  beforeAll(async () => {
    Object.defineProperty(process, 'contextIsolated', {
      configurable: true,
      value: true
    })
    await import('../../src/preload/index')
    api = electronMocks.exposeInMainWorld.mock.calls.find(([name]) => name === 'api')?.[1]
  })

  it('only exposes the named business API', () => {
    expect(api).toBeDefined()
    expect(electronMocks.exposeInMainWorld).toHaveBeenCalledTimes(1)
    expect(electronMocks.exposeInMainWorld).not.toHaveBeenCalledWith(
      'electronAPI',
      expect.anything()
    )
  })

  it('strips IpcRendererEvent and returns an exact unsubscribe function', () => {
    const listener = vi.fn()
    const unsubscribe = api.onReceiveMessage(listener)
    const wrappedListener = electronMocks.ipcRenderer.on.mock.calls.at(-1)[1]
    const event = { sender: { send: vi.fn() } }
    const payload = { messageId: 10 }

    wrappedListener(event, payload)

    expect(listener).toHaveBeenCalledWith(payload)
    expect(listener).not.toHaveBeenCalledWith(event, payload)

    unsubscribe()
    expect(electronMocks.ipcRenderer.removeListener).toHaveBeenCalledWith(
      'receiveMessage',
      wrappedListener
    )
  })
})
