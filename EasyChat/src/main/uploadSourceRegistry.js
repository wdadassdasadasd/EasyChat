import { randomUUID } from 'crypto'
import fs from 'fs'
import { spawn } from 'child_process'
import { safeStorage } from 'electron'

import store from './store.js'
import { getSecureStorageStatus } from './secureSessionStore.js'

const REGISTRY_KEY = 'uploadSourceRegistry'
const MAX_REGISTRY_ITEMS = 100
const MAX_CHUNK_SIZE = 4 * 1024 * 1024
const FFMPEG_THUMBNAIL_TIMEOUT_MS = 10000
const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024
const REGISTRY_STORAGE_VERSION = 1
const memoryRegistries = new Map()

const isRegistry = (value) => value && typeof value === 'object' && !Array.isArray(value)

const getStoredRegistry = (userId) => store.getUserDataForUser(userId, REGISTRY_KEY)

const clearStoredRegistry = (userId) => store.deleteUserDataForUser?.(userId, REGISTRY_KEY)

const encryptRegistry = (registry) => ({
  version: REGISTRY_STORAGE_VERSION,
  ciphertext: safeStorage.encryptString(JSON.stringify(registry)).toString('base64')
})

const decryptRegistry = (stored) => {
  if (!stored?.ciphertext || Number(stored.version) !== REGISTRY_STORAGE_VERSION) return null
  const plain = safeStorage.decryptString(Buffer.from(stored.ciphertext, 'base64'))
  const registry = JSON.parse(plain)
  return isRegistry(registry) ? registry : null
}

const getRegistry = (userId = store.getUserId()) => {
  if (!userId) return {}
  const storage = getSecureStorageStatus()
  const stored = getStoredRegistry(userId)

  if (!storage.available) {
    if (memoryRegistries.has(userId)) return memoryRegistries.get(userId)
    // Legacy plaintext paths must never remain on disk when secure storage is unavailable.
    if (isRegistry(stored) && !stored.ciphertext) {
      memoryRegistries.set(userId, stored)
      clearStoredRegistry(userId)
      return stored
    }
    return {}
  }

  let registry = {}
  let shouldPersist = false
  if (isRegistry(stored) && stored.ciphertext) {
    try {
      registry = decryptRegistry(stored) || {}
    } catch {
      clearStoredRegistry(userId)
      registry = {}
    }
  } else if (isRegistry(stored)) {
    // One-way migration from the old electron-store plaintext payload.
    registry = stored
    shouldPersist = true
  }

  if (memoryRegistries.has(userId)) {
    registry = { ...registry, ...memoryRegistries.get(userId) }
    shouldPersist = true
  }
  memoryRegistries.set(userId, registry)
  if (shouldPersist) {
    try {
      store.setUserDataForUser(userId, REGISTRY_KEY, encryptRegistry(registry))
    } catch {
      // Keep the current-session mapping usable without falling back to plaintext persistence.
    }
  }
  return registry
}

const saveRegistry = (registry, userId = store.getUserId()) => {
  const entries = Object.entries(registry).sort(
    ([, left], [, right]) => Number(left.createdAt || 0) - Number(right.createdAt || 0)
  )
  // 正在被持久化上传任务引用的源文件绝不能因数量上限被淘汰；极端情况下
  // 宁可临时超过上限，也不能破坏断点续传。
  while (entries.length > MAX_REGISTRY_ITEMS) {
    const index = entries.findIndex(([, source]) => !source.pinned)
    if (index < 0) break
    entries.splice(index, 1)
  }
  const nextRegistry = Object.fromEntries(entries)
  memoryRegistries.set(userId, nextRegistry)
  const storage = getSecureStorageStatus()
  if (!storage.available) {
    // Do not overwrite a pre-existing encrypted record; new sources remain memory-only.
    const stored = getStoredRegistry(userId)
    if (isRegistry(stored) && !stored.ciphertext) clearStoredRegistry(userId)
    return
  }
  try {
    store.setUserDataForUser(userId, REGISTRY_KEY, encryptRegistry(nextRegistry))
  } catch {
    // Secure storage failures retain the source only for this process.
  }
}

const getUploadSource = async (uploadSourceId, { userId = store.getUserId() } = {}) => {
  if (!uploadSourceId || typeof uploadSourceId !== 'string') {
    throw new Error('Invalid upload source id')
  }
  const source = getRegistry(userId)[uploadSourceId]
  if (!source?.filePath) {
    throw new Error('Unknown upload source')
  }
  const stat = await fs.promises.stat(source.filePath)
  if (!stat.isFile() || stat.size !== Number(source.size)) {
    throw new Error('Upload source is unavailable or has changed')
  }
  const expectedMtime = Number(source.sourceMtimeMs || source.lastModified || 0)
  // 仅比较文件大小无法识别“同大小内容被覆盖”的情况；恢复上传前必须拒绝
  // 已变化的源文件，避免把错误内容拼接到既有上传会话中。
  if (expectedMtime > 0 && Number.isFinite(Number(stat.mtimeMs))) {
    if (Math.abs(Number(stat.mtimeMs) - expectedMtime) > 2000) {
      throw new Error('Upload source is unavailable or has changed')
    }
  }
  return source
}

const registerUploadSource = async ({ filePath, name, size, type, lastModified } = {}) => {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Upload source path is required')
  }
  const stat = await fs.promises.stat(filePath)
  if (!stat.isFile() || stat.size !== Number(size)) {
    throw new Error('Upload source metadata does not match the selected file')
  }
  const uploadSourceId = randomUUID()
  const userId = store.getUserId()
  const registry = getRegistry(userId)
  registry[uploadSourceId] = {
    filePath,
    name: String(name || '').slice(0, 512),
    size: stat.size,
    type: String(type || '').slice(0, 255),
    lastModified: Number(lastModified || 0),
    sourceMtimeMs: Number.isFinite(Number(stat.mtimeMs)) ? Math.trunc(stat.mtimeMs) : 0,
    pinned: false,
    createdAt: Date.now()
  }
  saveRegistry(registry, userId)
  return {
    success: true,
    uploadSourceId,
    name: registry[uploadSourceId].name,
    size: stat.size,
    type: registry[uploadSourceId].type
  }
}

const readUploadSourceChunk = async ({ uploadSourceId, start, end, userId } = {}) => {
  const source = await getUploadSource(uploadSourceId, { userId })
  const rangeStart = Number(start)
  const rangeEnd = Number(end)
  if (
    !Number.isSafeInteger(rangeStart) ||
    !Number.isSafeInteger(rangeEnd) ||
    rangeStart < 0 ||
    rangeEnd <= rangeStart ||
    rangeEnd > source.size ||
    rangeEnd - rangeStart > MAX_CHUNK_SIZE
  ) {
    throw new Error('Invalid upload source range')
  }

  const length = rangeEnd - rangeStart
  const handle = await fs.promises.open(source.filePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(length)
    const { bytesRead } = await handle.read(buffer, 0, length, rangeStart)
    if (bytesRead !== length) {
      throw new Error('Upload source could not be read completely')
    }
    return {
      success: true,
      arrayBuffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    }
  } finally {
    await handle.close()
  }
}

const releaseUploadSource = ({ uploadSourceId, userId } = {}) => {
  const targetUserId = userId || store.getUserId()
  const registry = getRegistry(targetUserId)
  if (!registry[uploadSourceId]) {
    return { success: true, released: false }
  }
  delete registry[uploadSourceId]
  saveRegistry(registry, targetUserId)
  return { success: true, released: true }
}

const generateThumbnailFromPath = (
  filePath,
  { timeoutMs = FFMPEG_THUMBNAIL_TIMEOUT_MS, maxOutputBytes = MAX_THUMBNAIL_BYTES } = {}
) => {
  return new Promise((resolve) => {
    const chunks = []
    let outputBytes = 0
    let settled = false
    let timeout = null
    const finish = (result) => {
      if (settled) return
      settled = true
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
      resolve(result)
    }
    const ffmpeg = spawn('ffmpeg', [
      '-i',
      filePath,
      '-ss',
      '00:00:01',
      '-vf',
      'scale=min(1280\\,iw):-2',
      '-vframes',
      '1',
      '-f',
      'image2pipe',
      '-vcodec',
      'mjpeg',
      '-'
    ])

    const stopFfmpeg = () => {
      try {
        ffmpeg.kill()
      } catch (error) {
        console.error('终止 ffmpeg 进程失败:', error)
      }
    }

    timeout = setTimeout(() => {
      finish({
        success: false,
        kind: 'timeout',
        error: `ffmpeg thumbnail extraction timed out after ${timeoutMs}ms`
      })
      stopFfmpeg()
    }, timeoutMs)

    ffmpeg.stdout.on('data', (chunk) => {
      if (settled) return
      outputBytes += chunk.byteLength
      if (outputBytes > maxOutputBytes) {
        finish({
          success: false,
          kind: 'output_too_large',
          error: `ffmpeg thumbnail output exceeds ${maxOutputBytes} bytes`
        })
        stopFfmpeg()
        return
      }
      chunks.push(chunk)
    })
    ffmpeg.on('error', (error) => finish({ success: false, error: error.message }))
    ffmpeg.on('close', (code) => {
      if (settled) return
      const buffer = Buffer.concat(chunks)
      if (code === 0 && buffer.length > 0) {
        finish({
          success: true,
          arrayBuffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
        })
        return
      }
      finish({ success: false, error: `ffmpeg exited with code ${code}` })
    })
  })
}

const setUploadSourcePinned = ({ uploadSourceId, userId, pinned = true } = {}) => {
  const targetUserId = userId || store.getUserId()
  const registry = getRegistry(targetUserId)
  if (!registry[uploadSourceId]) return false
  registry[uploadSourceId].pinned = Boolean(pinned)
  saveRegistry(registry, targetUserId)
  return true
}

const pinUploadSource = (options = {}) => setUploadSourcePinned({ ...options, pinned: true })

const generateUploadSourceThumbnail = async ({ uploadSourceId, userId } = {}) => {
  const source = await getUploadSource(uploadSourceId, { userId })
  return await generateThumbnailFromPath(source.filePath)
}

export {
  FFMPEG_THUMBNAIL_TIMEOUT_MS,
  MAX_CHUNK_SIZE,
  MAX_THUMBNAIL_BYTES,
  generateThumbnailFromPath,
  generateUploadSourceThumbnail,
  getUploadSource,
  pinUploadSource,
  readUploadSourceChunk,
  registerUploadSource,
  releaseUploadSource,
  setUploadSourcePinned
}
