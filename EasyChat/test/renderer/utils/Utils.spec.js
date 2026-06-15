import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockDayjs = vi.fn()

vi.mock('dayjs', () => ({
  default: mockDayjs
}))

let Utils

beforeEach(async () => {
  vi.clearAllMocks()
  Utils = (await import('@/utils/Utils')).default
})

describe('isEmpty', () => {
  it('returns true for null, empty string, undefined', () => {
    expect(Utils.isEmpty(null)).toBe(true)
    expect(Utils.isEmpty('')).toBe(true)
    expect(Utils.isEmpty(undefined)).toBe(true)
  })

  it('returns false for non-empty string and numbers', () => {
    expect(Utils.isEmpty(' ')).toBe(false)
    expect(Utils.isEmpty('hello')).toBe(false)
    expect(Utils.isEmpty(0)).toBe(false)
  })
})

describe('getAreaInfo', () => {
  it('returns empty string for empty data', () => {
    expect(Utils.getAreaInfo(null)).toBe('')
    expect(Utils.getAreaInfo('')).toBe('')
  })

  it('returns the data itself for non-empty', () => {
    expect(Utils.getAreaInfo('Beijing')).toBe('Beijing')
  })
})

describe('formData', () => {
  it('returns HH:mm for today', () => {
    const ts = 1700000000000
    const m = vi.fn((fmt) => {
      if (fmt === 'YYYYMMDD') return '20231115'
      if (fmt === 'HH:mm') return '10:30'
      return ''
    })
    mockDayjs.mockImplementation((t) => {
      if (t === undefined) return { format: () => '20231115' }
      return { format: m }
    })
    expect(Utils.formData(ts)).toBe('10:30')
  })

  it('returns 昨天 for yesterday', () => {
    const ts = 1699900000000
    const m = vi.fn((fmt) => {
      if (fmt === 'YYYYMMDD') return '20231114'
      if (fmt === 'HH:mm') return '08:00'
      return ''
    })
    mockDayjs.mockImplementation((t) => {
      if (t === undefined) return { format: () => '20231115' }
      return { format: m }
    })
    expect(Utils.formData(ts)).toBe('昨天')
  })

  it('returns weekday name for 2-6 days ago', () => {
    const ts = 1699800000000
    const m = vi.fn((fmt) => {
      if (fmt === 'YYYYMMDD') return '20231112'
      if (fmt === 'dddd') return 'Sunday'
      return ''
    })
    mockDayjs.mockImplementation((t) => {
      if (t === undefined) return { format: () => '20231115' }
      return { format: m }
    })
    expect(Utils.formData(ts)).toBe('Sunday')
  })

  it('returns YYYY/MM/DD for older than 7 days', () => {
    const ts = 1699000000000
    const m = vi.fn((fmt) => {
      if (fmt === 'YYYYMMDD') return '20231103'
      if (fmt === 'YYYY/MM/DD') return '2023/11/03'
      return ''
    })
    mockDayjs.mockImplementation((t) => {
      if (t === undefined) return { format: () => '20231115' }
      return { format: m }
    })
    expect(Utils.formData(ts)).toBe('2023/11/03')
  })
})

describe('formatFileSize', () => {
  it('returns 0 B for 0 size', () => {
    expect(Utils.formatFileSize(0)).toBe('0 B')
  })

  it('returns empty string for 0 with emptyForZero=true', () => {
    expect(Utils.formatFileSize(0, { emptyForZero: true })).toBe('')
  })

  it('returns bytes for sizes under 1KB', () => {
    expect(Utils.formatFileSize(512)).toBe('512 B')
    expect(Utils.formatFileSize(1023)).toBe('1023 B')
  })

  it('returns KB for sizes under 1MB', () => {
    expect(Utils.formatFileSize(1024)).toBe('1.0 KB')
    expect(Utils.formatFileSize(1536)).toBe('1.5 KB')
    expect(Utils.formatFileSize(1024 * 1024 - 1)).toBe('1024.0 KB')
  })

  it('returns MB for sizes under 1GB', () => {
    expect(Utils.formatFileSize(1024 * 1024)).toBe('1.0 MB')
    expect(Utils.formatFileSize(20 * 1024 * 1024)).toBe('20.0 MB')
  })

  it('returns GB for sizes 1GB and above', () => {
    expect(Utils.formatFileSize(1024 * 1024 * 1024)).toBe('1.0 GB')
    expect(Utils.formatFileSize(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB')
  })
})

describe('message type detection', () => {
  it('isImageMessage detects image messages', () => {
    expect(Utils.isImageMessage({ messageType: 5, fileType: 0 })).toBe(true)
    expect(Utils.isImageMessage({ messageType: '5', fileType: '0' })).toBe(true)
    expect(Utils.isImageMessage({ messageType: 5, fileType: 1 })).toBe(false)
    expect(Utils.isImageMessage({ messageType: 1, fileType: 0 })).toBe(false)
    expect(Utils.isImageMessage(null)).toBe(false)
  })

  it('isFileMessage detects file messages', () => {
    expect(Utils.isFileMessage({ messageType: 5, fileType: 2 })).toBe(true)
    expect(Utils.isFileMessage({ messageType: '5', fileType: '2' })).toBe(true)
    expect(Utils.isFileMessage({ messageType: 5, fileType: 0 })).toBe(false)
  })

  it('isVideoMessage detects video messages', () => {
    expect(Utils.isVideoMessage({ messageType: 5, fileType: 1 })).toBe(true)
    expect(Utils.isVideoMessage({ messageType: '5', fileType: '1' })).toBe(true)
    expect(Utils.isVideoMessage({ messageType: 1, fileType: 1 })).toBe(false)
  })

  it('isSelfMessage checks sendUserId', () => {
    expect(Utils.isSelfMessage({ sendUserId: '123' }, '123')).toBe(true)
    expect(Utils.isSelfMessage({ sendUserId: 123 }, '123')).toBe(true)
    expect(Utils.isSelfMessage({ sendUserId: '456' }, '123')).toBe(false)
    expect(Utils.isSelfMessage(null, '123')).toBe(false)
  })
})

describe('getFileMessageName', () => {
  it('returns fileName if present', () => {
    expect(Utils.getFileMessageName({ fileName: 'doc.pdf', messageContent: 'fallback' })).toBe(
      'doc.pdf'
    )
  })

  it('falls back to messageContent', () => {
    expect(Utils.getFileMessageName({ messageContent: 'hello.txt' })).toBe('hello.txt')
  })

  it('falls back to file-{messageId}', () => {
    expect(Utils.getFileMessageName({ messageId: 'abc123' })).toBe('file-abc123')
  })

  it('handles null message', () => {
    expect(Utils.getFileMessageName(null)).toBe('file-')
  })
})

describe('isFileReceiveDisabled', () => {
  it('disabled for non-file messages', () => {
    expect(Utils.isFileReceiveDisabled({ messageType: 1, fileType: 0 })).toBe(true)
  })

  it('disabled when status is 0 (failed)', () => {
    expect(Utils.isFileReceiveDisabled({ messageType: 5, fileType: 2, status: 0 })).toBe(true)
  })

  it('disabled when uploading', () => {
    expect(
      Utils.isFileReceiveDisabled({ messageType: 5, fileType: 2, status: 1, uploading: true })
    ).toBe(true)
  })

  it('enabled for successful file message', () => {
    expect(Utils.isFileReceiveDisabled({ messageType: 5, fileType: 2, status: 1 })).toBeFalsy()
  })
})

describe('isVideoPreviewDisabled', () => {
  it('disabled for non-video messages', () => {
    expect(Utils.isVideoPreviewDisabled({ messageType: 1, fileType: 1 })).toBe(true)
  })

  it('disabled when status is 0', () => {
    expect(Utils.isVideoPreviewDisabled({ messageType: 5, fileType: 1, status: 0 })).toBe(true)
  })

  it('enabled for successful video message', () => {
    expect(Utils.isVideoPreviewDisabled({ messageType: 5, fileType: 1, status: 1 })).toBeFalsy()
  })
})

describe('getFileMessageStatusText', () => {
  it('shows uploading with progress', () => {
    expect(Utils.getFileMessageStatusText({ uploading: true, uploadProgress: 50 })).toBe(
      '上传中 50%'
    )
  })

  it('shows uploading without progress', () => {
    expect(Utils.getFileMessageStatusText({ uploading: true, uploadProgress: 0 })).toBe('上传中')
  })

  it('shows cancelled', () => {
    expect(Utils.getFileMessageStatusText({ status: 0, uploadCanceled: true })).toBe('已取消')
  })

  it('shows upload failed', () => {
    expect(Utils.getFileMessageStatusText({ status: 0 })).toBe('上传失败')
  })

  it('shows downloading with progress', () => {
    expect(
      Utils.getFileMessageStatusText({
        status: 1,
        downloadStatus: 'downloading',
        downloadProgress: 75
      })
    ).toBe('下载中 75%')
  })

  it('shows downloaded', () => {
    expect(Utils.getFileMessageStatusText({ status: 1, downloadStatus: 'done' })).toBe('已下载')
  })

  it('shows download failed', () => {
    expect(Utils.getFileMessageStatusText({ status: 1, downloadStatus: 'failed' })).toBe('下载失败')
  })

  it('shows not downloaded by default', () => {
    expect(Utils.getFileMessageStatusText({ status: 1 })).toBe('未下载')
  })
})

describe('getVideoMimeType', () => {
  it('maps known extensions to mime types', () => {
    expect(Utils.getVideoMimeType('video.mp4')).toBe('video/mp4')
    expect(Utils.getVideoMimeType('video.mov')).toBe('video/quicktime')
    expect(Utils.getVideoMimeType('video.webm')).toBe('video/webm')
    expect(Utils.getVideoMimeType('video.mkv')).toBe('video/x-matroska')
    expect(Utils.getVideoMimeType('video.avi')).toBe('video/x-msvideo')
  })

  it('returns application/octet-stream for unknown extensions', () => {
    expect(Utils.getVideoMimeType('video.xyz')).toBe('application/octet-stream')
  })

  it('handles empty filename', () => {
    expect(Utils.getVideoMimeType('')).toBe('application/octet-stream')
  })
})
