import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestState = vi.hoisted(() => ({ callbacks: [] }))
const fsState = vi.hoisted(() => ({ unlinks: [] }))

vi.mock('http', () => ({
  default: {
    get: vi.fn((_url, callback) => {
      requestState.callbacks.push(callback)
      const request = new EventEmitter()
      request.destroy = vi.fn((error) => request.emit('error', error))
      return request
    })
  }
}))
vi.mock('https', () => ({ default: { get: vi.fn() } }))
vi.mock('fs', () => ({
  default: {
    promises: {
      unlink: vi.fn(async (filePath) => fsState.unlinks.push(filePath)),
      rename: vi.fn(async () => {})
    },
    createWriteStream: vi.fn(() => {
      const output = new EventEmitter()
      output.close = (callback) => callback()
      return output
    })
  }
}))

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const sender = () => ({ send: vi.fn(), isDestroyed: vi.fn(() => false) })

describe('downloadTaskManager runtime ownership', () => {
  beforeEach(() => {
    requestState.callbacks = []
    fsState.unlinks = []
    vi.clearAllMocks()
  })

  it('cancels the old runtime, deletes its exact temp path, and permits the same message id for the next user', async () => {
    const { createDownloadTaskManager } = await import('../../src/main/downloadTaskManager')
    const manager = createDownloadTaskManager({
      getTargetPath: async () => ({ targetPath: 'D:/downloads/report.pdf', tempPath: 'D:/downloads/report.pdf.download' }),
      validateUrl: (url) => url
    })
    const firstSender = sender()
    manager.activateDownloadRuntime({ userId: 'alice', eventTarget: firstSender })
    const first = manager.downloadChatFile({
      eventTarget: firstSender,
      userId: 'alice',
      messageId: 'same-id',
      url: 'http://files.example.com/report.pdf'
    })
    await tick()

    await manager.deactivateDownloadTasks()
    await expect(first).resolves.toMatchObject({ success: false, kind: 'canceled' })
    expect(fsState.unlinks).toContain('D:/downloads/report.pdf.download')

    const secondSender = sender()
    manager.activateDownloadRuntime({ userId: 'bob', eventTarget: secondSender })
    const second = manager.downloadChatFile({
      eventTarget: secondSender,
      userId: 'bob',
      messageId: 'same-id',
      url: 'http://files.example.com/report.pdf'
    })
    await tick()
    expect(requestState.callbacks).toHaveLength(2)
    await manager.cancelDownloadChatFile({ userId: 'bob', messageId: 'same-id' })
    await expect(second).resolves.toMatchObject({ success: false, kind: 'canceled' })
  })

  it('does not publish progress after its runtime has been replaced', async () => {
    const { createDownloadTaskManager } = await import('../../src/main/downloadTaskManager')
    const manager = createDownloadTaskManager({
      getTargetPath: async () => ({ targetPath: 'D:/downloads/a.bin', tempPath: 'D:/downloads/a.bin.download' }),
      validateUrl: (url) => url
    })
    const firstSender = sender()
    manager.activateDownloadRuntime({ userId: 'alice', eventTarget: firstSender })
    const pending = manager.downloadChatFile({
      eventTarget: firstSender,
      userId: 'alice',
      messageId: '1',
      url: 'http://files.example.com/a.bin'
    })
    await tick()
    await manager.deactivateDownloadTasks()
    await pending

    const response = new EventEmitter()
    response.statusCode = 200
    response.headers = { 'content-length': '4' }
    response.pipe = vi.fn()
    requestState.callbacks[0](response)
    response.emit('data', Buffer.from('1234'))
    expect(firstSender.send).not.toHaveBeenCalled()
  })

  it('reserves distinct target paths for concurrent downloads with the same filename', async () => {
    const { createDownloadTaskManager } = await import('../../src/main/downloadTaskManager')
    const manager = createDownloadTaskManager({
      getTargetPath: async (_fileName, { reservedTargetPaths = new Set() } = {}) => {
        const base = 'D:/downloads/report.pdf'
        const targetPath = reservedTargetPaths.has(base) ? 'D:/downloads/report (1).pdf' : base
        return { targetPath, tempPath: `${targetPath}.download` }
      },
      validateUrl: (url) => url
    })
    const eventTarget = sender()
    manager.activateDownloadRuntime({ userId: 'alice', eventTarget })

    const first = manager.downloadChatFile({
      eventTarget,
      userId: 'alice',
      messageId: '1',
      url: 'http://files.example.com/report.pdf'
    })
    const second = manager.downloadChatFile({
      eventTarget,
      userId: 'alice',
      messageId: '2',
      url: 'http://files.example.com/report.pdf'
    })
    await tick()

    expect(manager.getDiagnostics()).toMatchObject({ activeCount: 2, reservedTargetCount: 2 })

    await manager.deactivateDownloadTasks()
    await expect(first).resolves.toMatchObject({ success: false, kind: 'canceled' })
    await expect(second).resolves.toMatchObject({ success: false, kind: 'canceled' })
  })

  it('renames a completed temp file asynchronously before publishing success', async () => {
    const fs = (await import('fs')).default
    const { createDownloadTaskManager } = await import('../../src/main/downloadTaskManager')
    const manager = createDownloadTaskManager({
      getTargetPath: async () => ({
        targetPath: 'D:/downloads/final.txt',
        tempPath: 'D:/downloads/final.txt.download'
      }),
      validateUrl: (url) => url
    })
    const eventTarget = sender()
    manager.activateDownloadRuntime({ userId: 'alice', eventTarget })

    const pending = manager.downloadChatFile({
      eventTarget,
      userId: 'alice',
      messageId: 'complete-1',
      url: 'http://files.example.com/final.txt'
    })
    await tick()
    const response = new EventEmitter()
    response.statusCode = 200
    response.headers = { 'content-length': '4' }
    response.pipe = vi.fn()
    requestState.callbacks.at(-1)(response)
    const output = fs.createWriteStream.mock.results.at(-1).value
    output.emit('finish')

    await expect(pending).resolves.toEqual({
      success: true,
      filePath: 'D:/downloads/final.txt',
      progress: 100
    })
    expect(fs.promises.rename).toHaveBeenCalledWith(
      'D:/downloads/final.txt.download',
      'D:/downloads/final.txt'
    )
  })

  it('classifies connection failures as network errors and removes the partial file', async () => {
    const http = (await import('http')).default
    const { createDownloadTaskManager } = await import('../../src/main/downloadTaskManager')
    const manager = createDownloadTaskManager({
      getTargetPath: async () => ({ targetPath: 'D:/downloads/offline.bin', tempPath: 'D:/downloads/offline.bin.download' }),
      validateUrl: (url) => url
    })
    const eventTarget = sender()
    manager.activateDownloadRuntime({ userId: 'alice', eventTarget })

    const pending = manager.downloadChatFile({
      eventTarget,
      userId: 'alice',
      messageId: 'offline-1',
      url: 'http://files.example.com/offline.bin'
    })
    await tick()
    const request = http.get.mock.results.at(-1).value
    request.emit('error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))

    await expect(pending).resolves.toMatchObject({ success: false, kind: 'network' })
    expect(fsState.unlinks).toContain('D:/downloads/offline.bin.download')
  })
})
