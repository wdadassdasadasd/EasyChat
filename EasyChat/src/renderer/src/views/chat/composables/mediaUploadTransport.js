import { CHAT_CONSTANTS } from '@/utils/ChatConstants'

const MIN_TOTAL_UPLOAD_TIMEOUT = 30 * 60 * 1000
const MAX_TOTAL_UPLOAD_TIMEOUT = 6 * 60 * 60 * 1000
const uploadHandshakeTimeout = 30000
const chunkUploadTimeout = Math.max(
  120000,
  (CHAT_CONSTANTS.UPLOAD_CHUNK_SIZE / (100 * 1024)) * 1000
)

const isRequestFailure = (result) => result && result.success === false

const normalizeUploadedChunks = (value) => {
  if (!Array.isArray(value)) return new Set()
  return new Set(value.map(Number).filter(Number.isFinite))
}

const reportProgress = (callback, percent) => {
  callback?.(Math.min(99, Math.max(0, Math.round(percent))))
}

const getTotalUploadTimeout = (fileSize) => {
  const sizeBasedTimeout = (Number(fileSize || 0) / (100 * 1024)) * 1000 + 2 * 60 * 1000
  return Math.min(MAX_TOTAL_UPLOAD_TIMEOUT, Math.max(MIN_TOTAL_UPLOAD_TIMEOUT, sizeBasedTimeout))
}

const readUploadSlice = async (file, start, end) => {
  if (typeof file?.slice === 'function') {
    return file.slice(start, end)
  }
  if (!file?.uploadSourceId) {
    throw new Error('Upload source is unavailable')
  }
  const result = await window.api.invokeReadUploadSourceChunk({
    uploadSourceId: file.uploadSourceId,
    start,
    end
  })
  if (!result?.success || !result.arrayBuffer) {
    throw new Error(result?.error || 'Upload source could not be read')
  }
  return new Blob([result.arrayBuffer], { type: file.type || 'application/octet-stream' })
}

const readWholeUploadSource = async (file) => {
  if (typeof file?.slice === 'function') return file
  const parts = []
  for (let start = 0; start < Number(file.size || 0); start += CHAT_CONSTANTS.UPLOAD_CHUNK_SIZE) {
    parts.push(
      await readUploadSlice(
        file,
        start,
        Math.min(Number(file.size), start + CHAT_CONSTANTS.UPLOAD_CHUNK_SIZE)
      )
    )
  }
  const blob = new Blob(parts, { type: file.type || 'application/octet-stream' })
  if (typeof File === 'function') {
    return new File([blob], file.name, { type: blob.type })
  }
  Object.defineProperty(blob, 'name', { value: file.name, configurable: true })
  return blob
}

const shouldUseLegacyFallback = (result) => {
  if (!result) return true
  return result.kind === 'http_status' && [404, 405, 501].includes(Number(result.status))
}

export const uploadMediaFile = async ({
  cover,
  file,
  fileType,
  message,
  onProgress,
  proxy,
  signal
}) => {
  if (!file || !message?.messageId) return null

  const fileSize = Number(file.size || 0)
  const controller = new AbortController()
  let timedOut = false
  let uploadId = null
  const abortFromCaller = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abortFromCaller, { once: true })
  if (signal?.aborted) abortFromCaller()
  let totalTimeout
  const totalTimeoutResult = new Promise((resolve) => {
    totalTimeout = setTimeout(() => {
      timedOut = true
      controller.abort(new Error('File upload timed out'))
      resolve({ success: false, kind: 'timeout', msg: 'File upload timed out' })
    }, getTotalUploadTimeout(fileSize))
  })

  const request = (options) => proxy.Request({ ...options, signal: controller.signal })

  const uploadWithLegacyEndpoint = async () => {
    const uploadFile = await readWholeUploadSource(file)
    return await request({
      url: proxy.Api.uploadFile,
      params: { messageId: message.messageId, file: uploadFile, cover },
      uploadProgressCallback: (event) => {
        if (event?.total) reportProgress(onProgress, (event.loaded / event.total) * 100)
      },
      showLoading: false,
      returnError: true,
      timeout: chunkUploadTimeout
    })
  }

  const performUpload = async () => {
    try {
      let result
      if (fileSize < CHAT_CONSTANTS.CHUNK_UPLOAD_THRESHOLD) {
        result = await uploadWithLegacyEndpoint()
      } else {
        const configuredChunkSize = CHAT_CONSTANTS.UPLOAD_CHUNK_SIZE
        const configuredTotalChunks = Math.max(1, Math.ceil(fileSize / configuredChunkSize))
        const initResult = await request({
          url: proxy.Api.uploadFileInit,
          params: {
            messageId: message.messageId,
            fileName: file.name,
            fileSize,
            fileType,
            totalChunks: configuredTotalChunks,
            chunkSize: configuredChunkSize
          },
          showLoading: false,
          showError: false,
          returnError: true,
          timeout: uploadHandshakeTimeout
        })

        if (shouldUseLegacyFallback(initResult)) {
          result = await uploadWithLegacyEndpoint()
        } else if (isRequestFailure(initResult) || !initResult) {
          result = initResult || null
        } else {
          uploadId = initResult.data?.uploadId
          const chunkSize = Number(initResult.data?.chunkSize || configuredChunkSize)
          const totalChunks = Math.max(1, Math.ceil(fileSize / chunkSize))
          const uploadedChunks = normalizeUploadedChunks(initResult.data?.uploadedChunks)
          if (!uploadId) return null
          if (initResult.data?.completed) {
            reportProgress(onProgress, 100)
            return initResult
          }

          let uploadedBytes = 0
          uploadedChunks.forEach((chunkIndex) => {
            const start = chunkIndex * chunkSize
            uploadedBytes += Math.max(0, Math.min(chunkSize, fileSize - start))
          })
          reportProgress(onProgress, (uploadedBytes / fileSize) * 100)

          for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
            if (controller.signal.aborted) break
            if (uploadedChunks.has(chunkIndex)) continue
            const start = chunkIndex * chunkSize
            const end = Math.min(fileSize, start + chunkSize)
            const chunk = await readUploadSlice(file, start, end)
            const chunkResult = await request({
              url: proxy.Api.uploadFileChunk,
              params: { uploadId, messageId: message.messageId, chunkIndex, totalChunks, chunk },
              uploadProgressCallback: (event) => {
                reportProgress(
                  onProgress,
                  ((uploadedBytes + Number(event?.loaded || 0)) / fileSize) * 100
                )
              },
              showLoading: false,
              returnError: true,
              timeout: chunkUploadTimeout
            })
            if (!chunkResult || isRequestFailure(chunkResult)) {
              result = chunkResult || null
              break
            }
            uploadedBytes += chunk.size
            uploadedChunks.add(chunkIndex)
            reportProgress(onProgress, (uploadedBytes / fileSize) * 100)
          }

          if (result === undefined && !controller.signal.aborted) {
            result = await request({
              url: proxy.Api.uploadFileComplete,
              params: {
                uploadId,
                messageId: message.messageId,
                fileName: file.name,
                fileSize,
                fileType,
                totalChunks,
                cover
              },
              showLoading: false,
              returnError: true,
              timeout: uploadHandshakeTimeout
            })
          }
        }
      }
      if (timedOut) {
        return { success: false, kind: 'timeout', msg: 'File upload timed out' }
      }
      return result
    } catch (error) {
      if (timedOut) {
        return { success: false, kind: 'timeout', msg: 'File upload timed out' }
      }
      if (controller.signal.aborted) {
        return { success: false, kind: 'canceled', msg: 'File upload canceled' }
      }
      return { success: false, kind: 'upload_source_error', msg: error?.message || String(error) }
    }
  }

  try {
    return await Promise.race([performUpload(), totalTimeoutResult])
  } finally {
    clearTimeout(totalTimeout)
    signal?.removeEventListener('abort', abortFromCaller)
    if (timedOut) {
      proxy.Request({
        url: proxy.Api.uploadFileCancel,
        params: { messageId: message.messageId, uploadId },
        showLoading: false,
        showError: false,
        returnError: true,
        timeout: chunkUploadTimeout
      }).catch(() => {})
    }
  }
}

export const cancelMediaUpload = async ({ messageId, proxy, uploadId }) => {
  if (!messageId) return null
  return await proxy.Request({
    url: proxy.Api.uploadFileCancel,
    params: { messageId, uploadId },
    showLoading: false,
    showError: false,
    returnError: true,
    timeout: chunkUploadTimeout
  })
}

export { getTotalUploadTimeout, readUploadSlice }
