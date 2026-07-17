const createFallbackCover = () => new Blob(['cover'], { type: 'text/plain' })

/**
 * Creates renderer-only media covers. It owns temporary object URLs created
 * during canvas/video processing and always releases them before resolving.
 */
export const createMediaCoverFactory = ({
  api = typeof window === 'undefined' ? undefined : window.api,
  documentRef = typeof document === 'undefined' ? null : document,
  ImageConstructor = typeof Image === 'undefined' ? null : Image,
  url = typeof URL === 'undefined' ? null : URL
} = {}) => {
  const createFileCover = () => {
    if (!documentRef?.createElement) return Promise.resolve(createFallbackCover())

    return new Promise((resolve) => {
      const canvas = documentRef.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const context = canvas.getContext('2d')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, 1, 1)
      canvas.toBlob((blob) => resolve(blob || createFallbackCover()), 'image/png')
    })
  }

  const createImageCover = (file) => {
    if (!documentRef?.createElement || !ImageConstructor || !url?.createObjectURL) {
      return Promise.resolve(file)
    }

    const coverTimeoutMs = 3000
    return new Promise((resolve) => {
      const image = new ImageConstructor()
      const objectUrl = url.createObjectURL(file)
      let settled = false

      const done = (result) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        url.revokeObjectURL(objectUrl)
        resolve(result)
      }
      const timeout = setTimeout(() => done(file), coverTimeoutMs)

      image.onload = () => {
        const maxSize = 240
        const ratio = Math.min(maxSize / image.width, maxSize / image.height, 1)
        const canvas = documentRef.createElement('canvas')
        canvas.width = Math.round(image.width * ratio)
        canvas.height = Math.round(image.height * ratio)
        const context = canvas.getContext('2d')
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((blob) => done(blob || file), 'image/jpeg', 0.8)
      }
      image.onerror = () => done(file)
      image.src = objectUrl
    })
  }

  const createVideoCoverWithFfmpeg = async (uploadSourceId) => {
    if (!uploadSourceId) return null
    const request = api?.invokeGenerateUploadSourceThumbnail?.({ uploadSourceId })
    const result = await Promise.resolve(request).catch(() => null)
    return result?.success && result.arrayBuffer
      ? new Blob([result.arrayBuffer], { type: 'image/jpeg' })
      : null
  }

  const createVideoCover = async (file, uploadSourceId) => {
    const ffmpegCover = await createVideoCoverWithFfmpeg(uploadSourceId)
    if (ffmpegCover) return ffmpegCover
    if (!documentRef?.createElement || !url?.createObjectURL) return createFileCover()

    const coverTimeoutMs = 5000
    return new Promise((resolve) => {
      const video = documentRef.createElement('video')
      const objectUrl = url.createObjectURL(file)
      let settled = false

      const cleanup = () => {
        if (settled) return false
        settled = true
        clearTimeout(timeout)
        video.pause?.()
        video.removeAttribute?.('src')
        video.load?.()
        url.revokeObjectURL(objectUrl)
        return true
      }
      const fallback = async () => {
        if (!cleanup()) return
        resolve(await createFileCover())
      }
      const timeout = setTimeout(fallback, coverTimeoutMs)

      video.preload = 'metadata'
      video.muted = true
      video.playsInline = true
      video.onloadedmetadata = () => {
        video.currentTime = Math.min(1, Math.max(0, (video.duration || 0) / 4))
      }
      video.onseeked = () => {
        if (!cleanup()) return
        const maxSize = 360
        const width = video.videoWidth || 16
        const height = video.videoHeight || 9
        const ratio = Math.min(maxSize / width, maxSize / height, 1)
        const canvas = documentRef.createElement('canvas')
        canvas.width = Math.round(width * ratio)
        canvas.height = Math.round(height * ratio)
        const context = canvas.getContext('2d')
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((blob) => resolve(blob || file), 'image/jpeg', 0.82)
      }
      video.onerror = fallback
      video.src = objectUrl
    })
  }

  return {
    createFileCover,
    createImageCover,
    createVideoCover,
    createVideoCoverWithFfmpeg
  }
}
