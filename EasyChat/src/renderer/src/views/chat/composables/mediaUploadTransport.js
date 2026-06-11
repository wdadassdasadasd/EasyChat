import { CHAT_CONSTANTS } from '@/utils/ChatConstants'

// 分片上传超时按带宽 100KB/s 计算，最少 2 分钟
const chunkUploadTimeout = Math.max(
  120000,
  (CHAT_CONSTANTS.UPLOAD_CHUNK_SIZE / (100 * 1024)) * 1000
)
const uploadHandshakeTimeout = 30000

const isRequestFailure = (result) => {
  return result && result.success === false
}

const normalizeUploadedChunks = (value) => {
  if (!Array.isArray(value)) {
    return new Set()
  }
  return new Set(value.map((item) => Number(item)).filter((item) => Number.isFinite(item)))
}

const reportProgress = (callback, percent) => {
  callback?.(Math.min(99, Math.max(0, Math.round(percent))))
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
  if (!file || !message?.messageId) {
    return null
  }

  const fileSize = Number(file.size || 0)

  const uploadWithLegacyEndpoint = async () => {
    return await proxy.Request({
      url: proxy.Api.uploadFile,
      params: {
        messageId: message.messageId,
        file,
        cover
      },
      uploadProgressCallback: (event) => {
        if (!event?.total) {
          return
        }
        reportProgress(onProgress, (event.loaded / event.total) * 100)
      },
      showLoading: false,
      signal,
      returnError: true,
      timeout: chunkUploadTimeout
    })
  }

  if (fileSize < CHAT_CONSTANTS.CHUNK_UPLOAD_THRESHOLD) {
    return await uploadWithLegacyEndpoint()
  }

  const configuredChunkSize = CHAT_CONSTANTS.UPLOAD_CHUNK_SIZE
  const totalChunks = Math.max(1, Math.ceil(fileSize / configuredChunkSize))
  const initResult = await proxy.Request({
    url: proxy.Api.uploadFileInit,
    params: {
      messageId: message.messageId,
      fileName: file.name,
      fileSize,
      fileType,
      totalChunks,
      chunkSize: configuredChunkSize
    },
    showLoading: false,
    showError: false,
    signal,
    returnError: true,
    timeout: uploadHandshakeTimeout
  })

  if (!initResult || (isRequestFailure(initResult) && initResult.kind !== 'canceled')) {
    // 兼容尚未升级/重启的后端：新分片入口不可用时退回旧上传接口。
    return await uploadWithLegacyEndpoint()
  }
  if (isRequestFailure(initResult)) {
    return initResult
  }

  const uploadId = initResult.data?.uploadId
  const chunkSize = Number(initResult.data?.chunkSize || configuredChunkSize)
  const uploadedChunks = normalizeUploadedChunks(initResult.data?.uploadedChunks)
  const completed = Boolean(initResult.data?.completed)
  if (!uploadId) {
    return null
  }
  if (completed) {
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
    if (signal?.aborted) {
      return null
    }
    if (uploadedChunks.has(chunkIndex)) {
      continue
    }
    const start = chunkIndex * chunkSize
    const end = Math.min(fileSize, start + chunkSize)
    const chunk = file.slice(start, end)
    let currentChunkLoaded = 0

    const chunkResult = await proxy.Request({
      url: proxy.Api.uploadFileChunk,
      params: {
        uploadId,
        messageId: message.messageId,
        chunkIndex,
        totalChunks,
        chunk
      },
      uploadProgressCallback: (event) => {
        currentChunkLoaded = Number(event?.loaded || 0)
        reportProgress(onProgress, ((uploadedBytes + currentChunkLoaded) / fileSize) * 100)
      },
      showLoading: false,
      signal,
      returnError: true,
      timeout: chunkUploadTimeout
    })

    if (!chunkResult || isRequestFailure(chunkResult)) {
      return chunkResult || null
    }
    uploadedBytes += chunk.size
    uploadedChunks.add(chunkIndex)
    reportProgress(onProgress, (uploadedBytes / fileSize) * 100)
  }

  return await proxy.Request({
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
    signal,
    returnError: true,
    timeout: uploadHandshakeTimeout
  })
}

export const cancelMediaUpload = async ({ messageId, proxy, uploadId }) => {
  if (!messageId) {
    return null
  }
  return await proxy.Request({
    url: proxy.Api.uploadFileCancel,
    params: {
      messageId,
      uploadId
    },
    showLoading: false,
    showError: false,
    returnError: true,
    timeout: chunkUploadTimeout
  })
}
