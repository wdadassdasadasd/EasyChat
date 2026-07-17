import { describe, expect, it, vi } from 'vitest'
import { usePendingMediaDrafts } from '@/views/chat/composables/composer/usePendingMediaDrafts'

const createFile = (name, type) => ({ name, size: 12, type })

const createDrafts = () => {
  const api = {
    invokeReleaseUploadSource: vi.fn(async () => ({ success: true })),
    registerUploadSource: vi.fn(async () => ({ uploadSourceId: 'video-source' }))
  }
  const url = {
    createObjectURL: vi.fn((file) => `blob:${file.name}`),
    revokeObjectURL: vi.fn()
  }
  const coverFactory = {
    createFileCover: vi.fn(async () => new Blob(['file'])),
    createImageCover: vi.fn(async () => new Blob(['image'])),
    createVideoCover: vi.fn(async () => new Blob(['video']))
  }
  const notify = { warning: vi.fn() }
  return {
    api,
    coverFactory,
    drafts: usePendingMediaDrafts({ api, coverFactory, notify, url }),
    notify,
    url
  }
}

describe('usePendingMediaDrafts', () => {
  it('keeps image, video and file drafts in selection order', async () => {
    const { drafts } = createDrafts()

    await drafts.addPendingMedia(createFile('image.png', 'image/png'))
    await drafts.addPendingMedia(createFile('video.mp4', 'video/mp4'))
    await drafts.addPendingMedia(createFile('file.txt', 'text/plain'))

    expect(drafts.pendingMediaList.value.map((item) => item.mediaType)).toEqual([
      'image',
      'video',
      'file'
    ])
  })

  it('adds image drafts from drop and paste events', async () => {
    const { drafts } = createDrafts()
    const droppedImage = createFile('drop.png', 'image/png')
    const pastedImage = createFile('paste.png', 'image/png')
    const dropEvent = { dataTransfer: { files: [droppedImage] }, preventDefault: vi.fn() }
    const pasteEvent = {
      clipboardData: {
        items: [{ type: 'image/png', getAsFile: () => pastedImage }]
      },
      preventDefault: vi.fn()
    }

    await drafts.dropHandler(dropEvent)
    await drafts.pasteHandler(pasteEvent)

    expect(dropEvent.preventDefault).toHaveBeenCalled()
    expect(pasteEvent.preventDefault).toHaveBeenCalled()
    expect(drafts.pendingImageList.value.map((item) => item.name)).toEqual([
      'drop.png',
      'paste.png'
    ])
  })

  it('releases previews and unsubmitted video sources, but keeps sources after dispatch', async () => {
    const { api, drafts, url } = createDrafts()
    await drafts.addPendingMedia(createFile('image.png', 'image/png'))
    await drafts.addPendingMedia(createFile('remove.mp4', 'video/mp4'))

    drafts.removePendingImage(drafts.pendingImageList.value[0].id)
    drafts.removePendingFile(drafts.pendingFileList.value[0].id)
    expect(url.revokeObjectURL).toHaveBeenCalledWith('blob:image.png')
    expect(api.invokeReleaseUploadSource).toHaveBeenCalledWith({ uploadSourceId: 'video-source' })

    await drafts.addPendingMedia(createFile('send.mp4', 'video/mp4'))
    const dispatched = []
    drafts.dispatchPendingMedia((media) => dispatched.push(media.mediaType))
    drafts.cleanup()

    expect(dispatched).toEqual(['video'])
    expect(api.invokeReleaseUploadSource).toHaveBeenCalledTimes(1)
  })

  it('releases all unsent preview and upload resources during cleanup', async () => {
    const { api, drafts, url } = createDrafts()
    await drafts.addPendingMedia(createFile('image.png', 'image/png'))
    await drafts.addPendingMedia(createFile('video.mp4', 'video/mp4'))

    drafts.cleanup()

    expect(url.revokeObjectURL).toHaveBeenCalledWith('blob:image.png')
    expect(api.invokeReleaseUploadSource).toHaveBeenCalledWith({ uploadSourceId: 'video-source' })
  })
})
