const MARK_PREFIX = 'easychat:'

export const markPerformance = (name) => {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return
  try {
    performance.mark(MARK_PREFIX + name)
  } catch (error) {
    // Performance APIs are diagnostic-only and must never affect application startup.
    console.debug('Unable to record performance mark', error)
  }
}
