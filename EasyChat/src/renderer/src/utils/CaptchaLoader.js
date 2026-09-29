const createCaptchaLoader = ({
  request,
  onSuccess,
  onExhausted,
  onFailure = () => {},
  maxAttempts = 3,
  retryDelay = 1000,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) => {
  let failureCount = 0
  let retryTimer = null
  let inFlight = null
  let disposed = false

  const clearScheduledRetry = () => {
    if (retryTimer) {
      clearTimer(retryTimer)
      retryTimer = null
    }
  }

  const load = ({ manual = false } = {}) => {
    if (disposed) return Promise.resolve(false)
    if (manual) {
      failureCount = 0
      clearScheduledRetry()
    }
    if (inFlight) return inFlight
    if (failureCount >= maxAttempts) {
      onExhausted?.()
      return Promise.resolve(false)
    }

    inFlight = Promise.resolve()
      .then(() => request())
      .catch(() => undefined)
      .then((result) => {
        if (disposed) return false
        if (result) {
          failureCount = 0
          clearScheduledRetry()
          onSuccess?.(result)
          return true
        }

        failureCount += 1
        onFailure(failureCount)
        if (failureCount >= maxAttempts) {
          onExhausted?.()
          return false
        }
        retryTimer = setTimer(() => {
          retryTimer = null
          void load()
        }, retryDelay)
        return false
      })
      .finally(() => {
        inFlight = null
      })
    return inFlight
  }

  const dispose = () => {
    disposed = true
    clearScheduledRetry()
  }

  return { load, dispose }
}

export { createCaptchaLoader }
