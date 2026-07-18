import fs from 'fs'
import http from 'http'
import https from 'https'

const MAX_DOWNLOAD_REDIRECTS = 10
const DOWNLOAD_STALLED_TIMEOUT_MS = 30000
const NETWORK_ERROR_CODES = new Set([
  'ECONNABORTED', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETDOWN',
  'ENETUNREACH', 'ENOTFOUND', 'ETIMEDOUT'
])

const defaultGetErrorMessage = (error) => error?.message || String(error || 'unknown error')
const isNetworkError = (error) =>
  NETWORK_ERROR_CODES.has(String(error?.code || '').toUpperCase()) ||
  /network|timeout|socket|connect|dns/i.test(String(error?.message || ''))

/**
 * Owns non-persistent download work for the current authenticated desktop runtime.
 * A task is intentionally scoped to a runtime generation: downloads must never outlive
 * logout or be allowed to publish progress into the next user's renderer.
 */
const createDownloadTaskManager = ({
  getTargetPath,
  getErrorMessage = defaultGetErrorMessage,
  validateUrl
} = {}) => {
  let runtimeGeneration = 0
  let runtime = { generation: runtimeGeneration, userId: null, eventTarget: null }
  const activeTasks = new Map()
  const reservedTargetPaths = new Set()

  const taskKey = ({ generation, userId, messageId }) =>
    `${generation}:${String(userId)}:${String(messageId)}`

  const isCurrentTask = (task) =>
    !task.settled &&
    runtime.generation === task.generation &&
    runtime.userId === task.userId &&
    activeTasks.get(task.key) === task

  const notify = (task, payload) => {
    if (!isCurrentTask(task) || task.eventTarget?.isDestroyed?.()) return
    task.eventTarget?.send?.('downloadChatFileProgress', { messageId: task.messageId, ...payload })
  }

  const clearDownloadTimeout = (task) => {
    if (!task.downloadTimeout) return
    clearTimeout(task.downloadTimeout)
    task.downloadTimeout = null
  }

  const cleanupTempPath = async (task) => {
    if (!task.tempPath) return
    try {
      await fs.promises.unlink(task.tempPath)
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        // Temp-file cleanup is deliberately best effort: the request result must still settle.
      }
    }
  }

  const finish = (task, result) => {
    if (task.settled) return
    task.settled = true
    clearDownloadTimeout(task)
    activeTasks.delete(task.key)
    reservedTargetPaths.delete(task.targetPath)
    task.resolve(result)
  }

  const finishWithCleanup = async (task, result) => {
    await cleanupTempPath(task)
    finish(task, result)
  }

  const failFromTransportError = (task, error) =>
    finishWithCleanup(task, {
      success: false,
      ...(isNetworkError(error) ? { kind: 'network' } : {}),
      error: getErrorMessage(error)
    })

  const stopTask = async (task, result, error = new Error(result.error)) => {
    if (!task || task.settled) return false
    clearDownloadTimeout(task)
    try {
      task.response?.unpipe?.(task.output)
      task.response?.destroy?.(error)
      task.output?.destroy?.(error)
      task.request?.destroy?.(error)
    } catch {
      // Every resource is best effort; finish below remains authoritative.
    }
    await finishWithCleanup(task, result)
    return true
  }

  const cancelTask = async (task) => {
    if (task) task.canceled = true
    return await stopTask(task, { success: false, kind: 'canceled', error: 'Download canceled' })
  }

  const armStallTimeout = (task) => {
    clearDownloadTimeout(task)
    task.downloadTimeout = setTimeout(() => {
      void stopTask(task, {
        success: false,
        kind: 'timeout',
        error: 'Download timed out: no data received for 30 seconds'
      })
    }, DOWNLOAD_STALLED_TIMEOUT_MS)
  }

  const activateDownloadRuntime = ({ userId, eventTarget } = {}) => {
    runtimeGeneration += 1
    runtime = { generation: runtimeGeneration, userId: String(userId || ''), eventTarget }
    return runtime
  }

  const deactivateDownloadTasks = async () => {
    runtimeGeneration += 1
    runtime = { generation: runtimeGeneration, userId: null, eventTarget: null }
    await Promise.all([...activeTasks.values()].map((task) => cancelTask(task)))
  }

  const ensureRuntime = ({ userId, eventTarget } = {}) => {
    const normalizedUserId = String(userId || '')
    if (!normalizedUserId) return null
    if (!runtime.userId) return activateDownloadRuntime({ userId: normalizedUserId, eventTarget })
    if (runtime.userId !== normalizedUserId) return null
    if (eventTarget) runtime.eventTarget = eventTarget
    return runtime
  }

  const requestDownload = (task, url, redirectDepth = 0) => {
    if (!isCurrentTask(task)) {
      void finishWithCleanup(task, { success: false, kind: 'canceled', error: 'Download canceled' })
      return
    }
    if (redirectDepth >= MAX_DOWNLOAD_REDIRECTS) {
      void finishWithCleanup(task, { success: false, error: 'Download failed: too many redirects' })
      return
    }

    let normalizedUrl
    try {
      normalizedUrl = validateUrl(url, task.allowedOrigins)
    } catch (error) {
      void finishWithCleanup(task, {
        success: false,
        ...(error?.kind ? { kind: error.kind } : {}),
        error: redirectDepth ? `Download redirect rejected: ${getErrorMessage(error)}` : getErrorMessage(error)
      })
      return
    }

    const transport = normalizedUrl.startsWith('https:') ? https : http
    let request
    try {
      request = transport.get(normalizedUrl, (response) => {
        if (task.settled) {
          response.resume?.()
          return
        }
        task.response = response
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume?.()
          let redirectUrl
          try {
            redirectUrl = new URL(response.headers.location, normalizedUrl).toString()
          } catch (error) {
            void finishWithCleanup(task, {
              success: false,
              error: `Download redirect rejected: ${getErrorMessage(error)}`
            })
            return
          }
          requestDownload(task, redirectUrl, redirectDepth + 1)
          return
        }

        if (response.statusCode !== 200 && response.statusCode !== 206) {
          response.resume?.()
          void finishWithCleanup(task, { success: false, error: `Download failed: HTTP ${response.statusCode}` })
          return
        }

        const contentLength = Number(response.headers['content-length'] || 0)
        const expectedSize = Number(task.fileSize || contentLength || 0)
        const limit = Number(task.maxSize || 0)
        if ((limit && contentLength > limit) || (limit && expectedSize > limit)) {
          response.resume?.()
          void finishWithCleanup(task, { success: false, error: 'File is too large to download safely.' })
          return
        }

        const output = fs.createWriteStream(task.tempPath)
        task.output = output
        let downloaded = 0
        armStallTimeout(task)

        response.on('data', (chunk) => {
          if (!isCurrentTask(task)) return
          armStallTimeout(task)
          downloaded += chunk.length
          if (limit && downloaded > limit) {
            void stopTask(task, { success: false, error: 'File is too large to download safely.' })
            return
          }
          const total = expectedSize || contentLength
          notify(task, {
            progress: total ? Math.min(99, Math.round((downloaded / total) * 100)) : 0,
            loaded: downloaded,
            total
          })
        })

        response.pipe(output)
        output.on('finish', () => {
          output.close(() => {
            void (async () => {
              if (!isCurrentTask(task)) {
                await finishWithCleanup(task, {
                  success: false,
                  kind: 'canceled',
                  error: 'Download canceled'
                })
                return
              }
              try {
                // Renaming can block on virus scanners or network-backed download folders.
                // Keep that filesystem work asynchronous so the main process remains responsive.
                await fs.promises.rename(task.tempPath, task.targetPath)
                task.tempPath = ''
                notify(task, { progress: 100 })
                finish(task, { success: true, filePath: task.targetPath, progress: 100 })
              } catch (error) {
                await finishWithCleanup(task, { success: false, error: getErrorMessage(error) })
              }
            })()
          })
        })
        output.on('error', (error) => {
          if (task.settled) return
          if (task.canceled) {
            void finishWithCleanup(task, { success: false, kind: 'canceled', error: 'Download canceled' })
            return
          }
          void failFromTransportError(task, error)
        })
        response.on('error', (error) => {
          if (task.settled) return
          if (task.canceled) {
            void finishWithCleanup(task, { success: false, kind: 'canceled', error: 'Download canceled' })
            return
          }
          void failFromTransportError(task, error)
        })
      })
      task.request = request
      request.on('error', (error) => {
        if (task.settled) return
        if (task.canceled) {
          void finishWithCleanup(task, { success: false, kind: 'canceled', error: 'Download canceled' })
          return
        }
        void failFromTransportError(task, error)
      })
    } catch (error) {
      void failFromTransportError(task, error)
    }
  }

  const downloadChatFile = async ({ eventTarget, userId, fileName, fileSize, maxSize, messageId, url, allowedOrigins } = {}) => {
    const activeRuntime = ensureRuntime({ userId, eventTarget })
    if (!activeRuntime) {
      return { success: false, kind: 'not_authenticated', error: 'An authenticated user is required' }
    }
    const key = taskKey({ generation: activeRuntime.generation, userId: activeRuntime.userId, messageId })
    if (activeTasks.has(key)) return { success: false, error: 'File is already downloading' }

    // Reserve the final path before opening the temp file. Two message IDs can carry
    // the same filename, so an existsSync-only choice is not enough while both tasks
    // are still in flight.
    let targetInfo
    do {
      targetInfo = await getTargetPath(fileName, { reservedTargetPaths })
    } while (reservedTargetPaths.has(targetInfo.targetPath))
    const { targetPath, tempPath } = targetInfo
    reservedTargetPaths.add(targetPath)
    return await new Promise((resolve) => {
      const task = {
        key,
        generation: activeRuntime.generation,
        userId: activeRuntime.userId,
        eventTarget: activeRuntime.eventTarget,
        messageId,
        fileSize,
        maxSize,
        targetPath,
        tempPath,
        allowedOrigins,
        resolve,
        settled: false,
        canceled: false,
        request: null,
        response: null,
        output: null,
        downloadTimeout: null
      }
      activeTasks.set(key, task)
      requestDownload(task, url)
    })
  }

  const cancelDownloadChatFile = async ({ userId, messageId } = {}) => {
    const normalizedUserId = String(userId || '')
    if (!runtime.userId || runtime.userId !== normalizedUserId) return { success: true, canceled: false }
    const key = taskKey({ generation: runtime.generation, userId: runtime.userId, messageId })
    return { success: true, canceled: await cancelTask(activeTasks.get(key)) }
  }

  return {
    activateDownloadRuntime,
    cancelDownloadChatFile,
    deactivateDownloadTasks,
    downloadChatFile,
    getDiagnostics: () => ({
      generation: runtime.generation,
      userId: runtime.userId,
      activeCount: activeTasks.size,
      reservedTargetCount: reservedTargetPaths.size
    })
  }
}

export { createDownloadTaskManager }
