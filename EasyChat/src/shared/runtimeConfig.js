/* global __EASYCHAT_API_ORIGIN__, __EASYCHAT_WS_ORIGIN__ */

const DEFAULT_API_ORIGIN = 'http://localhost:5050'
const DEFAULT_WS_ORIGIN = 'ws://localhost:5051/ws'

const isLoopbackHost = (hostname = '') => {
  const normalized = String(hostname)
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

const normalizeOrigin = (value, { name, protocols, fallback, allowPath = false }) => {
  const rawValue = String(value || fallback).trim()
  let parsed
  try {
    parsed = new URL(rawValue)
  } catch {
    throw new Error(`${name} must be a valid absolute origin`)
  }

  if (
    !protocols.includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    (!allowPath && parsed.pathname !== '/') ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${name} must be an origin without credentials, path, query, or hash`)
  }

  if (!isLoopbackHost(parsed.hostname)) {
    const secureProtocol = parsed.protocol === 'https:' || parsed.protocol === 'wss:'
    if (!secureProtocol) {
      throw new Error(`${name} must use HTTPS or WSS outside loopback hosts`)
    }
  }

  return allowPath ? `${parsed.origin}${parsed.pathname}` : parsed.origin
}

const resolveRuntimeConfig = ({ apiOrigin, wsOrigin } = {}) => {
  const normalizedApiOrigin = normalizeOrigin(apiOrigin, {
    name: 'VITE_API_ORIGIN',
    protocols: ['http:', 'https:'],
    fallback: DEFAULT_API_ORIGIN
  })
  const normalizedWsOrigin = normalizeOrigin(wsOrigin, {
    name: 'VITE_WS_ORIGIN',
    protocols: ['ws:', 'wss:'],
    fallback: DEFAULT_WS_ORIGIN,
    allowPath: true
  })

  return Object.freeze({
    apiOrigin: normalizedApiOrigin,
    apiBaseUrl: `${normalizedApiOrigin}/api`,
    wsOrigin: normalizedWsOrigin,
    wsCspOrigin: new URL(normalizedWsOrigin).origin
  })
}

const compiledApiOrigin =
  typeof __EASYCHAT_API_ORIGIN__ === 'undefined' ? undefined : __EASYCHAT_API_ORIGIN__
const compiledWsOrigin =
  typeof __EASYCHAT_WS_ORIGIN__ === 'undefined' ? undefined : __EASYCHAT_WS_ORIGIN__

const runtimeConfig = resolveRuntimeConfig({
  apiOrigin: compiledApiOrigin,
  wsOrigin: compiledWsOrigin
})

export {
  DEFAULT_API_ORIGIN,
  DEFAULT_WS_ORIGIN,
  isLoopbackHost,
  normalizeOrigin,
  resolveRuntimeConfig,
  runtimeConfig
}
