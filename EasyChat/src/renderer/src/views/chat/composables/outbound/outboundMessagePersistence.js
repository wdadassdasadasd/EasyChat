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
  const sessionSnapshots = new Map()
  const getCurrentSessionSnapshot = () => ({ ...toRaw(currentChatSession.value) })
  const getMessageKey = (messageId) => (messageId == null ? '' : String(messageId))

  const getSessionSnapshot = (...messageIds) => {
    for (const messageId of messageIds) {
      const snapshot = sessionSnapshots.get(getMessageKey(messageId))
      if (snapshot) return snapshot
    }
    return getCurrentSessionSnapshot()
  }

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
      'uploadAwaitingAck',
      'uploadWaitingNetwork',
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

  const persistPendingMessage = (message) => {
    const sessionSnapshot = getCurrentSessionSnapshot()
    const messageKey = getMessageKey(message?.messageId)
    if (messageKey) sessionSnapshots.set(messageKey, sessionSnapshot)
    return persist(
      {
        mode: 'pending',
        message: stripTransientMessageFields(message),
        chatSession: sessionSnapshot
      },
      'Save pending message failed'
    )
  }

  const persistMessageStatus = (message) =>
    persist(
      {
        mode: 'status',
        message: stripTransientMessageFields(message),
        status: message.status,
        chatSession: getSessionSnapshot(message?.messageId)
      },
      'Save message status failed'
    )

  const persistServerMessage = async (localMessageId, message) => {
    const sessionSnapshot = getSessionSnapshot(localMessageId, message?.messageId)
    const result = await persist(
      {
        mode: 'replace',
        localMessageId,
        message: stripTransientMessageFields(message),
        chatSession: sessionSnapshot
      },
      'Save server message failed'
    )
    const localKey = getMessageKey(localMessageId)
    const serverKey = getMessageKey(message?.messageId)
    if (serverKey) sessionSnapshots.set(serverKey, sessionSnapshot)
    if (localKey && localKey !== serverKey) sessionSnapshots.delete(localKey)
    return result
  }

  return {
    cleanup: () => sessionSnapshots.clear(),
    persistMessageStatus,
    persistPendingMessage,
    persistServerMessage
  }
}
