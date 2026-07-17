import fs from 'fs'
import path from 'path'
import { getEasyChatPaths } from './appPaths.js'

const recoveryFolder = getEasyChatPaths().receiveRecoveryDir
const operationChains = new Map()

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

const appendReceiveRecoveryMessages = async (userId, messages = []) => {
  if (!messages.length) {
    return 0
  }
  return await withRecoveryLock(userId, async () => {
    await fs.promises.mkdir(recoveryFolder, { recursive: true })
    const content = messages.map((message) => JSON.stringify(message)).join('\n') + '\n'
    await fs.promises.appendFile(getRecoveryFile(userId), content, 'utf8')
    return messages.length
  })
}

const readReceiveRecoveryMessagesUnlocked = async (userId) => {
  const filePath = getRecoveryFile(userId)
  let content
  try {
    content = await fs.promises.readFile(filePath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return []
    }
    throw error
  }
  const messages = []
  const keys = new Set()
  content.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) {
      return
    }
    try {
      const message = JSON.parse(line)
      const key = getMessageKey(message)
      if (!keys.has(key)) {
        keys.add(key)
        messages.push(message)
      }
    } catch (error) {
      console.warn('Ignoring invalid receive recovery record', {
        error: error?.message,
        bytes: line.length
      })
    }
  })
  return messages
}

const readReceiveRecoveryMessages = async (userId) => {
  return await withRecoveryLock(userId, () => readReceiveRecoveryMessagesUnlocked(userId))
}

const replaceReceiveRecoveryMessagesUnlocked = async (userId, messages = []) => {
  const filePath = getRecoveryFile(userId)
  await fs.promises.mkdir(recoveryFolder, { recursive: true })
  if (!messages.length) {
    await fs.promises.unlink(filePath).catch((error) => {
      if (error?.code !== 'ENOENT') {
        throw error
      }
    })
    return
  }
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  const content = messages.map((message) => JSON.stringify(message)).join('\n') + '\n'
  await fs.promises.writeFile(tempPath, content, 'utf8')
  await fs.promises.rename(tempPath, filePath)
}

const replaceReceiveRecoveryMessages = async (userId, messages = []) => {
  return await withRecoveryLock(userId, () =>
    replaceReceiveRecoveryMessagesUnlocked(userId, messages)
  )
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
  appendReceiveRecoveryMessages,
  compactReceiveRecoveryMessages,
  getMessageKey,
  readReceiveRecoveryMessages,
  replaceReceiveRecoveryMessages
}
