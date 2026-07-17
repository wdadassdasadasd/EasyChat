/**
 * Owns unsubscribe callbacks for one composable instance. Replacing a key is
 * idempotent and clearing the registry never leaks a previous subscription.
 */
export const createSubscriptionRegistry = () => {
  const stops = new Map()

  const replace = (key, subscribe) => {
    stops.get(key)?.()
    const stop = subscribe?.()
    if (typeof stop === 'function') stops.set(key, stop)
    else stops.delete(key)
  }

  const clear = () => {
    stops.forEach((stop) => stop?.())
    stops.clear()
  }

  return { clear, replace }
}
