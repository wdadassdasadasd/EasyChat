import { createSubscriptionRegistry } from '../subscriptionRegistry'

/** Binds named session IPC callbacks without giving subscription ownership to session state. */
export const createSessionSubscriptionController = () => {
  const subscriptions = createSubscriptionRegistry()

  const register = ({ onDelete, onLoad, onMarkRead, onTop }) => {
    subscriptions.clear()
    subscriptions.replace('loadSessionData', () => window.api.onLoadSessionDataCallback(onLoad))
    subscriptions.replace('deleteChatSession', () => window.api.onDelChatSessionCallback(onDelete))
    subscriptions.replace('markSessionRead', () => window.api.onMarkSessionReadCallback(onMarkRead))
    subscriptions.replace('topChatSession', () => window.api.onTopChatSessionCallback(onTop))
  }

  return { register, remove: () => subscriptions.clear() }
}
