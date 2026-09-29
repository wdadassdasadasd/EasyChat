import { describe, expect, it, vi } from 'vitest'
import { checkAvailableVersion } from '../../../../src/renderer/src/views/setting/aboutVersion.js'

describe('checkAvailableVersion', () => {
  it('returns latest for an empty update payload', async () => {
    const request = vi.fn().mockResolvedValue({ data: null })

    await expect(checkAvailableVersion({
      request,
      url: '/update/checkVersion',
      appVersion: '1.0.0',
      userId: 'U1001'
    })).resolves.toEqual({ kind: 'latest' })
    expect(request).toHaveBeenCalledWith({
      url: '/update/checkVersion',
      showError: false,
      params: { appVersion: '1.0.0', uid: 'U1001' }
    })
  })

  it('returns update details when a version is available', async () => {
    const update = { version: '1.1.0' }
    const request = vi.fn().mockResolvedValue({ data: update })

    await expect(checkAvailableVersion({
      request,
      url: '/update/checkVersion',
      appVersion: '1.0.0'
    })).resolves.toEqual({ kind: 'available', update })
  })

  it('reports transport and request failures', async () => {
    await expect(checkAvailableVersion({
      request: vi.fn().mockResolvedValue(undefined),
      url: '/update/checkVersion',
      appVersion: '1.0.0'
    })).resolves.toEqual({ kind: 'failed' })

    const failed = await checkAvailableVersion({
      request: vi.fn().mockRejectedValue(new Error('offline')),
      url: '/update/checkVersion',
      appVersion: '1.0.0'
    })
    expect(failed.kind).toBe('failed')
  })
})
