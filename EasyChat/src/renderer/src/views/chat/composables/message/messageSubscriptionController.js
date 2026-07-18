import { createSubscriptionRegistry } from '../subscriptionRegistry'

/** Keeps renderer message IPC subscriptions isolated from history state. */
export const createMessageSubscriptionController = ({
  applyPersistedV2Result,
  loadChatSession,
  onLoadChatMessageCallback,
  proxy,
  recoverReceiveResync
}) => {
  const subscriptions = createSubscriptionRegistry()

  const register = () => {
    subscriptions.clear()
    subscriptions.replace('receiveMessageBatch', () =>
      window.api.onReceiveMessageBatch((payload = {}) => {
        if (payload?.success === false) {
          proxy.Message.error(payload.error || '消息同步异常，正在尝试恢复。')
          if (payload.resyncRequired) recoverReceiveResync(payload)
          return
        }
        applyPersistedV2Result(payload)
        // Contact/group/application mutations are persisted as V2 events too.
        // They have no chat-message row, so refresh renderer-owned views only
        // after the main process has committed their processed-event marker.
        if (payload.stateChanged) loadChatSession()
      })
    )
    subscriptions.replace('loadChatMessage', () =>
      window.api.onLoadChatMessageCallback(onLoadChatMessageCallback)
    )
  }

  return { register, remove: () => subscriptions.clear() }
}
