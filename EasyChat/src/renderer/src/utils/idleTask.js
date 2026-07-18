export const scheduleWhenIdle = (callback, { timeout = 1000 } = {}) => {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const taskId = window.requestIdleCallback(callback, { timeout })
    return () => window.cancelIdleCallback?.(taskId)
  }

  const taskId = setTimeout(callback, 0)
  return () => clearTimeout(taskId)
}
