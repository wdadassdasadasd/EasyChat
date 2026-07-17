import { nextTick } from 'vue'

/**
 * Owns DOM-based viewport preservation around prepended history pages.
 * The history controller decides when a page is loaded; this module owns how
 * the viewport is measured and restored after virtual rows reflow.
 */
export const createPrependScrollAnchorController = ({ messageListRef, getMessagePanel } = {}) => {
  let pendingScrollState = null
  let lifecycleSeq = 0
  const scheduledFrames = new Map()

  const getPanel = () => getMessagePanel?.() || document.getElementById('message-panel')

  const waitNextFrame = () =>
    new Promise((resolve) => {
      const requestFrame = window.requestAnimationFrame || ((callback) => setTimeout(callback, 0))
      const cancelFrame = window.cancelAnimationFrame || clearTimeout
      let frameId = null
      let finished = false
      const finish = (completed) => {
        if (finished) return
        finished = true
        if (frameId != null) scheduledFrames.delete(frameId)
        resolve(completed)
      }
      frameId = requestFrame(() => finish(true))
      if (finished) return
      scheduledFrames.set(frameId, () => {
        cancelFrame(frameId)
        finish(false)
      })
    })

  const cancelScheduledFrames = () => {
    scheduledFrames.forEach((cancel) => cancel())
    scheduledFrames.clear()
  }

  const clear = () => {
    lifecycleSeq++
    pendingScrollState = null
    cancelScheduledFrames()
  }

  const getScrollState = () => {
    const list = messageListRef?.value
    const listState = list?.getScrollState?.()
    if (listState) return listState

    const panel = getPanel()
    if (!panel) return null
    return {
      scrollHeight: panel.scrollHeight,
      scrollTop: panel.scrollTop,
      clientHeight: panel.clientHeight,
      bottomGap: Math.max(0, panel.scrollHeight - panel.scrollTop - panel.clientHeight)
    }
  }

  const findMessageElement = (messageId) =>
    messageId ? document.getElementById(`message${messageId}`) : null

  const capturePrependScrollState = () => {
    clear()
    const scrollState = getScrollState()
    if (!scrollState) return false

    const panel = getPanel()
    let anchorMessageId = null
    let anchorViewportTop = 0
    if (panel) {
      const panelRect = panel.getBoundingClientRect()
      for (const row of panel.querySelectorAll('[data-msg-key]')) {
        const rect = row.getBoundingClientRect()
        if (rect.bottom > panelRect.top + 10) {
          anchorMessageId = row.dataset.msgKey || null
          anchorViewportTop = rect.top - panelRect.top
          break
        }
      }
    }

    pendingScrollState = { ...scrollState, anchorMessageId, anchorViewportTop }
    return true
  }

  const restorePrependScrollPosition = async () => {
    const scrollState = pendingScrollState
    pendingScrollState = null
    if (!scrollState) return false

    const restoreSeq = lifecycleSeq
    await nextTick()
    if (restoreSeq !== lifecycleSeq || !(await waitNextFrame()) || restoreSeq !== lifecycleSeq)
      return false

    const panel = getPanel()
    if (!panel) return false

    let restored = false
    if (scrollState.anchorMessageId) {
      const anchor = findMessageElement(scrollState.anchorMessageId)
      if (anchor) {
        const delta =
          anchor.getBoundingClientRect().top -
          panel.getBoundingClientRect().top -
          scrollState.anchorViewportTop
        panel.scrollTop += delta
        restored = true
      }
    }
    if (!restored) {
      const currentState = getScrollState()
      if (currentState) {
        panel.scrollTop =
          scrollState.scrollTop + Math.max(0, currentState.scrollHeight - scrollState.scrollHeight)
      }
    }

    if (
      !(await waitNextFrame()) ||
      restoreSeq !== lifecycleSeq ||
      !(await waitNextFrame()) ||
      restoreSeq !== lifecycleSeq ||
      !scrollState.anchorMessageId
    ) {
      return restored
    }

    const anchor = findMessageElement(scrollState.anchorMessageId)
    if (anchor) {
      const delta =
        anchor.getBoundingClientRect().top -
        panel.getBoundingClientRect().top -
        scrollState.anchorViewportTop
      if (Math.abs(delta) > 3) panel.scrollTop += delta
    }
    return restored
  }

  const scrollToMessageId = async (messageId) => {
    if (!messageId) return false
    const scrollSeq = lifecycleSeq
    await nextTick()
    if (scrollSeq !== lifecycleSeq || !(await waitNextFrame()) || scrollSeq !== lifecycleSeq)
      return false

    const target = findMessageElement(messageId)
    if (!target) return false
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return true
  }

  return {
    capturePrependScrollState,
    cleanup: clear,
    clear,
    restorePrependScrollPosition,
    scrollToMessageId
  }
}
