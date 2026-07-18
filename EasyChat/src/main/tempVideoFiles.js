import fs from 'fs'
import path from 'path'

const TEMP_VIDEO_RETENTION_MS = 24 * 60 * 60 * 1000
const MAX_TEMP_VIDEO_FILES = 10
const MAX_TEMP_VIDEO_BYTES = 1024 * 1024 * 1024

const getTempVideoFolder = (tempRoot) => {
  return path.join(tempRoot, 'EasyChat', 'video-preview')
}

const cleanupExpiredTempVideos = async ({
  tempRoot,
  now = Date.now(),
  retentionMs = TEMP_VIDEO_RETENTION_MS,
  maxFiles = MAX_TEMP_VIDEO_FILES,
  maxBytes = MAX_TEMP_VIDEO_BYTES,
  reserveFiles = 0,
  reserveBytes = 0
} = {}) => {
  if (!tempRoot) {
    return { deletedCount: 0, failedCount: 0, retainedCount: 0, retainedBytes: 0, canAllocate: true }
  }

  const tempFolder = getTempVideoFolder(tempRoot)
  let entries
  try {
    entries = await fs.promises.readdir(tempFolder, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { deletedCount: 0, failedCount: 0, retainedCount: 0, retainedBytes: 0, canAllocate: true }
    }
    console.error('Failed to inspect temporary video folder', error)
    return { deletedCount: 0, failedCount: 1, retainedCount: 0, retainedBytes: 0, canAllocate: false }
  }

  let deletedCount = 0
  let failedCount = 0
  const retained = []
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }

    const filePath = path.join(tempFolder, entry.name)
    try {
      const stat = await fs.promises.stat(filePath)
      if (now - stat.mtimeMs < retentionMs) {
        retained.push({ filePath, mtimeMs: Number(stat.mtimeMs || 0), size: Math.max(0, Number(stat.size || 0)) })
        continue
      }
      await fs.promises.unlink(filePath)
      deletedCount += 1
    } catch (error) {
      failedCount += 1
      console.error(`Failed to clean temporary video file: ${filePath}`, error)
    }
  }

  retained.sort((left, right) => left.mtimeMs - right.mtimeMs)
  let retainedBytes = retained.reduce((total, file) => total + file.size, 0)
  let retainedCount = retained.length
  while (retainedCount + reserveFiles > maxFiles || retainedBytes + reserveBytes > maxBytes) {
    const oldest = retained.shift()
    if (!oldest) break
    try {
      await fs.promises.unlink(oldest.filePath)
      deletedCount += 1
      retainedCount -= 1
      retainedBytes -= oldest.size
    } catch (error) {
      failedCount += 1
      console.error(`Failed to clean temporary video file: ${oldest.filePath}`, error)
    }
  }

  return {
    deletedCount,
    failedCount,
    retainedCount,
    retainedBytes,
    canAllocate: retainedCount + reserveFiles <= maxFiles && retainedBytes + reserveBytes <= maxBytes
  }
}

export {
  MAX_TEMP_VIDEO_BYTES,
  MAX_TEMP_VIDEO_FILES,
  TEMP_VIDEO_RETENTION_MS,
  cleanupExpiredTempVideos,
  getTempVideoFolder
}
