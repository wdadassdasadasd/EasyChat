const MAX_UPLOAD_COVER_BYTES = 5 * 1024 * 1024
const UPLOAD_CHUNK_SIZE = 4 * 1024 * 1024
const CHUNK_UPLOAD_THRESHOLD = 8 * 1024 * 1024
const MIN_UPLOAD_RATE_BYTES_PER_SECOND = 100 * 1024
const UPLOAD_REQUEST_OVERHEAD_MS = 30 * 1000
const UPLOAD_CONTROL_REQUEST_TIMEOUT_MS = 30 * 1000
const MIN_UPLOAD_CHUNK_TIMEOUT_MS = 2 * 60 * 1000
const MIN_UPLOAD_COMPLETE_TIMEOUT_MS = 2 * 60 * 1000
const MAX_UPLOAD_REQUEST_TIMEOUT_MS = 10 * 60 * 1000
const UPLOAD_COMPLETE_PROCESSING_BYTES_PER_SECOND = 10 * 1024 * 1024
const UPLOAD_RETRY_DELAYS = Object.freeze([0, 1000, 3000])

const clampUploadTimeout = (timeout, minimum) =>
  Math.min(MAX_UPLOAD_REQUEST_TIMEOUT_MS, Math.max(minimum, Math.ceil(timeout)))

const getUploadChunkTimeout = (chunkSize = UPLOAD_CHUNK_SIZE) => {
  const bytes = Math.max(0, Number(chunkSize) || 0)
  return clampUploadTimeout(
    (bytes / MIN_UPLOAD_RATE_BYTES_PER_SECOND) * 1000 + UPLOAD_REQUEST_OVERHEAD_MS,
    MIN_UPLOAD_CHUNK_TIMEOUT_MS
  )
}

const getUploadCompleteTimeout = (fileSize) => {
  const bytes = Math.max(0, Number(fileSize) || 0)
  return clampUploadTimeout(
    (bytes / UPLOAD_COMPLETE_PROCESSING_BYTES_PER_SECOND) * 1000 + UPLOAD_REQUEST_OVERHEAD_MS,
    MIN_UPLOAD_COMPLETE_TIMEOUT_MS
  )
}

export {
  CHUNK_UPLOAD_THRESHOLD,
  MAX_UPLOAD_COVER_BYTES,
  MIN_UPLOAD_CHUNK_TIMEOUT_MS,
  UPLOAD_CHUNK_SIZE,
  UPLOAD_CONTROL_REQUEST_TIMEOUT_MS,
  UPLOAD_RETRY_DELAYS,
  getUploadChunkTimeout,
  getUploadCompleteTimeout
}
