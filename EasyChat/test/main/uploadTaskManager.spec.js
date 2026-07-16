import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ tasks: [], saved: [], source: { name: 'demo.bin', size: 8 } }))

vi.mock('axios', () => ({ default: { post: vi.fn() } }))
vi.mock('../../src/main/store', () => ({
  default: { getData: vi.fn(() => 'http://api.example.test') }
}))
vi.mock('../../src/main/uploadSourceRegistry', () => ({
  MAX_CHUNK_SIZE: 4 * 1024 * 1024,
  getUploadSource: vi.fn(async () => state.source),
  setUploadSourcePinned: vi.fn(async () => {}),
  readUploadSourceChunk: vi.fn()
}))
vi.mock('../../src/main/db/UploadTaskModel', () => ({
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
    expect(state.tasks[0].state).toBe('succeeded')
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
    expect(state.tasks[0].state).toBe('canceled')
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
})
