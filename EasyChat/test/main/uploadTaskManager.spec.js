import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ tasks: [], saved: [], source: { name: 'demo.bin', size: 8 } }))

vi.mock('axios', () => ({ default: { post: vi.fn() } }))
vi.mock('../../src/main/store', () => ({
  default: { getData: vi.fn(() => 'http://api.example.test') }
}))
vi.mock('../../src/main/uploadSourceRegistry', () => ({
  MAX_CHUNK_SIZE: 4 * 1024 * 1024,
  getUploadSource: vi.fn(async () => state.source),
  releaseUploadSource: vi.fn(async () => ({ success: true })),
  setUploadSourcePinned: vi.fn(async () => {}),
  readUploadSourceChunk: vi.fn()
}))
vi.mock('../../src/main/uploadCoverRegistry', () => ({
  readUploadCover: vi.fn(async () => ({
    cover: { type: 'image/jpeg' },
    buffer: Buffer.from([1, 2, 3])
  })),
  releaseUploadCover: vi.fn(async () => ({ success: true }))
}))
vi.mock('../../src/main/db/UploadTaskModel', () => ({
  deleteUploadTask: vi.fn(async (taskId, userId) => {
    state.tasks = state.tasks.filter((task) => !(task.taskId === taskId && task.userId === userId))
  }),
  getUploadTaskByMessageId: vi.fn(async (messageId, userId) => state.tasks.find((task) => task.messageId === messageId && task.userId === userId)),
  getUploadTaskByTaskId: vi.fn(async (taskId, userId) => state.tasks.find((task) => task.taskId === taskId && task.userId === userId)),
  listUploadTasksByStates: vi.fn(async (states, userId) => state.tasks.filter((task) => task.userId === userId && states.includes(task.state))),
  saveUploadTask: vi.fn(async (task, userId) => {
    const saved = { ...task, userId, updatedAt: Date.now() }
    const index = state.tasks.findIndex((item) => item.taskId === saved.taskId && item.userId === userId)
    if (index >= 0) state.tasks[index] = saved
    else state.tasks.push(saved)
    state.saved.push(saved)
    return saved
  })
}))

describe('uploadTaskManager', () => {
  beforeEach(async () => {
    state.tasks = []
    state.saved = []
    vi.clearAllMocks()
    const manager = await import('../../src/main/uploadTaskManager')
    await manager.deactivateUploadTasks()
  })

  it('binds a new task and its source pin to the activated user', async () => {
    const manager = await import('../../src/main/uploadTaskManager')
    const sourceRegistry = await import('../../src/main/uploadSourceRegistry')
    manager.activateUploadTasks({ userId: 'alice', token: 'alice-token' })

    const result = await manager.enqueueUploadTask({ messageId: 12, uploadSourceId: 's-12', fileType: 5 })

    expect(result.success).toBe(true)
    expect(state.tasks[0]).toMatchObject({ userId: 'alice', messageId: 12, state: 'queued' })
    expect(sourceRegistry.getUploadSource).toHaveBeenCalledWith('s-12', { userId: 'alice' })
    expect(sourceRegistry.setUploadSourcePinned).toHaveBeenCalledWith({
      uploadSourceId: 's-12',
      userId: 'alice',
      pinned: true
    })
  })

  it('reconciles an awaiting ACK task from the server terminal status', async () => {
    const manager = await import('../../src/main/uploadTaskManager')
    const axios = (await import('axios')).default
    state.tasks = [{ taskId: 't-1', userId: 'alice', messageId: 13, uploadSourceId: 's-13', state: 'awaiting_ack', fileSize: 8 }]
    axios.post.mockResolvedValue({ data: { code: 200, data: { terminal: true, messageStatus: 1, failed: false } } })
    const onTerminalStatus = vi.fn()
    manager.activateUploadTasks({ userId: 'alice', token: 'alice-token' })

    const recovery = await manager.resumePersistedUploadTasks({ onTerminalStatus })

    expect(recovery.protectedMessageIds).toEqual([13])
    expect(state.tasks).toHaveLength(0)
    expect(onTerminalStatus).toHaveBeenCalledWith(expect.objectContaining({ messageId: 13, succeeded: true }))
  })

  it('requeues only the deactivated user tasks during an account switch', async () => {
    const manager = await import('../../src/main/uploadTaskManager')
    state.tasks = [
      { taskId: 'a', userId: 'alice', state: 'uploading' },
      { taskId: 'b', userId: 'bob', state: 'uploading' }
    ]
    manager.activateUploadTasks({ userId: 'alice', token: 'alice-token' })

    await manager.deactivateUploadTasks()

    expect(state.tasks.find((task) => task.taskId === 'a').state).toBe('queued')
    expect(state.tasks.find((task) => task.taskId === 'b').state).toBe('uploading')
  })

  it('does not overwrite a paused task when an in-flight request resolves', async () => {
    const manager = await import('../../src/main/uploadTaskManager')
    const axios = (await import('axios')).default
    let resolveInit
    axios.post.mockImplementationOnce(
      () => new Promise((resolve) => { resolveInit = resolve })
    )
    manager.activateUploadTasks({ userId: 'alice', token: 'alice-token' })

    await manager.enqueueUploadTask({ messageId: 14, uploadSourceId: 's-14', fileType: 5 })
    await vi.waitFor(() => expect(axios.post).toHaveBeenCalledTimes(1))
    await manager.pauseUploadTask({ messageId: 14 })
    resolveInit({ data: { code: 200, data: { uploadId: 'u-14', uploadedChunks: [], completed: false } } })
    await vi.waitFor(() => expect(state.tasks[0].state).toBe('paused'))

    expect(state.tasks[0].state).toBe('paused')
  })

  it('rejects control operations after its runtime has been deactivated', async () => {
    const manager = await import('../../src/main/uploadTaskManager')
    const dao = await import('../../src/main/db/UploadTaskModel')
    manager.activateUploadTasks({ userId: 'alice', token: 'alice-token' })
    await manager.deactivateUploadTasks()

    const result = await manager.pauseUploadTask({ messageId: 15 })

    expect(result).toMatchObject({ success: false, kind: 'not_logged_in' })
    expect(dao.getUploadTaskByMessageId).not.toHaveBeenCalled()
  })

  it('resumes only paused or failed tasks', async () => {
    const manager = await import('../../src/main/uploadTaskManager')
    state.tasks = [{ taskId: 'done', userId: 'alice', messageId: 16, state: 'succeeded' }]
    manager.activateUploadTasks({ userId: 'alice', token: 'alice-token' })

    const result = await manager.resumeUploadTask({ messageId: 16 })

    expect(result).toMatchObject({ success: false, kind: 'invalid_state' })
    expect(state.tasks[0].state).toBe('succeeded')
  })

  it('allows a paused task to be canceled', async () => {
    const manager = await import('../../src/main/uploadTaskManager')
    state.tasks = [{ taskId: 'paused', userId: 'alice', messageId: 17, uploadSourceId: 's-17', state: 'paused' }]
    manager.activateUploadTasks({ userId: 'alice', token: 'alice-token' })

    const result = await manager.cancelUploadTask({ messageId: 17 })

    expect(result).toMatchObject({ success: true, state: 'canceled' })
    expect(state.tasks).toHaveLength(0)
  })

  it('cleans expired failed tasks and their retained source metadata on login recovery', async () => {
    const manager = await import('../../src/main/uploadTaskManager')
    const sourceRegistry = await import('../../src/main/uploadSourceRegistry')
    const coverRegistry = await import('../../src/main/uploadCoverRegistry')
    state.tasks = [{
      taskId: 'expired',
      userId: 'alice',
      messageId: 171,
      uploadSourceId: 's-expired',
      coverSourceId: 'cover-expired',
      state: 'failed',
      updatedAt: Date.now() - 8 * 24 * 60 * 60 * 1000
    }]
    manager.activateUploadTasks({ userId: 'alice', token: 'alice-token' })

    await manager.resumePersistedUploadTasks()

    expect(state.tasks).toHaveLength(0)
    expect(sourceRegistry.releaseUploadSource).toHaveBeenCalledWith({
      uploadSourceId: 's-expired',
      userId: 'alice'
    })
    expect(coverRegistry.releaseUploadCover).toHaveBeenCalledWith({
      coverSourceId: 'cover-expired',
      userId: 'alice'
    })
  })

  it('marks a recovered task failed locally when its source is unavailable', async () => {
    const manager = await import('../../src/main/uploadTaskManager')
    const sourceRegistry = await import('../../src/main/uploadSourceRegistry')
    const onTerminalStatus = vi.fn()
    state.tasks = [{ taskId: 'missing', userId: 'alice', messageId: 18, uploadSourceId: 's-18', state: 'queued' }]
    sourceRegistry.getUploadSource.mockRejectedValueOnce(new Error('Upload source is unavailable'))
    manager.activateUploadTasks({ userId: 'alice', token: 'alice-token' })

    await manager.resumePersistedUploadTasks({ onTerminalStatus })
    await vi.waitFor(() => expect(state.tasks[0].state).toBe('failed'))

    expect(onTerminalStatus).toHaveBeenCalledWith(expect.objectContaining({ messageId: 18, succeeded: false }))
  })

  it('submits a persisted cover with the complete request', async () => {
    const manager = await import('../../src/main/uploadTaskManager')
    const axios = (await import('axios')).default
    const sourceRegistry = await import('../../src/main/uploadSourceRegistry')
    sourceRegistry.readUploadSourceChunk.mockResolvedValueOnce({
      success: true,
      arrayBuffer: new ArrayBuffer(8)
    })
    axios.post.mockImplementation(async (url) => {
      if (url.endsWith('/init')) {
        return { data: { code: 200, data: { uploadId: 'u-cover', uploadedChunks: [] } } }
      }
      if (url.endsWith('/chunk')) return { data: { code: 200, data: {} } }
      if (url.endsWith('/complete')) return { data: { code: 200, data: {} } }
      return { data: { code: 200, data: { terminal: false } } }
    })
    manager.activateUploadTasks({ userId: 'alice', token: 'alice-token' })

    await manager.enqueueUploadTask({
      messageId: 19,
      uploadSourceId: 's-19',
      coverSourceId: 'cover-19',
      fileName: 'video.mp4',
      fileSize: 8,
      fileType: 1
    })

    await vi.waitFor(() => {
      expect(axios.post.mock.calls.some(([url]) => url.endsWith('/complete'))).toBe(true)
    })
    const completeRequest = axios.post.mock.calls.find(([url]) => url.endsWith('/complete'))
    expect(completeRequest[1].get('cover')).toBeInstanceOf(Blob)
  })

  it('fails a task when the server returns invalid uploaded chunk indexes', async () => {
    const manager = await import('../../src/main/uploadTaskManager')
    const axios = (await import('axios')).default
    axios.post.mockResolvedValueOnce({
      data: { code: 200, data: { uploadId: 'u-invalid', uploadedChunks: [1] } }
    })
    manager.activateUploadTasks({ userId: 'alice', token: 'alice-token' })

    await manager.enqueueUploadTask({ messageId: 20, uploadSourceId: 's-20', fileType: 5 })
    await vi.waitFor(() => expect(state.tasks[0]?.state).toBe('failed'))

    expect(state.tasks[0].lastError).toContain('invalid uploadedChunks')
  })

  it('retries a non-terminal ACK reconciliation while the runtime remains active', async () => {
    vi.useFakeTimers()
    const manager = await import('../../src/main/uploadTaskManager')
    const axios = (await import('axios')).default
    state.tasks = [{
      taskId: 'ack-retry',
      userId: 'alice',
      messageId: 21,
      uploadSourceId: 's-21',
      state: 'awaiting_ack',
      fileSize: 8
    }]
    axios.post
      .mockResolvedValueOnce({ data: { code: 200, data: { terminal: false } } })
      .mockResolvedValueOnce({
        data: { code: 200, data: { terminal: true, messageStatus: 1, failed: false } }
      })
    const onTerminalStatus = vi.fn()
    manager.activateUploadTasks({ userId: 'alice', token: 'alice-token' })

    await manager.resumePersistedUploadTasks({ onTerminalStatus })
    expect(state.tasks).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)

    expect(state.tasks).toHaveLength(0)
    expect(onTerminalStatus).toHaveBeenCalledWith(expect.objectContaining({ messageId: 21, succeeded: true }))
  })
})
