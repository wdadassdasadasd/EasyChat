import { randomUUID } from 'crypto'
import fs from 'fs'
import { spawn } from 'child_process'

import store from './store.js'

const REGISTRY_KEY = 'uploadSourceRegistry'
const MAX_REGISTRY_ITEMS = 100
const MAX_CHUNK_SIZE = 4 * 1024 * 1024
const FFMPEG_THUMBNAIL_TIMEOUT_MS = 10000

const getRegistry = () => {
  const value = store.getUserData(REGISTRY_KEY)
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

const saveRegistry = (registry) => {
  const entries = Object.entries(registry)
    .sort(([, left], [, right]) => Number(left.createdAt || 0) - Number(right.createdAt || 0))
    .slice(-MAX_REGISTRY_ITEMS)
  store.setUserData(REGISTRY_KEY, Object.fromEntries(entries))
}

const getUploadSource = async (uploadSourceId) => {
  if (!uploadSourceId || typeof uploadSourceId !== 'string') {
    throw new Error('Invalid upload source id')
  }
  const source = getRegistry()[uploadSourceId]
  if (!source?.filePath) {
    throw new Error('Unknown upload source')
  }
  const stat = await fs.promises.stat(source.filePath)
  if (!stat.isFile() || stat.size !== Number(source.size)) {
    throw new Error('Upload source is unavailable or has changed')
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
  const registry = getRegistry()
  registry[uploadSourceId] = {
    filePath,
    name: String(name || '').slice(0, 512),
    size: stat.size,
    type: String(type || '').slice(0, 255),
    lastModified: Number(lastModified || 0),
    createdAt: Date.now()
  }
  saveRegistry(registry)
  return {
    success: true,
    uploadSourceId,
    name: registry[uploadSourceId].name,
    size: stat.size,
    type: registry[uploadSourceId].type
  }
}

const readUploadSourceChunk = async ({ uploadSourceId, start, end } = {}) => {
  const source = await getUploadSource(uploadSourceId)
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

const releaseUploadSource = ({ uploadSourceId } = {}) => {
  const registry = getRegistry()
  if (!registry[uploadSourceId]) {
    return { success: true, released: false }
  }
  delete registry[uploadSourceId]
  saveRegistry(registry)
  return { success: true, released: true }
}

const generateThumbnailFromPath = (filePath, { timeoutMs = FFMPEG_THUMBNAIL_TIMEOUT_MS } = {}) => {
  return new Promise((resolve) => {
    const chunks = []
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
      '-vframes',
      '1',
      '-f',
      'image2pipe',
      '-vcodec',
      'mjpeg',
      '-'
    ])

    timeout = setTimeout(() => {
      finish({
        success: false,
        kind: 'timeout',
        error: `ffmpeg thumbnail extraction timed out after ${timeoutMs}ms`
      })
      try {
        ffmpeg.kill()
      } catch (error) {
        console.error('终止 ffmpeg 进程失败:', error)
      }
    }, timeoutMs)

    ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk))
    ffmpeg.on('error', (error) => finish({ success: false, error: error.message }))
    ffmpeg.on('close', (code) => {
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

const generateUploadSourceThumbnail = async ({ uploadSourceId } = {}) => {
  const source = await getUploadSource(uploadSourceId)
  return await generateThumbnailFromPath(source.filePath)
}

export {
  FFMPEG_THUMBNAIL_TIMEOUT_MS,
  MAX_CHUNK_SIZE,
  generateThumbnailFromPath,
  generateUploadSourceThumbnail,
  getUploadSource,
  readUploadSourceChunk,
  registerUploadSource,
  releaseUploadSource
}
