import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createPrependScrollAnchorController } from '@/views/chat/composables/message/prependScrollAnchorController'

const waitForTimers = () => new Promise((resolve) => setTimeout(resolve, 0))

const createViewport = ({ withAnchor = true } = {}) => {
  const panel = {
    clientHeight: 100,
    scrollHeight: 200,
    scrollTop: 50,
    getBoundingClientRect: () => ({ top: 100 }),
    querySelectorAll: () => (withAnchor ? [row] : [])
  }
  const row = {
    dataset: { msgKey: '10' },
    getBoundingClientRect: () => ({ bottom: 140, top: 120 })
  }
  const target = {
    getBoundingClientRect: () => ({
      top: panel.scrollTop < 110 ? 180 : 120
    }),
    scrollIntoView: vi.fn()
  }
  const messageListRef = ref({
    getScrollState: () => ({
      bottomGap: 50,
      clientHeight: panel.clientHeight,
      scrollHeight: panel.scrollHeight,
      scrollTop: panel.scrollTop
    })
  })
  return { messageListRef, panel, target }
}

describe('prependScrollAnchorController', () => {
  beforeEach(() => {
    global.window = {
      cancelAnimationFrame: clearTimeout,
      requestAnimationFrame: (callback) => setTimeout(callback, 0)
    }
  })

  it('restores the visible anchor after prepending and waits for virtual rows to settle', async () => {
    const { messageListRef, panel, target } = createViewport()
    global.document = {
      getElementById: vi.fn((id) => (id === 'message10' ? target : null))
    }
    const controller = createPrependScrollAnchorController({
      getMessagePanel: () => panel,
      messageListRef
    })

    expect(controller.capturePrependScrollState()).toBe(true)
    await controller.restorePrependScrollPosition()

    expect(panel.scrollTop).toBe(110)
  })

  it('falls back to height delta when no visible message anchor exists', async () => {
    const { panel } = createViewport({ withAnchor: false })
    global.document = { getElementById: vi.fn(() => null) }
    const controller = createPrependScrollAnchorController({ getMessagePanel: () => panel })

    controller.capturePrependScrollState()
    panel.scrollHeight = 260
    await controller.restorePrependScrollPosition()

    expect(panel.scrollTop).toBe(110)
  })

  it('does not apply a pending restore after cleanup', async () => {
    const { messageListRef, panel, target } = createViewport()
    global.document = {
      getElementById: vi.fn((id) => (id === 'message10' ? target : null))
    }
    const controller = createPrependScrollAnchorController({
      getMessagePanel: () => panel,
      messageListRef
    })

    controller.capturePrependScrollState()
    const restorePromise = controller.restorePrependScrollPosition()
    await Promise.resolve()
    controller.cleanup()
    await restorePromise
    await waitForTimers()

    expect(panel.scrollTop).toBe(50)
  })

  it('does not apply a pending restore after the active session changes', async () => {
    const { messageListRef, panel, target } = createViewport()
    global.document = {
      getElementById: vi.fn((id) => (id === 'message10' ? target : null))
    }
    const controller = createPrependScrollAnchorController({
      getMessagePanel: () => panel,
      messageListRef
    })

    controller.capturePrependScrollState()
    const restorePromise = controller.restorePrependScrollPosition()
    await Promise.resolve()
    controller.clear()
    await restorePromise
    await waitForTimers()

    expect(panel.scrollTop).toBe(50)
  })

  it('degrades safely without a panel and can still locate an already-rendered message', async () => {
    const scrollIntoView = vi.fn()
    global.document = {
      getElementById: vi.fn((id) => (id === 'message20' ? { scrollIntoView } : null))
    }
    const controller = createPrependScrollAnchorController({ getMessagePanel: () => null })

    expect(controller.capturePrependScrollState()).toBe(false)
    expect(await controller.restorePrependScrollPosition()).toBe(false)
    expect(await controller.scrollToMessageId('20')).toBe(true)
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
  })
})
