import { toRaw } from 'vue'

/**
 * Keeps renderer-only message fields out of SQLite and centralizes the three
 * local write modes used by the outbound message state machine.
 */
export const createOutboundMessagePersistence = ({
  currentChatSession,
  patchChatSessions,
  saveSendMessageToLocal
}) => {
  const getCurrentSessionSnapshot = () => ({ ...toRaw(currentChatSession.value) })

  const stripTransientMessageFields = (message = {}) => {
    const dbMessage = { ...message }
    ;[
      'localPreviewUrl',
      'localCoverUrl',
      'retryFile',
      'retryCover',
      'uploading',
      'uploadProgress',
      'uploadError',
      'uploadCanceled',
      'downloadStatus',
      'downloadProgress',
      'downloadPath',
      'downloadError',
      'uploadAcked',
      'uploadAckReceived',
      'uploadAckRevision',
      'uploadAckStatus',
      'uploadSourceReleased',
      'coverSourceId',
      'forceGet'
    ].forEach((key) => delete dbMessage[key])
    return dbMessage
  }

  const sessionMatchesCurrent = (sessionInfo) => {
    if (!sessionInfo?.contactId) return true
    return String(sessionInfo.contactId) === String(currentChatSession.value?.contactId)
  }

  const persist = async (payload, fallbackError) => {
    const result = await saveSendMessageToLocal(payload)
    if (!result || result.success === false) {
      throw new Error(result?.error || fallbackError || 'Save message failed')
    }
    if (result.session && sessionMatchesCurrent(result.session)) {
      patchChatSessions?.([result.session])
    }
    return result
  }

  const persistPendingMessage = (message) =>
    persist(
      {
        mode: 'pending',
        message: stripTransientMessageFields(message),
        chatSession: getCurrentSessionSnapshot()
      },
      'Save pending message failed'
    )

  const persistMessageStatus = (message) =>
    persist(
      {
        mode: 'status',
        message: stripTransientMessageFields(message),
        status: message.status,
        chatSession: getCurrentSessionSnapshot()
      },
      'Save message status failed'
    )

  const persistServerMessage = (localMessageId, message) =>
    persist(
      {
        mode: 'replace',
        localMessageId,
        message: stripTransientMessageFields(message),
        chatSession: getCurrentSessionSnapshot()
      },
      'Save server message failed'
    )

  return {
    persistMessageStatus,
    persistPendingMessage,
    persistServerMessage
  }
}
