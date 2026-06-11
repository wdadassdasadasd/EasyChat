import { describe, expect, it } from 'vitest'
import Verify from '@/utils/Verify'

describe('checkPassword', () => {
  it('rejects passwords shorter than 8 characters', () => {
    expect(Verify.checkPassword('a1')).toBe(false)
    expect(Verify.checkPassword('abc1')).toBe(false)
    expect(Verify.checkPassword('abcde1')).toBe(false)
    // 7 chars = too short
    expect(Verify.checkPassword('abcdefg1')).toBe(true)
  })

  it('rejects passwords longer than 18 characters', () => {
    expect(Verify.checkPassword('abc1234567890123456')).toBe(false)
    expect(Verify.checkPassword('abc12345678901234567890')).toBe(false)
  })

  it('rejects passwords without digits', () => {
    expect(Verify.checkPassword('abcdefgh')).toBe(false)
    expect(Verify.checkPassword('ABCDEFGH')).toBe(false)
  })

  it('rejects passwords without letters', () => {
    expect(Verify.checkPassword('12345678')).toBe(false)
    expect(Verify.checkPassword('87654321')).toBe(false)
  })

  it('accepts valid passwords with letters and digits', () => {
    expect(Verify.checkPassword('abc12345')).toBe(true)
    expect(Verify.checkPassword('pass1234')).toBe(true)
    expect(Verify.checkPassword('MyPass12')).toBe(true)
  })

  it('accepts passwords with special characters', () => {
    expect(Verify.checkPassword('abc@1234')).toBe(true)
    expect(Verify.checkPassword('Test#2024')).toBe(true)
    expect(Verify.checkPassword('p@ssW0rd!')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(Verify.checkPassword('')).toBe(false)
  })
})

describe('checkEmail', () => {
  it('accepts valid email addresses', () => {
    expect(Verify.checkEmail('user@example.com')).toBe(true)
    expect(Verify.checkEmail('test.user@domain.co')).toBe(true)
    // note: regex uses \w which excludes +, so name+tag is not supported
    expect(Verify.checkEmail('name_tag@company.org')).toBe(true)
  })

  it('rejects emails without @', () => {
    expect(Verify.checkEmail('userexample.com')).toBe(false)
  })

  it('rejects emails without domain part', () => {
    expect(Verify.checkEmail('user@')).toBe(false)
  })

  it('rejects emails without local part', () => {
    expect(Verify.checkEmail('@example.com')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(Verify.checkEmail('')).toBe(false)
  })
})
