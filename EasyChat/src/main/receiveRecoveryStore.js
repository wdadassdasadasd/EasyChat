import fs from 'fs'
import path from 'path'
import { RECEIVE_RECOVERY_MAX_BYTES, RECEIVE_RECOVERY_MAX_RECORDS } from './constants.js'
import { getEasyChatPaths } from './appPaths.js'

const recoveryFolder = getEasyChatPaths().receiveRecoveryDir
const operationChains = new Map()

const RECOVERY_RESULT_KINDS = Object.freeze({
  STORED: 'stored',
  CAPACITY_EXCEEDED: 'capacity_exceeded',
  CORRUPT: 'corrupt',
  IO_ERROR: 'io_error'
})

const withRecoveryLock = async (userId, task) => {
  const key = String(userId || 'anonymous')
  const previous = operationChains.get(key) || Promise.resolve()
  const current = previous.catch(() => {}).then(task)
  operationChains.set(key, current)
  try {
    return await current
  } finally {
    if (operationChains.get(key) === current) {
      operationChains.delete(key)
    }
  }
}

const getRecoveryFile = (userId) => {
  const safeUserId = String(userId || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(recoveryFolder, `${safeUserId}.jsonl`)
}

const getMessageKey = (message = {}) => `${message.sessionId || ''}:${message.messageId || ''}`

const serializeMessages = (messages = []) => {
  return messages.length ? `${messages.map((message) => JSON.stringify(message)).join('\n')}\n` : ''
}

const readRecoverySnapshotUnlocked = async (userId) => {
  const filePath = getRecoveryFile(userId)
  let content
  try {
    content = await fs.promises.readFile(filePath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { messages: [], corrupt: false }
    }
    throw error
  }

  const messages = []
  const keys = new Set()
  let corrupt = false
  content.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) return
    try {
      const message = JSON.parse(line)
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        corrupt = true
        return
      }
      const key = getMessageKey(message)
      if (!keys.has(key)) {
        keys.add(key)
        messages.push(message)
      }
    } catch (_error) {
      corrupt = true
    }
  })
  return { messages, corrupt }
}

const replaceRecoveryContentUnlocked = async (userId, content) => {
  const filePath = getRecoveryFile(userId)
  await fs.promises.mkdir(recoveryFolder, { recursive: true })
  if (!content) {
    await fs.promises.unlink(filePath).catch((error) => {
      if (error?.code !== 'ENOENT') throw error
    })
    return
  }

  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.promises.writeFile(tempPath, content, 'utf8')
    await fs.promises.rename(tempPath, filePath)
  } catch (error) {
    await fs.promises.unlink(tempPath).catch(() => {})
    throw error
  }
}

const appendReceiveRecoveryMessages = async (userId, messages = []) => {
  if (!messages.length) {
    return { success: true, kind: RECOVERY_RESULT_KINDS.STORED, storedCount: 0 }
  }
  return await withRecoveryLock(userId, async () => {
    let snapshot
    try {
      snapshot = await readRecoverySnapshotUnlocked(userId)
    } catch (error) {
      return { success: false, kind: RECOVERY_RESULT_KINDS.IO_ERROR, error }
    }
    if (snapshot.corrupt) {
      return { success: false, kind: RECOVERY_RESULT_KINDS.CORRUPT }
    }

    const keys = new Set(snapshot.messages.map(getMessageKey))
    const mergedMessages = [...snapshot.messages]
    messages.forEach((message) => {
      const key = getMessageKey(message)
      if (!keys.has(key)) {
        keys.add(key)
        mergedMessages.push(message)
      }
    })
    const content = serializeMessages(mergedMessages)
    if (
      mergedMessages.length > RECEIVE_RECOVERY_MAX_RECORDS ||
      Buffer.byteLength(content, 'utf8') > RECEIVE_RECOVERY_MAX_BYTES
    ) {
      return {
        success: false,
        kind: RECOVERY_RESULT_KINDS.CAPACITY_EXCEEDED,
        existingCount: snapshot.messages.length
      }
    }

    if (mergedMessages.length === snapshot.messages.length) {
      return { success: true, kind: RECOVERY_RESULT_KINDS.STORED, storedCount: 0 }
    }
    try {
      await replaceRecoveryContentUnlocked(userId, content)
      return {
        success: true,
        kind: RECOVERY_RESULT_KINDS.STORED,
        storedCount: mergedMessages.length - snapshot.messages.length
      }
    } catch (error) {
      return { success: false, kind: RECOVERY_RESULT_KINDS.IO_ERROR, error }
    }
  })
}

const readReceiveRecoveryMessagesUnlocked = async (userId) => {
  const snapshot = await readRecoverySnapshotUnlocked(userId)
  if (snapshot.corrupt) {
    const error = new Error('Receive recovery log is corrupt')
    error.kind = RECOVERY_RESULT_KINDS.CORRUPT
    throw error
  }
  return snapshot.messages
}

const readReceiveRecoveryMessages = async (userId) => {
  return await withRecoveryLock(userId, () => readReceiveRecoveryMessagesUnlocked(userId))
}

const replaceReceiveRecoveryMessagesUnlocked = async (userId, messages = []) => {
  const snapshot = await readRecoverySnapshotUnlocked(userId)
  if (snapshot.corrupt) {
    const error = new Error('Receive recovery log is corrupt')
    error.kind = RECOVERY_RESULT_KINDS.CORRUPT
    throw error
  }
  const content = serializeMessages(messages)
  if (
    messages.length > RECEIVE_RECOVERY_MAX_RECORDS ||
    Buffer.byteLength(content, 'utf8') > RECEIVE_RECOVERY_MAX_BYTES
  ) {
    const error = new Error('Receive recovery log capacity exceeded')
    error.kind = RECOVERY_RESULT_KINDS.CAPACITY_EXCEEDED
    throw error
  }
  await replaceRecoveryContentUnlocked(userId, content)
}

const replaceReceiveRecoveryMessages = async (userId, messages = []) => {
  return await withRecoveryLock(userId, () => replaceReceiveRecoveryMessagesUnlocked(userId, messages))
}

const compactReceiveRecoveryMessages = async (userId, processedMessages = []) => {
  const processedKeys = new Set(processedMessages.map(getMessageKey))
  return await withRecoveryLock(userId, async () => {
    const latestMessages = await readReceiveRecoveryMessagesUnlocked(userId)
    const remainingMessages = latestMessages.filter(
      (message) => !processedKeys.has(getMessageKey(message))
    )
    await replaceReceiveRecoveryMessagesUnlocked(userId, remainingMessages)
    return remainingMessages.length
  })
}

export {
  RECOVERY_RESULT_KINDS,
  appendReceiveRecoveryMessages,
  compactReceiveRecoveryMessages,
  getMessageKey,
  readReceiveRecoveryMessages,
  replaceReceiveRecoveryMessages
}
