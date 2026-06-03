import moment from 'moment'
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
  const timestampTime = moment(timestamp)
  const days =
    Number.parseInt(moment().format('YYYYMMDD')) - Number.parseInt(timestampTime.format('YYYYMMDD'))
  if (days == 0) {
    return timestampTime.format('HH:mm')
  } else if (days == 1) {
    return '昨天'
  } else if (days >= 2 && days < 7) {
    return timestampTime.format('dddd')
  } else if (days > 7) {
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
  return `${(size / 1024 / 1024).toFixed(1)} MB`
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
    return '上传中'
  }
  if (message?.status == 0) {
    return '上传失败'
  }
  return '未下载'
}

export default {
  isEmpty,
  getAreaInfo,
  formData,
  formatFileSize,
  getFileMessageName,
  getFileMessageStatusText,
  isFileMessage,
  isFileReceiveDisabled,
  isImageMessage,
  isVideoMessage,
  isVideoPreviewDisabled,
  isSelfMessage
}
