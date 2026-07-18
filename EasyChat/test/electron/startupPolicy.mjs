const isRendererStartupFailure = ({ events = [], rendererState = [] } = {}) => {
  const rendererGone = events.some((event) => {
    return (
      event?.type === 'render-process-gone' &&
      ['launch-failed', 'crashed'].includes(String(event.reason || ''))
    )
  })
  return rendererGone || rendererState.some((state) => state?.crashed === true)
}

const shouldRetryRendererStartup = ({ attempt, events, rendererState } = {}) => {
  return Number(attempt) === 0 && isRendererStartupFailure({ events, rendererState })
}

export { isRendererStartupFailure, shouldRetryRendererStartup }
