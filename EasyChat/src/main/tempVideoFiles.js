import fs from 'fs'
import path from 'path'

const TEMP_VIDEO_RETENTION_MS = 24 * 60 * 60 * 1000

const getTempVideoFolder = (tempRoot) => {
  return path.join(tempRoot, 'EasyChat', 'video-preview')
}

const cleanupExpiredTempVideos = async ({
  tempRoot,
  now = Date.now(),
  retentionMs = TEMP_VIDEO_RETENTION_MS
} = {}) => {
  if (!tempRoot) {
    return { deletedCount: 0, failedCount: 0 }
  }

  const tempFolder = getTempVideoFolder(tempRoot)
  let entries
  try {
    entries = await fs.promises.readdir(tempFolder, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { deletedCount: 0, failedCount: 0 }
    }
    console.error('Failed to inspect temporary video folder', error)
    return { deletedCount: 0, failedCount: 1 }
  }

  let deletedCount = 0
  let failedCount = 0
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }

    const filePath = path.join(tempFolder, entry.name)
    try {
      const stat = await fs.promises.stat(filePath)
      if (now - stat.mtimeMs < retentionMs) {
        continue
      }
      await fs.promises.unlink(filePath)
      deletedCount += 1
    } catch (error) {
      failedCount += 1
      console.error(`Failed to clean temporary video file: ${filePath}`, error)
    }
  }

  return { deletedCount, failedCount }
}

export { TEMP_VIDEO_RETENTION_MS, cleanupExpiredTempVideos, getTempVideoFolder }
