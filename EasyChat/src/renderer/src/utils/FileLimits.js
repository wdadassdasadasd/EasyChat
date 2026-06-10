import { CHAT_CONSTANTS } from '@/utils/ChatConstants'
import Utils from '@/utils/Utils'

const VIDEO_EXT_RE = /\.(mp4|mov|webm|mkv|avi|flv|wmv|ogg|ogv|3gp|m4v|rmvb)$/i

export const getMediaKind = (file, fileType) => {
  if (fileType === 0 || file?.type?.startsWith('image/')) {
    return 'image'
  }
  if (fileType === 1 || file?.type?.startsWith('video/') || VIDEO_EXT_RE.test(file?.name || '')) {
    return 'video'
  }
  return 'file'
}

export const getFileLimit = (file, fileType) => {
  const kind = getMediaKind(file, fileType)
  return CHAT_CONSTANTS.FILE_LIMITS[kind] || CHAT_CONSTANTS.FILE_LIMITS.file
}

export const validateFileSize = (file, fileType) => {
  if (!file) {
    return { valid: false, message: 'File is empty' }
  }
  // L-13: Number(undefined) → NaN，NaN > limit → false（静默通过）；显式校验 size 有效
  const fileSize = Number(file.size)
  if (Number.isNaN(fileSize) || fileSize <= 0) {
    return { valid: false, message: 'File size is invalid' }
  }
  const kind = getMediaKind(file, fileType)
  const limit = getFileLimit(file, fileType)
  if (fileSize > limit) {
    const labels = {
      image: 'Image',
      video: 'Video',
      file: 'File'
    }
    return {
      valid: false,
      kind,
      limit,
      message: `${labels[kind]} is too large. Limit: ${Utils.formatFileSize(limit)}`
    }
  }
  return { valid: true, kind, limit }
}

export const isVideoFile = (file) => {
  return getMediaKind(file, 1) === 'video'
}
