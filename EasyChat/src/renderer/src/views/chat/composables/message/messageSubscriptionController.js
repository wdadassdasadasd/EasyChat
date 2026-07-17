import { createSubscriptionRegistry } from '../subscriptionRegistry'

/** Keeps renderer message IPC subscriptions isolated from history state. */
export const createMessageSubscriptionController = ({
  handleFileUploadDone,
  handleReceiveMessages,
  loadChatSession,
  onLoadChatMessageCallback,
  proxy,
  recoverReceiveResync
}) => {
  const subscriptions = createSubscriptionRegistry()

  const register = () => {
    subscriptions.clear()
    subscriptions.replace('receiveMessage', () =>
      window.api.onReceiveMessage((rawMessage) => {
        let message = rawMessage
        if (typeof message === 'string') {
          try {
            message = JSON.parse(message)
          } catch (error) {
            console.error('parse receiveMessage failed', error)
            proxy.Message.error('Receive message parse failed')
            return
          }
        }
        if (message?.success === false) {
          proxy.Message.error(message.error || 'Receive message failed')
        } else if (message?.messageType == 0) {
          loadChatSession()
        } else if (message?.messageType == 6) {
          handleFileUploadDone(message)
        }
      })
    )
    subscriptions.replace('receiveMessageBatch', () =>
      window.api.onReceiveMessageBatch((payload = {}) => {
        if (payload?.success === false) {
          proxy.Message.error(payload.error || '消息同步异常，正在尝试恢复。')
          if (payload.resyncRequired) recoverReceiveResync(payload)
          return
        }
        handleReceiveMessages(
          Array.isArray(payload.messages) ? payload.messages : [],
          Array.isArray(payload.sessions) ? payload.sessions : []
        )
      })
    )
    subscriptions.replace('loadChatMessage', () =>
      window.api.onLoadChatMessageCallback(onLoadChatMessageCallback)
    )
  }

  return { register, remove: () => subscriptions.clear() }
}
