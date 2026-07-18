import { createHash, randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { safeStorage } from 'electron'

import { MAX_UPLOAD_COVER_BYTES } from '../shared/uploadConstants.js'
import { getEasyChatPaths } from './appPaths.js'
import { getSecureStorageStatus } from './secureSessionStore.js'
import store from './store.js'

const REGISTRY_KEY = 'uploadCoverRegistry'
const REGISTRY_STORAGE_VERSION = 1
const ORPHAN_COVER_RETENTION_MS = 10 * 60 * 1000
const LEGACY_ORPHAN_COVER_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const COVER_FILE_SUFFIX = '.cover'
const COVER_SOURCE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
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
  const registry = JSON.parse(safeStorage.decryptString(Buffer.from(stored.ciphertext, 'base64')))
  return isRegistry(registry) ? registry : null
}
const getLegacyCoverFolder = () => path.join(getEasyChatPaths().rootDir, 'upload-covers')
const getUserCoverFolderName = (userId) => createHash('sha256').update(String(userId)).digest('hex')
const getCoverFolder = (userId = store.getUserId()) => {
  if (!userId) throw new Error('Upload cover user is required')
  return path.join(getLegacyCoverFolder(), getUserCoverFolderName(userId))
}
const getExpectedCoverPath = (coverSourceId, userId, { legacy = false } = {}) => {
  const folder = legacy ? getLegacyCoverFolder() : getCoverFolder(userId)
  return path.resolve(folder, `${coverSourceId}${COVER_FILE_SUFFIX}`)
}
const isSafeCoverRecord = (coverSourceId, cover, userId) => {
  if (!COVER_SOURCE_ID_PATTERN.test(String(coverSourceId || '')) || !cover?.filePath) return false
  const candidate = path.resolve(String(cover.filePath))
  return candidate === getExpectedCoverPath(coverSourceId, userId) || candidate === getExpectedCoverPath(coverSourceId, userId, { legacy: true })
}
const normalizeRegistry = (registry, userId) => {
  const normalized = {}
  let changed = false
  for (const [coverSourceId, cover] of Object.entries(registry || {})) {
    const size = Number(cover?.size)
    if (!isSafeCoverRecord(coverSourceId, cover, userId) || !Number.isSafeInteger(size) || size <= 0 || size > MAX_UPLOAD_COVER_BYTES) {
      changed = true
      continue
    }
    normalized[coverSourceId] = {
      filePath: path.resolve(cover.filePath),
      type: String(cover.type || 'application/octet-stream').slice(0, 255),
      size,
      createdAt: Number(cover.createdAt || 0)
    }
  }
  return { registry: normalized, changed }
}
const getRegistry = (userId = store.getUserId()) => {
  if (!userId) return {}
  const storage = getSecureStorageStatus()
  const stored = getStoredRegistry(userId)
  if (!storage.available) {
    if (memoryRegistries.has(userId)) return memoryRegistries.get(userId)
    if (isRegistry(stored) && !stored.ciphertext) {
      const registry = normalizeRegistry(stored, userId).registry
      memoryRegistries.set(userId, registry)
      clearStoredRegistry(userId)
      return registry
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
    }
  } else if (isRegistry(stored)) {
    registry = stored
    shouldPersist = true
  }
  const normalized = normalizeRegistry(registry, userId)
  registry = normalized.registry
  shouldPersist ||= normalized.changed
  if (memoryRegistries.has(userId)) {
    registry = { ...registry, ...memoryRegistries.get(userId) }
    shouldPersist = true
  }
  memoryRegistries.set(userId, registry)
  if (shouldPersist) {
    try {
      store.setUserDataForUser(userId, REGISTRY_KEY, encryptRegistry(registry))
    } catch {
      // Keep the registry in memory; never fall back to plaintext persistence.
    }
  }
  return registry
}
const saveRegistry = (registry, userId = store.getUserId()) => {
  memoryRegistries.set(userId, registry)
  const storage = getSecureStorageStatus()
  if (!storage.available) {
    const stored = getStoredRegistry(userId)
    if (isRegistry(stored) && !stored.ciphertext) clearStoredRegistry(userId)
    return
  }
  try {
    store.setUserDataForUser(userId, REGISTRY_KEY, encryptRegistry(registry))
  } catch {
    // Keep the registry in memory; never fall back to plaintext persistence.
  }
}
const registerUploadCover = async ({ arrayBuffer, type } = {}) => {
  const bytes = arrayBuffer?.byteLength
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_UPLOAD_COVER_BYTES) throw new Error('Upload cover exceeds the supported size')
  const userId = store.getUserId()
  if (!userId) throw new Error('Upload cover user is required')
  const coverSourceId = randomUUID()
  const filePath = getExpectedCoverPath(coverSourceId, userId)
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  await fs.promises.writeFile(filePath, Buffer.from(arrayBuffer))
  const registry = getRegistry(userId)
  registry[coverSourceId] = { filePath, type: String(type || 'application/octet-stream').slice(0, 255), size: bytes, createdAt: Date.now() }
  saveRegistry(registry, userId)
  return { success: true, coverSourceId, size: bytes, type: registry[coverSourceId].type }
}
const getUploadCover = async (coverSourceId, { userId = store.getUserId() } = {}) => {
  if (!coverSourceId || typeof coverSourceId !== 'string') throw new Error('Invalid upload cover id')
  const cover = getRegistry(userId)[coverSourceId]
  if (!isSafeCoverRecord(coverSourceId, cover, userId)) throw new Error('Unknown upload cover')
  const stat = await fs.promises.stat(cover.filePath)
  if (!stat.isFile() || stat.size !== Number(cover.size) || stat.size > MAX_UPLOAD_COVER_BYTES) throw new Error('Upload cover is unavailable or has changed')
  return cover
}
const readUploadCover = async ({ coverSourceId, userId } = {}) => {
  const cover = await getUploadCover(coverSourceId, { userId })
  const buffer = await fs.promises.readFile(cover.filePath)
  if (buffer.byteLength !== Number(cover.size)) throw new Error('Upload cover could not be read completely')
  return { cover, buffer }
}
const unlinkCover = async (filePath) => {
  await fs.promises.unlink(filePath).catch((error) => { if (error?.code !== 'ENOENT') throw error })
}
const releaseUploadCover = async ({ coverSourceId, userId } = {}) => {
  const targetUserId = userId || store.getUserId()
  const registry = getRegistry(targetUserId)
  const cover = registry[coverSourceId]
  if (!cover) return { success: true, released: false }
  if (!isSafeCoverRecord(coverSourceId, cover, targetUserId)) {
    delete registry[coverSourceId]
    saveRegistry(registry, targetUserId)
    return { success: true, released: false }
  }
  await unlinkCover(cover.filePath)
  delete registry[coverSourceId]
  saveRegistry(registry, targetUserId)
  return { success: true, released: true }
}
const cleanupUnregisteredCoverFiles = async ({ folder, registeredPaths, now, retentionMs }) => {
  let entries
  try { entries = await fs.promises.readdir(folder, { withFileTypes: true }) } catch (error) {
    if (error?.code === 'ENOENT') return { deletedCount: 0, failedCount: 0 }
    console.error('Failed to inspect upload cover folder', error)
    return { deletedCount: 0, failedCount: 1 }
  }
  let deletedCount = 0
  let failedCount = 0
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(COVER_FILE_SUFFIX)) continue
    const filePath = path.resolve(folder, entry.name)
    if (registeredPaths.has(filePath)) continue
    try {
      const stat = await fs.promises.stat(filePath)
      if (now - Number(stat.mtimeMs || 0) < retentionMs) continue
      await fs.promises.unlink(filePath)
      deletedCount += 1
    } catch (error) {
      failedCount += 1
      console.error(`Failed to clean upload cover file: ${filePath}`, error)
    }
  }
  return { deletedCount, failedCount }
}
const cleanupUploadCovers = async ({ userId = store.getUserId(), protectedCoverIds = [], now = Date.now(), orphanRetentionMs = ORPHAN_COVER_RETENTION_MS } = {}) => {
  if (!userId) return { deletedCount: 0, failedCount: 0 }
  const registry = getRegistry(userId)
  const protectedIds = new Set(protectedCoverIds)
  let deletedCount = 0
  let failedCount = 0
  let changed = false
  for (const [coverSourceId, cover] of Object.entries(registry)) {
    if (protectedIds.has(coverSourceId) || now - Number(cover.createdAt || 0) < orphanRetentionMs) continue
    if (!isSafeCoverRecord(coverSourceId, cover, userId)) {
      delete registry[coverSourceId]
      changed = true
      continue
    }
    try {
      await unlinkCover(cover.filePath)
      delete registry[coverSourceId]
      changed = true
      deletedCount += 1
    } catch (error) {
      failedCount += 1
      console.error(`Failed to release orphan upload cover: ${cover.filePath}`, error)
    }
  }
  if (changed) saveRegistry(registry, userId)
  const registeredPaths = new Set(Object.values(registry).map((cover) => path.resolve(cover.filePath)))
  const currentResult = await cleanupUnregisteredCoverFiles({ folder: getCoverFolder(userId), registeredPaths, now, retentionMs: orphanRetentionMs })
  const legacyResult = await cleanupUnregisteredCoverFiles({ folder: getLegacyCoverFolder(), registeredPaths, now, retentionMs: LEGACY_ORPHAN_COVER_RETENTION_MS })
  return { deletedCount: deletedCount + currentResult.deletedCount + legacyResult.deletedCount, failedCount: failedCount + currentResult.failedCount + legacyResult.failedCount }
}

export { LEGACY_ORPHAN_COVER_RETENTION_MS, ORPHAN_COVER_RETENTION_MS, cleanupUploadCovers, getCoverFolder, getUploadCover, readUploadCover, registerUploadCover, releaseUploadCover }
