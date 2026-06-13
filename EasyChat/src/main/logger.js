import log from 'electron-log/main'

const SENSITIVE_KEY_RE = /token|authorization|password|passwd|secret/i
const WS_TOKEN_RE = /([?&]token=)[^&\s]+/gi
const AUTH_RE =
  /(["']?authorization["']?\s*[:=]\s*)(?:"(?:Bearer\s+)?[^"]*"|'(?:Bearer\s+)?[^']*'|(?:Bearer\s+)?[^\s,}]+)/gi
const SECRET_LABEL_RE =
  /(["']?(?:token|password|passwd|secret)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,}]+)/gi

const redactString = (value) => {
  return String(value)
    .replace(WS_TOKEN_RE, '$1[REDACTED]')
    .replace(AUTH_RE, '$1[REDACTED]')
    .replace(SECRET_LABEL_RE, '$1[REDACTED]')
}

const sanitizeLogValue = (value, seen = new WeakSet()) => {
  if (typeof value === 'string') {
    return redactString(value)
  }
  if (value == null || typeof value !== 'object') {
    return value
  }
  if (Buffer.isBuffer(value) || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return `[binary:${value.byteLength ?? value.length ?? 0}]`
  }
  if (seen.has(value)) {
    return '[Circular]'
  }
  seen.add(value)
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: redactString(value.stack || '')
    }
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item, seen))
  }
  const result = {}
  Object.entries(value).forEach(([key, item]) => {
    if (SENSITIVE_KEY_RE.test(key)) {
      result[key] = '[REDACTED]'
    } else if (/messageContent/i.test(key)) {
      result[key] = typeof item === 'string' ? `[content:${item.length}]` : '[content]'
    } else {
      result[key] = sanitizeLogValue(item, seen)
    }
  })
  return result
}

const sanitizeArgs = (args) => args.map((item) => sanitizeLogValue(item))

const logger = {
  debug: (...args) => log.debug(...sanitizeArgs(args)),
  error: (...args) => log.error(...sanitizeArgs(args)),
  info: (...args) => log.info(...sanitizeArgs(args)),
  log: (...args) => log.info(...sanitizeArgs(args)),
  warn: (...args) => log.warn(...sanitizeArgs(args))
}

const initializeLogger = () => {
  log.initialize()
  log.transports.file.level = process.env.NODE_ENV === 'development' ? 'debug' : 'info'
  log.transports.file.maxSize = 5 * 1024 * 1024
  log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'info'
  log.errorHandler.startCatching()
  log.eventLogger.startLogging()
  Object.assign(console, logger)
}

export { initializeLogger, sanitizeLogValue }
export default logger
