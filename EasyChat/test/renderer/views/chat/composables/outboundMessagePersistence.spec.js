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

  it('keeps the pending message session when a later replace arrives after switching chats', async () => {
    const currentChatSession = ref({ contactId: 'u2', contactType: 0, sessionId: 's-u2' })
    const saveSendMessageToLocal = vi.fn(async () => ({ success: true }))
    const persistence = createOutboundMessagePersistence({
      currentChatSession,
      saveSendMessageToLocal
    })

    await persistence.persistPendingMessage({
      messageId: -1,
      contactId: 'u2',
      contactType: 0,
      sessionId: 's-u2',
      messageContent: 'from u2'
    })
    currentChatSession.value = { contactId: 'u3', contactType: 0, sessionId: 's-u3' }

    await persistence.persistServerMessage(-1, {
      messageId: 101,
      contactId: 'u2',
      contactType: 0,
      sessionId: 's-u2',
      messageContent: 'from u2'
    })

    expect(saveSendMessageToLocal.mock.calls[1][0]).toMatchObject({
      mode: 'replace',
      localMessageId: -1,
      chatSession: { contactId: 'u2', contactType: 0, sessionId: 's-u2' }
    })

    await persistence.persistMessageStatus({
      messageId: 101,
      contactId: 'u2',
      contactType: 0,
      sessionId: 's-u2',
      status: 1
    })

    expect(saveSendMessageToLocal.mock.calls[2][0]).toMatchObject({
      mode: 'status',
      chatSession: { contactId: 'u2', contactType: 0, sessionId: 's-u2' }
    })
  })
})
