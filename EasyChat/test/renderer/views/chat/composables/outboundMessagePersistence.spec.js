import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createOutboundMessagePersistence } from '@/views/chat/composables/outbound/outboundMessagePersistence'

describe('createOutboundMessagePersistence', () => {
  it('persists a pending message without renderer-only fields and patches only the active session', async () => {
    const saveSendMessageToLocal = vi.fn(async () => ({
      success: true,
      session: { contactId: 'u2', lastMessage: 'hello' }
    }))
    const patchChatSessions = vi.fn()
    const persistence = createOutboundMessagePersistence({
      currentChatSession: ref({ contactId: 'u2', sessionId: 's1' }),
      patchChatSessions,
      saveSendMessageToLocal
    })

    await persistence.persistPendingMessage({
      messageId: -1,
      localPreviewUrl: 'blob:preview',
      retryFile: { name: 'draft.png' }
    })

    expect(saveSendMessageToLocal).toHaveBeenCalledWith({
      mode: 'pending',
      message: { messageId: -1 },
      chatSession: { contactId: 'u2', sessionId: 's1' }
    })
    expect(patchChatSessions).toHaveBeenCalledWith([{ contactId: 'u2', lastMessage: 'hello' }])
  })
})
