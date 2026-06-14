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
    global.File = class File {
      constructor(name, options = {}) {
        this.name = name
        this.size = options.size || 0
        this.type = options.type || ''
        this.lastModified = options.lastModified || 0
      }
    }
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

  it('subscribes to the existing delete-session callback channel', () => {
    const listener = vi.fn()
    const unsubscribe = api.onDelChatSessionCallback(listener)
    const [channel, wrappedListener] = electronMocks.ipcRenderer.on.mock.calls.at(-1)

    expect(channel).toBe('delChatSessionCallback')
    wrappedListener({}, { contactId: 'c1', success: false })
    expect(listener).toHaveBeenCalledWith({ contactId: 'c1', success: false })

    unsubscribe()
    expect(electronMocks.ipcRenderer.removeListener).toHaveBeenCalledWith(
      'delChatSessionCallback',
      wrappedListener
    )
  })

  it('registers only real File objects through the named upload source channel', async () => {
    electronMocks.ipcRenderer.invoke.mockResolvedValueOnce({
      success: true,
      uploadSourceId: 'source-1'
    })
    const file = new File('a.txt', { size: 12, type: 'text/plain', lastModified: 10 })

    await expect(api.registerUploadSource(file)).resolves.toMatchObject({
      uploadSourceId: 'source-1'
    })
    expect(electronMocks.ipcRenderer.invoke).toHaveBeenCalledWith(
      'registerUploadSource',
      expect.objectContaining({
        filePath: 'D:/tmp/file.txt',
        name: 'a.txt',
        size: 12
      })
    )
    await expect(api.registerUploadSource({ name: 'fake.txt' })).rejects.toThrow(
      'only accepts File'
    )
  })
})
