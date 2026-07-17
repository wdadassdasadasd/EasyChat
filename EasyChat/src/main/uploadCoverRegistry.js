import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'

import { MAX_UPLOAD_COVER_BYTES } from '../shared/uploadConstants.js'
import { getEasyChatPaths } from './appPaths.js'
import store from './store.js'

const REGISTRY_KEY = 'uploadCoverRegistry'

const getRegistry = (userId = store.getUserId()) => {
  const value = store.getUserDataForUser(userId, REGISTRY_KEY)
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

const saveRegistry = (registry, userId = store.getUserId()) => {
  store.setUserDataForUser(userId, REGISTRY_KEY, registry)
}

const getCoverFolder = () => path.join(getEasyChatPaths().rootDir, 'upload-covers')

const registerUploadCover = async ({ arrayBuffer, type } = {}) => {
  const bytes = arrayBuffer?.byteLength
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_UPLOAD_COVER_BYTES) {
    throw new Error('Upload cover exceeds the supported size')
  }

  const userId = store.getUserId()
  const coverSourceId = randomUUID()
  const filePath = path.join(getCoverFolder(), `${coverSourceId}.cover`)
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  await fs.promises.writeFile(filePath, Buffer.from(arrayBuffer))

  const registry = getRegistry(userId)
  registry[coverSourceId] = {
    filePath,
    type: String(type || 'application/octet-stream').slice(0, 255),
    size: bytes,
    createdAt: Date.now()
  }
  saveRegistry(registry, userId)
  return { success: true, coverSourceId, size: bytes, type: registry[coverSourceId].type }
}

const getUploadCover = async (coverSourceId, { userId = store.getUserId() } = {}) => {
  if (!coverSourceId || typeof coverSourceId !== 'string') {
    throw new Error('Invalid upload cover id')
  }
  const cover = getRegistry(userId)[coverSourceId]
  if (!cover?.filePath) {
    throw new Error('Unknown upload cover')
  }
  const stat = await fs.promises.stat(cover.filePath)
  if (!stat.isFile() || stat.size !== Number(cover.size) || stat.size > MAX_UPLOAD_COVER_BYTES) {
    throw new Error('Upload cover is unavailable or has changed')
  }
  return cover
}

const readUploadCover = async ({ coverSourceId, userId } = {}) => {
  const cover = await getUploadCover(coverSourceId, { userId })
  const buffer = await fs.promises.readFile(cover.filePath)
  if (buffer.byteLength !== Number(cover.size)) {
    throw new Error('Upload cover could not be read completely')
  }
  return { cover, buffer }
}

const releaseUploadCover = async ({ coverSourceId, userId } = {}) => {
  const targetUserId = userId || store.getUserId()
  const registry = getRegistry(targetUserId)
  const cover = registry[coverSourceId]
  if (!cover) return { success: true, released: false }

  delete registry[coverSourceId]
  saveRegistry(registry, targetUserId)
  await fs.promises.unlink(cover.filePath).catch((error) => {
    if (error?.code !== 'ENOENT') throw error
  })
  return { success: true, released: true }
}

export { getUploadCover, readUploadCover, registerUploadCover, releaseUploadCover }
