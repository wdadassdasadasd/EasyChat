/**
 * Internal in-memory integrity and object-URL lifecycle for the active message list.
 * It deliberately has no knowledge of IPC, pagination, scrolling, or sending.
 */
export const createMessageCollection = (messageList) => {
  const messageIdSet = new Set()

  const urlsFor = (message = {}) =>
    new Set([message?.localPreviewUrl, message?.localCoverUrl].filter(Boolean))

  const revoke = (message = {}, retainedUrls = new Set()) => {
    urlsFor(message).forEach((url) => {
      if (!retainedUrls.has(url)) URL.revokeObjectURL(url)
    })
  }

  const revokeList = (messages = []) => messages.forEach((message) => revoke(message))

  const rebuildIds = () => {
    messageIdSet.clear()
    messageList.value.forEach((message) => {
      if (message.messageId != null) messageIdSet.add(String(message.messageId))
    })
  }

  const appendMessageIfMissing = (message) => {
    if (!message) return false
    const messageId = message.messageId != null ? String(message.messageId) : ''
    if (messageId && messageIdSet.has(messageId)) return false
    messageList.value.push(message)
    if (messageId) messageIdSet.add(messageId)
    return true
  }

  const updateMessageById = (messageId, patch = {}) => {
    const index = messageList.value.findIndex(
      (message) => String(message?.messageId) === String(messageId)
    )
    if (index === -1) return false
    messageList.value[index] = Object.assign({}, messageList.value[index], patch)
    return true
  }

  const replaceMessageById = (messageId, nextMessage) => {
    const index = messageList.value.findIndex(
      (message) => String(message?.messageId) === String(messageId)
    )
    if (index === -1 || !nextMessage) return false

    const previousMessage = messageList.value[index]
    const nextMessageId = nextMessage.messageId != null ? String(nextMessage.messageId) : ''
    const existingServerIndex = nextMessageId
      ? messageList.value.findIndex(
          (message, itemIndex) =>
            itemIndex !== index && String(message?.messageId) === nextMessageId
        )
      : -1

    if (existingServerIndex !== -1) {
      const mergedMessage = Object.assign({}, messageList.value[existingServerIndex], nextMessage)
      revoke(previousMessage, urlsFor(mergedMessage))
      if (previousMessage?.messageId != null) messageIdSet.delete(String(previousMessage.messageId))
      messageList.value[existingServerIndex] = mergedMessage
      messageList.value.splice(index, 1)
      if (mergedMessage.messageId != null) messageIdSet.add(String(mergedMessage.messageId))
      return true
    }

    revoke(previousMessage, urlsFor(nextMessage))
    if (previousMessage?.messageId != null) messageIdSet.delete(String(previousMessage.messageId))
    messageList.value[index] = nextMessage
    if (nextMessage.messageId != null) messageIdSet.add(String(nextMessage.messageId))
    return true
  }

  const prependMessagesIfMissing = (messages = []) => {
    const prependList = []
    messages.forEach((message) => {
      const messageId = message?.messageId != null ? String(message.messageId) : ''
      if (messageId && messageIdSet.has(messageId)) return
      prependList.push(message)
      if (messageId) messageIdSet.add(messageId)
    })
    if (prependList.length) messageList.value = prependList.concat(messageList.value)
    return prependList.length
  }

  const replaceMessageList = (messages = []) => {
    const retainedUrls = new Set()
    messages.forEach((message) => urlsFor(message).forEach((url) => retainedUrls.add(url)))
    messageList.value.forEach((message) => revoke(message, retainedUrls))
    messageList.value = messages
    rebuildIds()
  }

  const clear = () => {
    revokeList(messageList.value)
    messageList.value = []
    messageIdSet.clear()
  }

  const getOldestServerMessageId = () => {
    const messageIds = messageList.value
      .map((message) => Number(message.messageId || 0))
      .filter((messageId) => messageId > 0)
    return messageIds.length ? Math.min(...messageIds) : null
  }

  return {
    appendMessageIfMissing,
    clear,
    getOldestServerMessageId,
    prependMessagesIfMissing,
    replaceMessageById,
    replaceMessageList,
    revokeMessageObjectUrlsForList: revokeList,
    updateMessageById
  }
}
