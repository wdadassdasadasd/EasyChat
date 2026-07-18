import { createHash, randomUUID } from 'crypto'
import axios from 'axios'
import { runtimeConfig } from '../shared/runtimeConfig.js'
import {
  MAX_CHUNK_SIZE,
  getUploadSource,
  readUploadSourceChunk,
  releaseUploadSource,
  setUploadSourcePinned
} from './uploadSourceRegistry.js'
import { readUploadCover, releaseUploadCover } from './uploadCoverRegistry.js'
import {
  deleteUploadTask,
  getUploadTaskByMessageId,
  getUploadTaskByTaskId,
  listUploadTasksByStates,
  saveUploadTask,
  transitionUploadTask
} from './db/UploadTaskModel.js'

const TASK_STATES = Object.freeze({
  QUEUED: 'queued', UPLOADING: 'uploading', PAUSED: 'paused', FAILED: 'failed',
  CANCELED: 'canceled', CANCELING: 'canceling', AWAITING_ACK: 'awaiting_ack', SUCCEEDED: 'succeeded'
})
const MAX_CONCURRENT_UPLOADS = 2
const RETRY_DELAYS = [0, 1000, 3000]
const ACK_RECONCILE_DELAYS = [0, 1000, 3000, 10000, 30000, 60000]
const FAILED_TASK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const activeControllers = new Map()
const ackTimers = new Map()
let runtime = { generation: 0, userId: null, token: '', apiBaseUrl: '', eventTarget: null }

const getApiBaseUrl = () => runtimeConfig.apiBaseUrl
const isActive = (context) => context && runtime.generation === context.generation && runtime.userId === context.userId
const getActiveContext = () => (runtime.userId && isActive(runtime) ? runtime : null)
const getTaskKey = (context, taskId) => `${context.userId}:${taskId}`
const getActiveCount = (context) => [...activeControllers.values()].filter((entry) => entry.context.generation === context.generation).length
const getCurrentUploadingTask = async (task, context, attemptId) => {
  const entry = activeControllers.get(getTaskKey(context, task.taskId))
  if (!isActive(context) || !entry || entry.attemptId !== attemptId || entry.invalidated) return null
  const latest = await getUploadTaskByTaskId(task.taskId, context.userId)
  return isActive(context) && latest?.state === TASK_STATES.UPLOADING ? latest : null
}
const createProtocolError = (message) => {
  const error = new Error(message)
  error.kind = 'protocol_error'
  return error
}
const normalizeUploadedChunks = (value, totalChunks) => {
  if (value == null) return new Set()
  if (!Array.isArray(value)) {
    throw createProtocolError('Upload server returned invalid uploadedChunks')
  }
  const uploaded = new Set()
  for (const index of value) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= totalChunks || uploaded.has(index)) {
      throw createProtocolError('Upload server returned invalid uploadedChunks')
    }
    uploaded.add(index)
  }
  return uploaded
}
const getUploadedBytes = (uploaded, fileSize) => {
  return [...uploaded].reduce((sum, index) => {
    const start = index * MAX_CHUNK_SIZE
    return sum + Math.max(0, Math.min(MAX_CHUNK_SIZE, fileSize - start))
  }, 0)
}
const request = async (context, path, data, { signal, multipart = false } = {}) => {
  const headers = { 'X-Requested-With': 'XMLHttpRequest' }
  if (context.token) headers.Authorization = `Bearer ${context.token}`
  const response = await axios.post(`${context.apiBaseUrl}${path}`, multipart ? data : new URLSearchParams(data), { signal, timeout: 30000, headers })
  if (response.data?.code !== 200) {
    const error = new Error(response.data?.info || 'Upload request failed')
    error.kind = 'api_code'
    error.code = response.data?.code
    throw error
  }
  return response.data.data
}
const emitTask = (task, context) => {
  if (!isActive(context) || !context.eventTarget || context.eventTarget.isDestroyed?.()) return
  context.eventTarget.send('uploadTaskProgress', {
    taskId: task.taskId, messageId: task.messageId, state: task.state,
    uploadedBytes: Number(task.uploadedBytes || 0), fileSize: Number(task.fileSize || 0),
    progress: task.fileSize ? Math.min(100, Math.max(0, Math.round((task.uploadedBytes / task.fileSize) * 100))) : 0,
    error: task.lastError || ''
  })
}
const persistAndEmit = async (task, allowedStates, patch, context) => {
  const result = await transitionUploadTask({
    taskId: task.taskId,
    allowedStates,
    patch: { ...patch, userId: context.userId }
  }, context.userId)
  if (!result.transitioned) return null
  emitTask(result.task, context)
  return result.task
}
const isRetryable = (error) => {
  const status = Number(error?.response?.status || 0)
  return !status || status === 408 || status === 429 || status >= 500
}
const withRetry = async (operation, signal) => {
  let lastError
  for (const delay of RETRY_DELAYS) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
    if (signal?.aborted) throw new axios.CanceledError('Upload canceled')
    try { return await operation() } catch (error) { lastError = error; if (!isRetryable(error)) break }
  }
  throw lastError
}
const clearAckReconcile = (context, taskId) => {
  const key = getTaskKey(context, taskId)
  const entry = ackTimers.get(key)
  if (!entry) return
  clearTimeout(entry.timer)
  ackTimers.delete(key)
}
const clearAckReconcilesForGeneration = (generation) => {
  for (const [key, entry] of ackTimers.entries()) {
    if (entry.context.generation !== generation) continue
    clearTimeout(entry.timer)
    ackTimers.delete(key)
  }
}
const scheduleAckReconcile = (context, taskId, attempt = 0) => {
  if (!isActive(context)) return
  clearAckReconcile(context, taskId)
  const delay = ACK_RECONCILE_DELAYS[Math.min(attempt, ACK_RECONCILE_DELAYS.length - 1)]
  const key = getTaskKey(context, taskId)
  const timer = setTimeout(() => {
    ackTimers.delete(key)
    void reconcileTerminalTask(context, taskId, attempt)
  }, delay)
  ackTimers.set(key, { context, timer })
}
const settleTerminalTask = async (task, succeeded, error, context) => {
  const terminalState = succeeded ? TASK_STATES.SUCCEEDED : task.state === TASK_STATES.CANCELING ? TASK_STATES.CANCELED : TASK_STATES.FAILED
  const next = await persistAndEmit(
    task,
    [TASK_STATES.AWAITING_ACK, TASK_STATES.CANCELING],
    { state: terminalState, lastError: succeeded ? '' : String(error || 'Server file processing failed') },
    context
  )
  if (!next) return { settled: false }

  clearAckReconcile(context, task.taskId)
  await setUploadSourcePinned({ uploadSourceId: next.uploadSourceId, userId: context.userId, pinned: false })
  const shouldRelease = succeeded || task.state === TASK_STATES.CANCELING
  if (shouldRelease) {
    await Promise.all([
      releaseUploadSource({ uploadSourceId: next.uploadSourceId, userId: context.userId }),
      next.coverSourceId
        ? releaseUploadCover({ coverSourceId: next.coverSourceId, userId: context.userId })
        : Promise.resolve()
    ])
    await deleteUploadTask(next.taskId, context.userId)
  }
  await context.onTerminalStatus?.({ messageId: next.messageId, succeeded, error: next.lastError })
  return { settled: true, task: next, released: shouldRelease }
}
const reconcileTerminalTask = async (context, taskId, attempt = 0) => {
  if (!isActive(context)) return
  const task = await getUploadTaskByTaskId(taskId, context.userId)
  if (!isActive(context) || ![TASK_STATES.AWAITING_ACK, TASK_STATES.CANCELING].includes(task?.state)) return
  try {
    if (task.state === TASK_STATES.CANCELING) {
      await request(context, '/chat/uploadFile/cancel', {
        messageId: task.messageId,
        uploadId: task.uploadId || ''
      })
    }
    const status = await request(context, '/chat/uploadFile/status', {
      messageId: task.messageId,
      uploadId: task.uploadId || ''
    })
    if (!isActive(context)) return
    if (status?.terminal) {
      const succeeded = Number(status.messageStatus) === 1 && !status.failed
      await settleTerminalTask(task, succeeded, status.error, context)
      return
    }
  } catch (error) {
    console.warn('Failed to reconcile upload task terminal state', error)
  }
  if (isActive(context)) scheduleAckReconcile(context, taskId, attempt + 1)
}
const schedule = (context = runtime) => {
  if (!isActive(context) || !context.userId || getActiveCount(context) >= MAX_CONCURRENT_UPLOADS) return
  void listUploadTasksByStates([TASK_STATES.QUEUED], context.userId).then((tasks) => {
    for (const task of tasks) {
      if (!isActive(context) || getActiveCount(context) >= MAX_CONCURRENT_UPLOADS) break
      if (!activeControllers.has(getTaskKey(context, task.taskId))) void runTask(task, context)
    }
  }).catch((error) => console.error('Failed to schedule upload tasks', error))
}
const runTask = async (initialTask, context) => {
  const taskKey = getTaskKey(context, initialTask.taskId)
  if (!isActive(context) || activeControllers.has(taskKey) || getActiveCount(context) >= MAX_CONCURRENT_UPLOADS) return
  const controller = new AbortController()
  const attemptId = randomUUID()
  const entry = { controller, context, attemptId, invalidated: false }
  activeControllers.set(taskKey, entry)
  let task = initialTask
  let sourceResolved = false
  try {
    const source = await getUploadSource(task.uploadSourceId, { userId: context.userId })
    sourceResolved = true
    if (!isActive(context) || entry.invalidated) return
    const totalChunks = Math.ceil(source.size / MAX_CHUNK_SIZE)
    task = await persistAndEmit(task, [TASK_STATES.QUEUED], { state: TASK_STATES.UPLOADING, fileName: source.name || task.fileName, fileSize: source.size, totalChunks, lastError: '' }, context)
    if (!task) return
    const init = await withRetry(() => request(context, '/chat/uploadFile/init', {
      messageId: task.messageId, fileName: task.fileName, fileSize: task.fileSize, fileType: task.fileType ?? '',
      totalChunks, chunkSize: MAX_CHUNK_SIZE, fileFingerprint: task.taskId
    }, { signal: controller.signal }), controller.signal)
    task = await getCurrentUploadingTask(task, context, attemptId)
    if (!task) return
    const uploadId = init?.uploadId
    if (!uploadId) throw new Error('Upload server did not return uploadId')
    const uploaded = normalizeUploadedChunks(init.uploadedChunks, totalChunks)
    task = await persistAndEmit(task, [TASK_STATES.UPLOADING], {
      uploadId,
      totalChunks,
      uploadedBytes: getUploadedBytes(uploaded, task.fileSize)
    }, context)
    if (!task) return
    if (!init.completed) {
      for (let index = 0; index < totalChunks; index += 1) {
        if (uploaded.has(index)) continue
        if (!isActive(context)) return
        const start = index * MAX_CHUNK_SIZE
        const end = Math.min(task.fileSize, start + MAX_CHUNK_SIZE)
        const chunk = await readUploadSourceChunk({ uploadSourceId: task.uploadSourceId, start, end, userId: context.userId })
        task = await getCurrentUploadingTask(task, context, attemptId)
        if (!task) return
        const chunkBuffer = Buffer.from(chunk.arrayBuffer)
        const form = new FormData()
        form.append('uploadId', uploadId); form.append('messageId', String(task.messageId)); form.append('chunkIndex', String(index)); form.append('totalChunks', String(totalChunks))
        form.append('chunkChecksum', createHash('md5').update(chunkBuffer).digest('hex'))
        form.append('chunk', new Blob([chunkBuffer]), `${index}.chunk`)
        await withRetry(() => request(context, '/chat/uploadFile/chunk', form, { signal: controller.signal, multipart: true }), controller.signal)
        task = await getCurrentUploadingTask(task, context, attemptId)
        if (!task) return
        task = await persistAndEmit(task, [TASK_STATES.UPLOADING], { uploadedBytes: end }, context)
        if (!task) return
      }
      const completePayload = {
        uploadId,
        messageId: task.messageId,
        fileName: task.fileName,
        fileSize: task.fileSize,
        fileType: task.fileType ?? '',
        totalChunks
      }
      let completeRequest = completePayload
      let completeIsMultipart = false
      if (task.coverSourceId) {
        const { cover, buffer } = await readUploadCover({
          coverSourceId: task.coverSourceId,
          userId: context.userId
        })
        const form = new FormData()
        for (const [key, value] of Object.entries(completePayload)) form.append(key, String(value))
        form.append('cover', new Blob([buffer], { type: cover.type }), 'cover')
        completeRequest = form
        completeIsMultipart = true
      }
      await withRetry(
        () => request(context, '/chat/uploadFile/complete', completeRequest, {
          signal: controller.signal,
          multipart: completeIsMultipart
        }),
        controller.signal
      )
    }
    task = await getCurrentUploadingTask(task, context, attemptId)
    if (!task) return
    task = await persistAndEmit(task, [TASK_STATES.UPLOADING], { state: TASK_STATES.AWAITING_ACK, uploadedBytes: task.fileSize, lastError: '' }, context)
    if (!task) return
    scheduleAckReconcile(context, task.taskId)
  } catch (error) {
    const latest = await getUploadTaskByTaskId(initialTask.taskId, context.userId)
    const ownsAttempt = activeControllers.get(taskKey)?.attemptId === attemptId && !entry.invalidated
    if (
      isActive(context) &&
      ownsAttempt &&
      (latest?.state === TASK_STATES.UPLOADING || (!sourceResolved && latest?.state === TASK_STATES.QUEUED))
    ) {
      const failed = await persistAndEmit(
        latest,
        [TASK_STATES.UPLOADING, TASK_STATES.QUEUED],
        { state: TASK_STATES.FAILED, lastError: error?.message || 'Upload failed' },
        context
      )
      if (!failed) return
      if (!sourceResolved) {
        await setUploadSourcePinned({ uploadSourceId: failed.uploadSourceId, userId: context.userId, pinned: false })
        await context.onTerminalStatus?.({ messageId: failed.messageId, succeeded: false, error: failed.lastError })
      }
    }
  } finally {
    if (activeControllers.get(taskKey)?.attemptId === attemptId) activeControllers.delete(taskKey)
    schedule(context)
  }
}
const enqueueUploadTask = async ({ messageId, uploadSourceId, coverSourceId, fileName, fileSize, fileType } = {}) => {
  const context = getActiveContext()
  if (!context) return { success: false, kind: 'not_logged_in', error: 'Upload context is unavailable' }
  const source = await getUploadSource(uploadSourceId, { userId: context.userId })
  const existing = await getUploadTaskByMessageId(messageId, context.userId)
  if (existing && [TASK_STATES.QUEUED, TASK_STATES.UPLOADING, TASK_STATES.AWAITING_ACK, TASK_STATES.CANCELING].includes(existing.state)) {
    return { success: true, taskId: existing.taskId, state: existing.state, reused: true }
  }
  if (existing?.coverSourceId && coverSourceId && existing.coverSourceId !== coverSourceId) {
    await releaseUploadCover({ coverSourceId: existing.coverSourceId, userId: context.userId })
  }
  const patch = {
    userId: context.userId,
    uploadSourceId,
    coverSourceId: coverSourceId || existing?.coverSourceId,
    fileName: String(fileName || source.name || ''),
    fileSize: Number(fileSize || source.size),
    fileType: Number(fileType),
    state: TASK_STATES.QUEUED,
    lastError: ''
  }
  const task = existing
    ? await persistAndEmit(existing, [TASK_STATES.PAUSED, TASK_STATES.FAILED], patch, context)
    : await saveUploadTask({ ...patch, taskId: randomUUID(), messageId }, context.userId)
  if (!task) return { success: false, kind: 'invalid_state', error: 'Upload task cannot be queued in its current state' }
  await setUploadSourcePinned({ uploadSourceId, userId: context.userId, pinned: true })
  emitTask(task, context); schedule(context)
  return { success: true, taskId: task.taskId, state: task.state }
}
const pauseUploadTask = async ({ messageId } = {}) => {
  const context = getActiveContext()
  if (!context) return { success: false, kind: 'not_logged_in', error: 'Upload context is unavailable' }
  const task = await getUploadTaskByMessageId(messageId, context.userId)
  if (!task) return { success: false, kind: 'not_found', error: 'Upload task not found' }
  const entry = activeControllers.get(getTaskKey(context, task.taskId))
  if (entry) {
    entry.invalidated = true
    entry.controller.abort()
  }
  const next = await persistAndEmit(task, [TASK_STATES.QUEUED, TASK_STATES.UPLOADING], { state: TASK_STATES.PAUSED }, context)
  if (!next) return { success: false, kind: 'invalid_state', error: 'Upload task cannot be paused in its current state' }
  return { success: true, taskId: next.taskId, state: next.state }
}
const resumeUploadTask = async ({ messageId } = {}) => {
  const context = getActiveContext()
  if (!context) return { success: false, kind: 'not_logged_in', error: 'Upload context is unavailable' }
  const task = await getUploadTaskByMessageId(messageId, context.userId)
  if (!task) return { success: false, kind: 'not_found', error: 'Upload task not found' }
  if (![TASK_STATES.PAUSED, TASK_STATES.FAILED].includes(task.state)) {
    return { success: false, kind: 'invalid_state', error: 'Upload task cannot be resumed in its current state' }
  }
  const next = await persistAndEmit(task, [TASK_STATES.PAUSED, TASK_STATES.FAILED], { state: TASK_STATES.QUEUED, lastError: '' }, context)
  if (!next) return { success: false, kind: 'invalid_state', error: 'Upload task cannot be resumed in its current state' }
  schedule(context); return { success: true, taskId: next.taskId, state: next.state }
}
const cancelUploadTask = async ({ messageId } = {}) => {
  const context = getActiveContext()
  if (!context) return { success: false, kind: 'not_logged_in', error: 'Upload context is unavailable' }
  const task = await getUploadTaskByMessageId(messageId, context.userId)
  if (!task) return { success: true, canceled: false }
  const entry = activeControllers.get(getTaskKey(context, task.taskId))
  if (entry) {
    entry.invalidated = true
    entry.controller.abort()
  }
  const next = await persistAndEmit(
    task,
    [TASK_STATES.QUEUED, TASK_STATES.UPLOADING, TASK_STATES.PAUSED, TASK_STATES.FAILED, TASK_STATES.AWAITING_ACK],
    { state: TASK_STATES.CANCELING, lastError: '' },
    context
  )
  if (!next) return { success: false, kind: 'invalid_state', error: 'Upload task cannot be canceled in its current state' }
  clearAckReconcile(context, task.taskId)
  await reconcileTerminalTask(context, next.taskId)
  const latest = await getUploadTaskByTaskId(next.taskId, context.userId)
  return { success: true, taskId: next.taskId, state: latest?.state || TASK_STATES.CANCELED }
}
const acknowledgeUploadTask = async ({ messageId, succeeded, error } = {}) => {
  const context = getActiveContext()
  if (!context) return { success: false, kind: 'not_logged_in', error: 'Upload context is unavailable' }
  const task = await getUploadTaskByMessageId(messageId, context.userId)
  if (!task) return { success: true, acknowledged: false }
  const result = await settleTerminalTask(task, succeeded, error, context)
  if (!result.settled) return { success: true, acknowledged: false }
  return { success: true, acknowledged: true, taskId: result.task.taskId, state: result.task.state }
}
const cleanupExpiredFailedTasks = async (context) => {
  const cutoff = Date.now() - FAILED_TASK_RETENTION_MS
  const failedTasks = await listUploadTasksByStates([TASK_STATES.FAILED], context.userId)
  await Promise.all(
    failedTasks
      .filter((task) => Number(task.updatedAt || task.createdAt || 0) > 0)
      .filter((task) => Number(task.updatedAt || task.createdAt) < cutoff)
      .map(async (task) => {
        try {
          await deleteUploadTask(task.taskId, context.userId)
          await Promise.all([
            releaseUploadSource({ uploadSourceId: task.uploadSourceId, userId: context.userId }),
            task.coverSourceId
              ? releaseUploadCover({ coverSourceId: task.coverSourceId, userId: context.userId })
              : Promise.resolve()
          ])
        } catch (error) {
          console.error('Failed to clean expired upload task', error)
        }
      })
  )
}
const resumePersistedUploadTasks = async ({ onTerminalStatus } = {}) => {
  const context = getActiveContext()
  if (!context) return { protectedMessageIds: [] }
  context.onTerminalStatus = onTerminalStatus || context.onTerminalStatus
  await cleanupExpiredFailedTasks(context)
  const tasks = await listUploadTasksByStates([
    TASK_STATES.UPLOADING,
    TASK_STATES.QUEUED,
    TASK_STATES.PAUSED,
    TASK_STATES.AWAITING_ACK,
    TASK_STATES.CANCELING
  ], context.userId)
  const protectedMessageIds = tasks.map((task) => task.messageId)
  for (const task of tasks) {
    await setUploadSourcePinned({ uploadSourceId: task.uploadSourceId, userId: context.userId, pinned: true })
    if (task.state === TASK_STATES.UPLOADING) {
      await persistAndEmit(task, [TASK_STATES.UPLOADING], { state: TASK_STATES.QUEUED }, context)
    }
    if ([TASK_STATES.AWAITING_ACK, TASK_STATES.CANCELING].includes(task.state)) {
      await reconcileTerminalTask(context, task.taskId)
    }
  }
  schedule(context)
  return { protectedMessageIds }
}
const activateUploadTasks = ({ userId, token, eventTarget, onTerminalStatus } = {}) => {
  runtime = {
    generation: runtime.generation + 1,
    userId,
    token: String(token || ''),
    apiBaseUrl: getApiBaseUrl(),
    eventTarget: eventTarget || null,
    onTerminalStatus: onTerminalStatus || null
  }
  return runtime
}
const deactivateUploadTasks = async () => {
  const previous = runtime
  runtime = { generation: runtime.generation + 1, userId: null, token: '', apiBaseUrl: '', eventTarget: null, onTerminalStatus: null }
  for (const entry of activeControllers.values()) if (entry.context.generation === previous.generation) entry.controller.abort()
  clearAckReconcilesForGeneration(previous.generation)
  const tasks = previous.userId ? await listUploadTasksByStates([TASK_STATES.UPLOADING, TASK_STATES.QUEUED], previous.userId) : []
  await Promise.all(tasks.map((task) => transitionUploadTask({
    taskId: task.taskId,
    allowedStates: [TASK_STATES.UPLOADING, TASK_STATES.QUEUED],
    patch: { state: TASK_STATES.QUEUED }
  }, previous.userId)))
}
const setUploadTaskEventTarget = (eventTarget) => { if (runtime.userId) runtime = { ...runtime, eventTarget } }
const getUploadTaskDiagnostics = () => ({
  activeUploadCount: getActiveCount(runtime),
  pendingAckCount: [...ackTimers.values()].filter((entry) => entry.context.generation === runtime.generation)
    .length,
  active: Boolean(runtime.userId)
})
export { TASK_STATES, acknowledgeUploadTask, activateUploadTasks, cancelUploadTask, deactivateUploadTasks, enqueueUploadTask, getUploadTaskDiagnostics, pauseUploadTask, resumePersistedUploadTasks, resumeUploadTask, setUploadTaskEventTarget }
