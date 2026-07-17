import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMediaCoverFactory } from '@/views/chat/composables/composer/mediaCoverFactory'

const createBrowserFallbackFixture = () => {
  const video = {
    duration: 4,
    load: vi.fn(),
    pause: vi.fn(),
    removeAttribute: vi.fn(),
    videoHeight: 90,
    videoWidth: 160
  }
  const canvas = {
    getContext: () => ({ drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '' }),
    toBlob: (callback) => callback(new Blob(['cover'], { type: 'image/jpeg' }))
  }
  const documentRef = {
    createElement: vi.fn((tagName) => (tagName === 'video' ? video : canvas))
  }
  const url = {
    createObjectURL: vi.fn(() => 'blob:video'),
    revokeObjectURL: vi.fn()
  }
  return { documentRef, url, video }
}

afterEach(() => vi.useRealTimers())

describe('createMediaCoverFactory', () => {
  it('prefers the main-process video thumbnail when it is available', async () => {
    const factory = createMediaCoverFactory({
      api: {
        invokeGenerateUploadSourceThumbnail: async () => ({
          success: true,
          arrayBuffer: new Uint8Array([1, 2, 3]).buffer
        })
      },
      documentRef: null,
      ImageConstructor: null,
      url: {}
    })

    const cover = await factory.createVideoCover({ name: 'video.mp4', size: 3 }, 'source-1')

    expect(cover).toBeInstanceOf(Blob)
    expect(cover.type).toBe('image/jpeg')
  })

  it('falls back to a generic cover when a video thumbnail cannot be created', async () => {
    const factory = createMediaCoverFactory({
      api: {
        invokeGenerateUploadSourceThumbnail: async () => ({ success: false })
      },
      documentRef: null,
      ImageConstructor: null,
      url: {}
    })

    const cover = await factory.createVideoCover({ name: 'video.mp4', size: 3 }, 'source-1')

    expect(cover).toBeInstanceOf(Blob)
    expect(cover.type).toBe('text/plain')
  })

  it('falls back from a failed main-process thumbnail to the browser video path', async () => {
    const { documentRef, url, video } = createBrowserFallbackFixture()
    const factory = createMediaCoverFactory({
      api: { invokeGenerateUploadSourceThumbnail: () => ({ success: false }) },
      documentRef,
      ImageConstructor: null,
      url
    })

    const coverPromise = factory.createVideoCover({ name: 'video.mp4', size: 3 }, 'source-1')
    await vi.waitFor(() => expect(video.onloadedmetadata).toBeTypeOf('function'))
    video.onloadedmetadata()
    video.onseeked()
    const cover = await coverPromise

    expect(cover.type).toBe('image/jpeg')
    expect(url.revokeObjectURL).toHaveBeenCalledWith('blob:video')
  })

  it('cleans browser video resources when cover generation times out', async () => {
    vi.useFakeTimers()
    const { documentRef, url, video } = createBrowserFallbackFixture()
    const factory = createMediaCoverFactory({
      api: { invokeGenerateUploadSourceThumbnail: () => ({ success: false }) },
      documentRef,
      ImageConstructor: null,
      url
    })

    const coverPromise = factory.createVideoCover({ name: 'video.mp4', size: 3 }, 'source-1')
    await vi.advanceTimersByTimeAsync(5000)
    const cover = await coverPromise

    expect(cover.type).toBe('image/jpeg')
    expect(video.pause).toHaveBeenCalled()
    expect(url.revokeObjectURL).toHaveBeenCalledWith('blob:video')
  })
})
