import { createHash, randomUUID } from 'crypto'
import axios from 'axios'
import { runtimeConfig } from '../shared/runtimeConfig.js'
import { MAX_CHUNK_SIZE, getUploadSource, readUploadSourceChunk, setUploadSourcePinned } from './uploadSourceRegistry.js'
import {
  getUploadTaskByMessageId,
  getUploadTaskByTaskId,
  listUploadTasksByStates,
  saveUploadTask
} from './db/UploadTaskModel.js'

const TASK_STATES = Object.freeze({
  QUEUED: 'queued', UPLOADING: 'uploading', PAUSED: 'paused', FAILED: 'failed',
  CANCELED: 'canceled', AWAITING_ACK: 'awaiting_ack', SUCCEEDED: 'succeeded'
})
const MAX_CONCURRENT_UPLOADS = 2
const RETRY_DELAYS = [0, 1000, 3000]
const activeControllers = new Map()
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
const request = async (context, path, data, { signal, multipart = false } = {}) => {
  const headers = { 'X-Requested-With': 'XMLHttpRequest' }
  if (context.token) Object.assign(headers, { token: context.token, Authorization: `Bearer ${context.token}` })
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
    progress: task.fileSize ? Math.min(100, Math.round((task.uploadedBytes / task.fileSize) * 100)) : 0,
    error: task.lastError || ''
  })
}
const persistAndEmit = async (task, patch, context) => {
  const next = await saveUploadTask({ ...task, ...patch, userId: context.userId }, context.userId)
  emitTask(next, context)
  return next
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
    task = await persistAndEmit(task, { state: TASK_STATES.UPLOADING, fileName: source.name || task.fileName, fileSize: source.size, totalChunks, lastError: '' }, context)
    const init = await withRetry(() => request(context, '/chat/uploadFile/init', {
      messageId: task.messageId, fileName: task.fileName, fileSize: task.fileSize, fileType: task.fileType ?? '',
      totalChunks, chunkSize: MAX_CHUNK_SIZE, fileFingerprint: task.taskId
    }, { signal: controller.signal }), controller.signal)
    task = await getCurrentUploadingTask(task, context, attemptId)
    if (!task) return
    const uploadId = init?.uploadId
    if (!uploadId) throw new Error('Upload server did not return uploadId')
    const uploaded = new Set((init.uploadedChunks || []).map(Number))
    task = await persistAndEmit(task, { uploadId, totalChunks, uploadedBytes: [...uploaded].reduce((sum, index) => sum + Math.min(MAX_CHUNK_SIZE, task.fileSize - index * MAX_CHUNK_SIZE), 0) }, context)
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
        task = await persistAndEmit(task, { uploadedBytes: end }, context)
      }
      await withRetry(() => request(context, '/chat/uploadFile/complete', {
        uploadId, messageId: task.messageId, fileName: task.fileName, fileSize: task.fileSize, fileType: task.fileType ?? '', totalChunks
      }, { signal: controller.signal }), controller.signal)
    }
    task = await getCurrentUploadingTask(task, context, attemptId)
    if (!task) return
    await persistAndEmit(task, { state: TASK_STATES.AWAITING_ACK, uploadedBytes: task.fileSize, lastError: '' }, context)
  } catch (error) {
    const latest = await getUploadTaskByTaskId(initialTask.taskId, context.userId)
    const ownsAttempt = activeControllers.get(taskKey)?.attemptId === attemptId && !entry.invalidated
    if (
      isActive(context) &&
      ownsAttempt &&
      (latest?.state === TASK_STATES.UPLOADING || (!sourceResolved && latest?.state === TASK_STATES.QUEUED))
    ) {
      const failed = await persistAndEmit(latest, { state: TASK_STATES.FAILED, lastError: error?.message || 'Upload failed' }, context)
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
const enqueueUploadTask = async ({ messageId, uploadSourceId, fileName, fileSize, fileType } = {}) => {
  const context = getActiveContext()
  if (!context) return { success: false, kind: 'not_logged_in', error: 'Upload context is unavailable' }
  const source = await getUploadSource(uploadSourceId, { userId: context.userId })
  const existing = await getUploadTaskByMessageId(messageId, context.userId)
  const task = await saveUploadTask({ ...existing, userId: context.userId, taskId: existing?.taskId || randomUUID(), messageId, uploadSourceId, fileName: String(fileName || source.name || ''), fileSize: Number(fileSize || source.size), fileType: Number(fileType), state: TASK_STATES.QUEUED, lastError: '' }, context.userId)
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
  const next = await persistAndEmit(task, { state: TASK_STATES.PAUSED }, context)
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
  const next = await persistAndEmit(task, { state: TASK_STATES.QUEUED, lastError: '' }, context)
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
  const next = await persistAndEmit(task, { state: TASK_STATES.CANCELED }, context)
  await setUploadSourcePinned({ uploadSourceId: task.uploadSourceId, userId: context.userId, pinned: false })
  if (task.uploadId && isActive(context)) void request(context, '/chat/uploadFile/cancel', { messageId: task.messageId, uploadId: task.uploadId }).catch(() => {})
  return { success: true, taskId: next.taskId, state: next.state }
}
const acknowledgeUploadTask = async ({ messageId, succeeded, error } = {}) => {
  const context = getActiveContext()
  if (!context) return { success: false, kind: 'not_logged_in', error: 'Upload context is unavailable' }
  const task = await getUploadTaskByMessageId(messageId, context.userId)
  if (!task) return { success: true, acknowledged: false }
  if ([TASK_STATES.SUCCEEDED, TASK_STATES.CANCELED].includes(task.state)) {
    return { success: true, acknowledged: false }
  }
  const next = await persistAndEmit(task, { state: succeeded ? TASK_STATES.SUCCEEDED : TASK_STATES.FAILED, lastError: succeeded ? '' : String(error || 'Server file processing failed') }, context)
  await setUploadSourcePinned({ uploadSourceId: task.uploadSourceId, userId: context.userId, pinned: false })
  return { success: true, acknowledged: true, taskId: next.taskId, state: next.state }
}
const resumePersistedUploadTasks = async ({ onTerminalStatus } = {}) => {
  const context = getActiveContext()
  if (!context) return { protectedMessageIds: [] }
  context.onTerminalStatus = onTerminalStatus || context.onTerminalStatus
  const tasks = await listUploadTasksByStates([TASK_STATES.UPLOADING, TASK_STATES.QUEUED, TASK_STATES.PAUSED, TASK_STATES.AWAITING_ACK], context.userId)
  const protectedMessageIds = tasks.map((task) => task.messageId)
  for (const task of tasks) {
    await setUploadSourcePinned({ uploadSourceId: task.uploadSourceId, userId: context.userId, pinned: true })
    if (task.state === TASK_STATES.UPLOADING) await persistAndEmit(task, { state: TASK_STATES.QUEUED }, context)
    if (task.state !== TASK_STATES.AWAITING_ACK) continue
    try {
      const status = await request(context, '/chat/uploadFile/status', { messageId: task.messageId, uploadId: task.uploadId || '' })
      if (!isActive(context)) return { protectedMessageIds }
      if (status?.terminal) {
        const succeeded = Number(status.messageStatus) === 1 && !status.failed
        await acknowledgeUploadTask({ messageId: task.messageId, succeeded, error: status.error })
        await context.onTerminalStatus?.({ messageId: task.messageId, succeeded, error: status.error })
      }
    } catch (error) { console.warn('Failed to reconcile completed upload task', error) }
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
  const tasks = previous.userId ? await listUploadTasksByStates([TASK_STATES.UPLOADING, TASK_STATES.QUEUED], previous.userId) : []
  await Promise.all(tasks.map((task) => saveUploadTask({ ...task, state: TASK_STATES.QUEUED }, previous.userId)))
}
const setUploadTaskEventTarget = (eventTarget) => { if (runtime.userId) runtime = { ...runtime, eventTarget } }
export { TASK_STATES, acknowledgeUploadTask, activateUploadTasks, cancelUploadTask, deactivateUploadTasks, enqueueUploadTask, pauseUploadTask, resumePersistedUploadTasks, resumeUploadTask, setUploadTaskEventTarget }
