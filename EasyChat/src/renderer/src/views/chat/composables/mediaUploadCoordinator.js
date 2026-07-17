/**
 * Owns bounded local upload execution, AbortController ownership and delayed
 * upload-source retries. Network and message state remain with the sender.
 */
export const createMediaUploadCoordinator = ({ maxConcurrency = 3, onTaskError } = {}) => {
  const queue = []
  const controllers = new Map()
  const retryTimers = new Set()
  let activeCount = 0
  let disposed = false

  const run = () => {
    if (disposed) return
    while (activeCount < maxConcurrency && queue.length) {
      const task = queue.shift()
      activeCount += 1
      Promise.resolve()
        .then(task)
        .catch((error) => onTaskError?.(error))
        .finally(() => {
          activeCount -= 1
          run()
        })
    }
  }

  const enqueue = (task) => {
    if (disposed) return false
    queue.push(task)
    run()
    return true
  }

  const setController = (messageId, controller) => {
    if (disposed) {
      controller?.abort?.()
      return false
    }
    controllers.set(String(messageId), controller)
    return true
  }
  const getController = (messageId) => controllers.get(String(messageId))
  const deleteController = (messageId) => controllers.delete(String(messageId))
  const isCurrentController = (messageId, controller) => getController(messageId) === controller

  const scheduleRetry = (callback, delay) => {
    if (disposed) return null
    const timer = setTimeout(() => {
      retryTimers.delete(timer)
      if (!disposed) callback()
    }, delay)
    retryTimers.add(timer)
    return timer
  }

  const cleanup = () => {
    disposed = true
    controllers.forEach((controller) => controller?.abort?.())
    controllers.clear()
    retryTimers.forEach((timer) => clearTimeout(timer))
    retryTimers.clear()
    queue.length = 0
  }

  return {
    cleanup,
    deleteController,
    enqueue,
    getController,
    isCurrentController,
    scheduleRetry,
    setController
  }
}
