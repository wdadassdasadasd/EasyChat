import path from 'path'

const MAX_ID_LENGTH = 128
const MAX_PATH_LENGTH = 4096
const MAX_URL_LENGTH = 2048
const MAX_MESSAGE_LENGTH = 500
const MAX_FILE_NAME_LENGTH = 512

class IpcValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'IpcValidationError'
    this.kind = 'validation_error'
  }
}

const fail = (message) => {
  throw new IpcValidationError(message)
}

const isPlainObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const requireObject = (value, name = 'payload') => {
  if (!isPlainObject(value)) {
    fail(`${name} must be an object`)
  }
  return value
}

const requireString = (value, name, { maxLength = MAX_ID_LENGTH, allowEmpty = false } = {}) => {
  if (typeof value !== 'string') {
    fail(`${name} must be a string`)
  }
  const normalized = value.trim()
  if (!allowEmpty && !normalized) {
    fail(`${name} is required`)
  }
  if (value.length > maxLength) {
    fail(`${name} is too long`)
  }
  return value
}

const requireIdentifier = (value, name, { allowNegative = false } = {}) => {
  if (typeof value === 'string') {
    return requireString(value, name)
  }
  if (!Number.isSafeInteger(value) || value === 0 || (!allowNegative && value < 0)) {
    fail(`${name} must be a valid identifier`)
  }
  return value
}

const requireOptionalSequence = (value, name) => {
  if (value == null) {
    return
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${name} must be a non-negative safe integer`)
  }
}

const requireEnum = (value, name, allowed) => {
  if (!allowed.includes(value)) {
    fail(`${name} must be one of: ${allowed.join(', ')}`)
  }
  return value
}

const requireAbsolutePath = (value, name = 'filePath') => {
  const filePath = requireString(value, name, { maxLength: MAX_PATH_LENGTH })
  if (filePath.includes('\0') || !path.isAbsolute(filePath)) {
    fail(`${name} must be an absolute path`)
  }
  return filePath
}

const requireUrl = (value, name, protocols) => {
  const rawUrl = requireString(value, name, { maxLength: MAX_URL_LENGTH })
  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    // 处理未编码的非 ASCII 字符（如中文文件名），encodeURI 不会破坏已编码的部分
    try {
      parsed = new URL(encodeURI(rawUrl))
    } catch {
      fail(`${name} must be a valid URL`)
    }
  }
  if (!protocols.includes(parsed.protocol)) {
    fail(`${name} protocol must be one of: ${protocols.join(', ')}`)
  }
  return rawUrl
}

const validateHttpUrl = (value, name = 'url') => {
  return requireUrl(value, name, ['http:', 'https:'])
}

const requireOptionalSize = (value, name) => {
  if (value == null || value === '') {
    return
  }
  const size = Number(value)
  if (!Number.isSafeInteger(size) || size < 0) {
    fail(`${name} must be a non-negative safe integer`)
  }
}

const validateLoginOrRegister = (value) => {
  if (typeof value !== 'boolean') {
    fail('isLogin must be a boolean')
  }
}

const validateOpenChat = (value) => {
  const config = requireObject(value, 'config')
  requireIdentifier(config.userId, 'userId')
  requireString(config.token, 'token', { maxLength: 4096 })
  requireString(config.email, 'email', { maxLength: 320 })
  if (config.nickName != null) {
    requireString(config.nickName, 'nickName', {
      maxLength: 128,
      allowEmpty: true
    })
  }
}

const validateWindowOperation = (value) => {
  const payload = requireObject(value)
  requireEnum(payload.action, 'action', ['close', 'minimize', 'maximize', 'unmaximize', 'top'])
  if (payload.action === 'close') {
    const data = requireObject(payload.data, 'data')
    requireEnum(data.type, 'data.type', [0, 1])
  }
  if (payload.action === 'top') {
    const data = requireObject(payload.data, 'data')
    if (typeof data.top !== 'boolean') {
      fail('data.top must be a boolean')
    }
  }
}

const STORE_URL_PROTOCOLS = {
  prodDomain: ['http:', 'https:'],
  devDomain: ['http:', 'https:'],
  prodWsDomain: ['ws:', 'wss:'],
  devWsDomain: ['ws:', 'wss:']
}

const validateStoreWrite = (value) => {
  const payload = requireObject(value)
  const key = requireString(payload.key, 'key', { maxLength: 64 })
  const protocols = STORE_URL_PROTOCOLS[key]
  if (!protocols) {
    fail('key is not an allowed local store setting')
  }
  requireUrl(payload.value, 'value', protocols)
}

const validateStoreRead = (value) => {
  const key = typeof value === 'string' ? value : requireObject(value).key
  requireString(key, 'key', { maxLength: 64 })
  if (!STORE_URL_PROTOCOLS[key]) {
    fail('key is not an allowed local store setting')
  }
}

const validateContactId = (value) => {
  requireIdentifier(value, 'contactId')
}

const validateTopChatSession = (value) => {
  const payload = requireObject(value)
  requireIdentifier(payload.contactId, 'contactId')
  requireEnum(payload.topType, 'topType', [0, 1])
}

const validateLoadChatMessage = (value) => {
  const payload = requireObject(value)
  requireIdentifier(payload.sessionId, 'sessionId')
  if (payload.beforeMessageId != null) {
    requireIdentifier(payload.beforeMessageId, 'beforeMessageId')
  }
  if (payload.targetMessageId != null) {
    requireIdentifier(payload.targetMessageId, 'targetMessageId')
  }
  if (payload.loadMode != null) {
    requireEnum(payload.loadMode, 'loadMode', ['tail', 'context'])
  }
  requireOptionalSequence(payload.loadSeq, 'loadSeq')
}

const validateMarkSessionRead = (value) => {
  const payload = value && typeof value === 'object' ? requireObject(value) : { contactId: value }
  requireIdentifier(payload.contactId, 'contactId')
  if (payload.operationId != null) {
    requireString(payload.operationId, 'operationId', { maxLength: 128 })
  }
}

const validateClearChatMessage = (value) => {
  const payload = requireObject(value)
  requireIdentifier(payload.sessionId, 'sessionId')
}

const validateSearchChatMessage = (value) => {
  const payload = requireObject(value)
  requireIdentifier(payload.sessionId, 'sessionId')
  requireString(payload.keyword, 'keyword', { maxLength: 200 })
  requireOptionalSequence(payload.searchSeq, 'searchSeq')
}

const validateMessage = (value, { requireSessionId = false } = {}) => {
  const message = requireObject(value, 'message')
  requireIdentifier(message.messageId, 'message.messageId', { allowNegative: true })
  if (requireSessionId || message.sessionId != null) {
    requireIdentifier(message.sessionId, 'message.sessionId')
  }
  if (message.contactId != null) {
    requireIdentifier(message.contactId, 'message.contactId')
  }
  if (message.contactType != null) {
    requireEnum(message.contactType, 'message.contactType', [0, 1])
  }
  if (message.messageType != null) {
    requireEnum(message.messageType, 'message.messageType', [0, 1, 2, 3, 4, 5, 6])
  }
  if (message.messageContent != null) {
    const maxLength = Number(message.messageType) === 2 ? MAX_MESSAGE_LENGTH : MAX_FILE_NAME_LENGTH
    requireString(message.messageContent, 'message.messageContent', {
      maxLength,
      allowEmpty: Number(message.messageType) !== 2
    })
  }
  if (message.status != null) {
    requireEnum(message.status, 'message.status', [0, 1, 2])
  }
  requireOptionalSize(message.fileSize, 'message.fileSize')
  if (message.fileName != null) {
    requireString(message.fileName, 'message.fileName', {
      maxLength: MAX_FILE_NAME_LENGTH,
      allowEmpty: true
    })
  }
}

const validateSaveSendMessage = (value) => {
  const payload = requireObject(value)
  const mode = payload.mode ?? 'replace'
  requireEnum(mode, 'mode', ['pending', 'replace', 'status'])
  validateMessage(payload.message, { requireSessionId: mode !== 'status' })
  if (mode === 'replace') {
    requireIdentifier(payload.localMessageId, 'localMessageId', { allowNegative: true })
  }
  if (mode === 'status') {
    requireEnum(payload.status ?? payload.message.status, 'status', [0, 1, 2])
  }
  if (payload.chatSession != null) {
    const session = requireObject(payload.chatSession, 'chatSession')
    if (session.contactId != null) {
      requireIdentifier(session.contactId, 'chatSession.contactId')
    }
    if (session.sessionId != null) {
      requireIdentifier(session.sessionId, 'chatSession.sessionId')
    }
  }
}

const validateUploadSourceRegistration = (value) => {
  const payload = requireObject(value)
  requireAbsolutePath(payload.filePath)
  requireString(payload.name, 'name', {
    maxLength: MAX_FILE_NAME_LENGTH,
    allowEmpty: true
  })
  requireOptionalSize(payload.size, 'size')
  if (!Number.isSafeInteger(Number(payload.size)) || Number(payload.size) <= 0) {
    fail('size must be a positive safe integer')
  }
  if (payload.type != null) {
    requireString(payload.type, 'type', { maxLength: 255, allowEmpty: true })
  }
  if (payload.lastModified != null) {
    requireOptionalSize(payload.lastModified, 'lastModified')
  }
}

const validateUploadSourceId = (value) => {
  const payload = requireObject(value)
  requireString(payload.uploadSourceId, 'uploadSourceId', { maxLength: 128 })
}

const validateUploadSourceChunk = (value, maxChunkSize) => {
  const payload = requireObject(value)
  requireString(payload.uploadSourceId, 'uploadSourceId', { maxLength: 128 })
  if (!Number.isSafeInteger(payload.start) || payload.start < 0) {
    fail('start must be a non-negative safe integer')
  }
  if (!Number.isSafeInteger(payload.end) || payload.end <= payload.start) {
    fail('end must be greater than start')
  }
  if (Number.isSafeInteger(maxChunkSize) && payload.end - payload.start > maxChunkSize) {
    fail('upload source chunk is too large')
  }
}

const validateTempVideo = (value, maxSize) => {
  const payload = requireObject(value)
  requireString(payload.fileName ?? 'video.mp4', 'fileName', {
    maxLength: 255
  })
  const buffer = payload.buffer
  const byteLength = buffer?.byteLength
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > maxSize) {
    fail('buffer must contain a supported video payload')
  }
}

const validateFilePathPayload = (value) => {
  const payload = requireObject(value)
  requireAbsolutePath(payload.filePath)
}

const validateDownload = (value) => {
  const payload = requireObject(value)
  validateHttpUrl(payload.url)
  requireIdentifier(payload.messageId, 'messageId', { allowNegative: true })
  if (payload.fileName != null) {
    requireString(payload.fileName, 'fileName', {
      maxLength: MAX_FILE_NAME_LENGTH,
      allowEmpty: true
    })
  }
  requireOptionalSize(payload.fileSize, 'fileSize')
  requireOptionalSize(payload.maxSize, 'maxSize')
}

const validateDownloadId = (value) => {
  const payload = requireObject(value)
  requireIdentifier(payload.messageId, 'messageId', { allowNegative: true })
}

export {
  IpcValidationError,
  MAX_MESSAGE_LENGTH,
  validateClearChatMessage,
  validateContactId,
  validateDownload,
  validateDownloadId,
  validateFilePathPayload,
  validateHttpUrl,
  validateLoadChatMessage,
  validateLoginOrRegister,
  validateMarkSessionRead,
  validateOpenChat,
  validateSaveSendMessage,
  validateSearchChatMessage,
  validateStoreRead,
  validateStoreWrite,
  validateTempVideo,
  validateTopChatSession,
  validateUploadSourceChunk,
  validateUploadSourceId,
  validateUploadSourceRegistration,
  validateWindowOperation
}
