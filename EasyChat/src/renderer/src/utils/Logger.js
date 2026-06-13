import log from 'electron-log/renderer'

const SENSITIVE_KEY_RE = /token|authorization|password|passwd|secret/i
const WS_TOKEN_RE = /([?&]token=)[^&\s]+/gi
const AUTH_RE =
  /(["']?authorization["']?\s*[:=]\s*)(?:"(?:Bearer\s+)?[^"]*"|'(?:Bearer\s+)?[^']*'|(?:Bearer\s+)?[^\s,}]+)/gi
const SECRET_LABEL_RE =
  /(["']?(?:token|password|passwd|secret)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,}]+)/gi

const sanitize = (value, seen = new WeakSet()) => {
  if (typeof value === 'string') {
    return value
      .replace(WS_TOKEN_RE, '$1[REDACTED]')
      .replace(AUTH_RE, '$1[REDACTED]')
      .replace(SECRET_LABEL_RE, '$1[REDACTED]')
  }
  if (value == null || typeof value !== 'object') {
    return value
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return `[binary:${value.byteLength || 0}]`
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return `[binary:${value.size}]`
  }
  if (seen.has(value)) {
    return '[Circular]'
  }
  seen.add(value)
  if (value instanceof Error) {
    return { name: value.name, message: sanitize(value.message), stack: sanitize(value.stack || '') }
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, seen))
  }
  const result = {}
  Object.entries(value).forEach(([key, item]) => {
    result[key] = SENSITIVE_KEY_RE.test(key)
      ? '[REDACTED]'
      : /messageContent/i.test(key)
        ? `[content:${String(item || '').length}]`
        : sanitize(item, seen)
  })
  return result
}

const sanitizeArgs = (args) => args.map((item) => sanitize(item))
const logger = {
  debug: (...args) => log.debug(...sanitizeArgs(args)),
  error: (...args) => log.error(...sanitizeArgs(args)),
  info: (...args) => log.info(...sanitizeArgs(args)),
  log: (...args) => log.info(...sanitizeArgs(args)),
  warn: (...args) => log.warn(...sanitizeArgs(args))
}

export const initializeRendererLogger = () => {
  log.errorHandler.startCatching()
  Object.assign(console, logger)
}

export default logger
