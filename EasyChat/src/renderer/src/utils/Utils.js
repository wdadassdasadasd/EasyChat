import dayjs from 'dayjs'
const isEmpty = (str) => {
  if (str === null || str === '' || str === undefined) {
    return true
  }
  return false
}

const getAreaInfo = (data) => {
  if (isEmpty(data)) {
    return ''
  }
  return data
}

const formData = (timestamp) => {
  const timestampTime = dayjs(timestamp)
  const days =
    Number.parseInt(dayjs().format('YYYYMMDD')) - Number.parseInt(timestampTime.format('YYYYMMDD'))
  if (days == 0) {
    return timestampTime.format('HH:mm')
  } else if (days == 1) {
    return '昨天'
  } else if (days >= 2 && days < 7) {
    return timestampTime.format('dddd')
  } else {
    return timestampTime.format('YYYY/MM/DD')
  }
}

const formatFileSize = (size = 0, options = {}) => {
  const { emptyForZero = false } = options

  if (!size) {
    return emptyForZero ? '' : '0 B'
  }
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  if (size < 1024 * 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(1)} MB`
  }
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`
}

const isImageMessage = (message) => {
  return Number(message?.messageType) === 5 && Number(message?.fileType) === 0
}

const isFileMessage = (message) => {
  return Number(message?.messageType) === 5 && Number(message?.fileType) === 2
}

const isVideoMessage = (message) => {
  return Number(message?.messageType) === 5 && Number(message?.fileType) === 1
}

const isSelfMessage = (message, currentUserId) => {
  return message?.sendUserId == currentUserId
}

const getFileMessageName = (message) => {
  return message?.fileName || message?.messageContent || `file-${message?.messageId || ''}`
}

const isFileReceiveDisabled = (message) => {
  return !isFileMessage(message) || message?.status == 0 || message?.uploading
}

const isVideoPreviewDisabled = (message) => {
  return !isVideoMessage(message) || message?.status == 0 || message?.uploading
}

const getFileMessageStatusText = (message) => {
  if (message?.uploading) {
    const progress = Number(message.uploadProgress || 0)
    return progress > 0 ? `上传中 ${progress}%` : '上传中'
  }
  if (message?.status == 0) {
    return message?.uploadCanceled ? '已取消' : '上传失败'
  }
  if (message?.downloadStatus === 'downloading') {
    return `下载中 ${Number(message.downloadProgress || 0)}%`
  }
  if (message?.downloadStatus === 'done') {
    return '已下载'
  }
  if (message?.downloadStatus === 'failed') {
    return '下载失败'
  }
  return '未下载'
}

const getVideoMimeType = (fileName = '') => {
  const suffix = String(fileName).split('.').pop()?.toLowerCase()
  const mimeMap = {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
    flv: 'video/x-flv',
    wmv: 'video/x-ms-wmv',
    ogg: 'video/ogg',
    ogv: 'video/ogg',
    '3gp': 'video/3gpp',
    m4v: 'video/x-m4v',
    rmvb: 'application/vnd.rn-realmedia-vbr'
  }
  return mimeMap[suffix] || 'application/octet-stream'
}

export default {
  isEmpty,
  getAreaInfo,
  formData,
  formatFileSize,
  getFileMessageName,
  getFileMessageStatusText,
  getVideoMimeType,
  isFileMessage,
  isFileReceiveDisabled,
  isImageMessage,
  isVideoMessage,
  isVideoPreviewDisabled,
  isSelfMessage
}
