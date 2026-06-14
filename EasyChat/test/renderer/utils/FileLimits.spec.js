import { describe, expect, it } from 'vitest'
import { getMediaKind, validateFileSize, isVideoFile } from '@/utils/FileLimits'

describe('getMediaKind', () => {
  it('returns image for fileType=0', () => {
    expect(getMediaKind({ name: 'photo.jpg' }, 0)).toBe('image')
  })

  it('returns image for image/ MIME type', () => {
    expect(getMediaKind({ type: 'image/png', name: 'x' }, undefined)).toBe('image')
    expect(getMediaKind({ type: 'image/jpeg', name: 'x' }, undefined)).toBe('image')
  })

  it('returns video for fileType=1', () => {
    expect(getMediaKind({ name: 'movie.mp4' }, 1)).toBe('video')
  })

  it('returns video for video/ MIME type', () => {
    expect(getMediaKind({ type: 'video/mp4', name: 'x' }, undefined)).toBe('video')
  })

  it('returns video for known video extensions', () => {
    const exts = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'flv', 'wmv', 'ogg', 'ogv', '3gp', 'm4v', 'rmvb']
    for (const ext of exts) {
      expect(getMediaKind({ name: `video.${ext}` }, undefined)).toBe('video')
    }
  })

  it('returns file for unknown types', () => {
    expect(getMediaKind({ name: 'doc.pdf' }, undefined)).toBe('file')
    expect(getMediaKind({ name: 'doc.pdf' }, 2)).toBe('file')
    expect(getMediaKind({ name: 'archive.zip' }, undefined)).toBe('file')
  })

  it('handles file without name', () => {
    expect(getMediaKind({}, undefined)).toBe('file')
  })
})

describe('validateFileSize', () => {
  it('returns invalid for null file', () => {
    const result = validateFileSize(null, 0)
    expect(result.valid).toBe(false)
    expect(result.message).toBe('File is empty')
  })

  it('returns invalid for NaN size', () => {
    const result = validateFileSize({ size: 'abc' }, 0)
    expect(result.valid).toBe(false)
    expect(result.message).toBe('File size is invalid')
  })

  it('returns invalid for zero or negative size', () => {
    expect(validateFileSize({ size: 0 }, 0).valid).toBe(false)
    expect(validateFileSize({ size: -1 }, 0).valid).toBe(false)
  })

  it('returns valid for image under 20MB', () => {
    const result = validateFileSize({ size: 10 * 1024 * 1024 }, 0)
    expect(result.valid).toBe(true)
    expect(result.kind).toBe('image')
  })

  it('returns invalid for image over 20MB', () => {
    const result = validateFileSize({ size: 25 * 1024 * 1024 }, 0)
    expect(result.valid).toBe(false)
    expect(result.kind).toBe('image')
  })

  it('returns valid for video under 2GB', () => {
    const result = validateFileSize({ size: 1024 * 1024 * 1024 }, 1)
    expect(result.valid).toBe(true)
    expect(result.kind).toBe('video')
  })

  it('returns invalid for video over 2GB', () => {
    const result = validateFileSize({ size: 3 * 1024 * 1024 * 1024 }, 1)
    expect(result.valid).toBe(false)
  })

  it('returns valid for file under 2GB', () => {
    const result = validateFileSize({ size: 500 * 1024 * 1024 }, 2)
    expect(result.valid).toBe(true)
    expect(result.kind).toBe('file')
  })

  it('detects video by extension when fileType not specified', () => {
    const result = validateFileSize({ name: 'video.mp4', size: 1024 }, undefined)
    expect(result.valid).toBe(true)
    expect(result.kind).toBe('video')
  })
})

describe('isVideoFile', () => {
  it('returns true for video files', () => {
    expect(isVideoFile({ name: 'movie.mp4' })).toBe(true)
    expect(isVideoFile({ type: 'video/mp4' })).toBe(true)
  })

  it('returns false for non-video files', () => {
    // image MIME overrides fileType=1 in getMediaKind (first if branch)
    expect(isVideoFile({ type: 'image/png' })).toBe(false)
  })
})
