import { describe, expect, it } from 'vitest'

import {
  getSendFailureMessage,
  getUploadFailureMessage,
  isRequestFailure
} from '@/utils/RequestFailure'

describe('request failure helpers', () => {
  it('recognizes only structured failed results', () => {
    expect(isRequestFailure({ success: false })).toBe(true)
    expect(isRequestFailure({ success: true })).toBe(false)
    expect(isRequestFailure(null)).toBe(false)
  })

  it('maps send failures to actionable messages', () => {
    expect(getSendFailureMessage({ success: false, kind: 'timeout' })).toContain('发送超时')
    expect(getSendFailureMessage({ success: false, kind: 'api_code', msg: '服务端拒绝' })).toBe(
      '服务端拒绝'
    )
  })

  it('maps upload cancellation and timeout separately', () => {
    expect(getUploadFailureMessage({ kind: 'canceled' })).toContain('已取消')
    expect(getUploadFailureMessage({ kind: 'timeout' })).toContain('上传超时')
  })
})
