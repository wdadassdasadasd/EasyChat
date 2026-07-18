import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataRoot = ''
let recoveryStore

const message = (id, userId = 'u1') => ({
  messageId: id,
  sessionId: `session-${userId}`,
  messageType: 2,
  messageContent: `message-${id}`
})

beforeEach(async () => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'easychat-recovery-'))
  process.env.EASYCHAT_DATA_ROOT = dataRoot
  vi.resetModules()
  recoveryStore = await import('../../src/main/receiveRecoveryStore.js')
})

afterEach(() => {
  delete process.env.EASYCHAT_DATA_ROOT
  fs.rmSync(dataRoot, { recursive: true, force: true })
})

describe('receive recovery store', () => {
  it('deduplicates records and atomically preserves the latest file', async () => {
    const first = await recoveryStore.appendReceiveRecoveryMessages('u1', [message(1), message(1)])
    expect(first).toMatchObject({ success: true, kind: 'stored', storedCount: 1 })

    const second = await recoveryStore.appendReceiveRecoveryMessages('u1', [message(1), message(2)])
    expect(second).toMatchObject({ success: true, kind: 'stored', storedCount: 1 })
    await expect(recoveryStore.readReceiveRecoveryMessages('u1')).resolves.toEqual([message(1), message(2)])
  })

  it('keeps the prior file unchanged when the record capacity is exceeded', async () => {
    const records = Array.from({ length: 10000 }, (_, index) => message(index + 1))
    await expect(recoveryStore.appendReceiveRecoveryMessages('u1', records)).resolves.toMatchObject({
      success: true,
      kind: 'stored',
      storedCount: 10000
    })
    const filePath = path.join(dataRoot, 'receive-recovery', 'u1.jsonl')
    const before = fs.readFileSync(filePath, 'utf8')

    await expect(recoveryStore.appendReceiveRecoveryMessages('u1', [message(10001)])).resolves.toMatchObject({
      success: false,
      kind: 'capacity_exceeded'
    })
    expect(fs.readFileSync(filePath, 'utf8')).toBe(before)
    await expect(recoveryStore.readReceiveRecoveryMessages('u1')).resolves.toHaveLength(10000)
  })

  it('never rewrites a corrupt recovery file and keeps users isolated', async () => {
    const recoveryDir = path.join(dataRoot, 'receive-recovery')
    fs.mkdirSync(recoveryDir, { recursive: true })
    const corruptPath = path.join(recoveryDir, 'u1.jsonl')
    fs.writeFileSync(corruptPath, '{not-json}\n', 'utf8')

    await expect(recoveryStore.appendReceiveRecoveryMessages('u1', [message(1)])).resolves.toMatchObject({
      success: false,
      kind: 'corrupt'
    })
    expect(fs.readFileSync(corruptPath, 'utf8')).toBe('{not-json}\n')
    await expect(recoveryStore.appendReceiveRecoveryMessages('u2', [message(1, 'u2')])).resolves.toMatchObject({
      success: true,
      kind: 'stored'
    })
    await expect(recoveryStore.readReceiveRecoveryMessages('u2')).resolves.toEqual([message(1, 'u2')])
  })
})
