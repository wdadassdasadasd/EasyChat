import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useMessageComposer } from '@/views/chat/composables/useMessageComposer'

describe('useMessageComposer', () => {
  afterEach(() => {
    delete global.window
    vi.restoreAllMocks()
  })

  it('shows the empty-message hint and emits a trimmed text message', () => {
    global.window = { api: {} }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const emit = vi.fn()
    const composer = useMessageComposer({
      currentChatSession: ref({ contactId: 'u2', contactType: 0 }),
      emit
    })

    composer.sendMessage()
    expect(composer.showSendMessagePopover.value).toBe(true)

    composer.msgContent.value = ' hello '
    composer.sendMessage()

    expect(emit).toHaveBeenCalledWith('sendMessage', {
      contactId: 'u2',
      contactType: 0,
      messageContent: 'hello'
    })
    expect(composer.msgContent.value).toBe('')
  })
})
