import { beforeEach, describe, expect, it, vi } from 'vitest'

const processState = vi.hoisted(() => ({ process: null }))

const createEmitter = () => {
  const listeners = new Map()
  return {
    emit(event, ...args) {
      listeners.get(event)?.(...args)
    },
    on: vi.fn((event, listener) => {
      listeners.set(event, listener)
    })
  }
}

const createProcess = () => {
  const stdout = createEmitter()
  const process = {
    kill: vi.fn(),
    on: vi.fn(),
    stdout
  }
  const listeners = new Map()
  process.on.mockImplementation((event, listener) => {
    listeners.set(event, listener)
  })
  process.emit = (event, ...args) => listeners.get(event)?.(...args)
  return process
}

vi.mock('child_process', () => ({
  spawn: vi.fn(() => processState.process)
}))

vi.mock('../../src/main/store', () => ({
  default: {
    getUserData: vi.fn(),
    setUserData: vi.fn()
  }
}))

vi.mock('fs', () => ({
  default: {
    promises: {}
  }
}))

describe('ffmpeg thumbnail extraction', () => {
  beforeEach(() => {
    vi.useRealTimers()
    processState.process = createProcess()
  })

  it('returns the generated jpeg buffer', async () => {
    const { generateThumbnailFromPath } = await import('../../src/main/uploadSourceRegistry')
    const resultPromise = generateThumbnailFromPath('D:/video.mp4')

    processState.process.stdout.emit('data', Buffer.from([1, 2, 3]))
    processState.process.stdout.emit('end')
    processState.process.emit('close', 0)

    await expect(resultPromise).resolves.toMatchObject({ success: true })
  })

  it('returns spawn errors and non-zero exits', async () => {
    const { generateThumbnailFromPath } = await import('../../src/main/uploadSourceRegistry')
    const errorPromise = generateThumbnailFromPath('D:/video.mp4')
    processState.process.emit('error', new Error('ffmpeg missing'))
    await expect(errorPromise).resolves.toMatchObject({
      success: false,
      error: 'ffmpeg missing'
    })

    processState.process = createProcess()
    const exitPromise = generateThumbnailFromPath('D:/video.mp4')
    processState.process.stdout.emit('data', Buffer.from([1, 2, 3]))
    processState.process.stdout.emit('end')
    processState.process.emit('close', 2)
    await expect(exitPromise).resolves.toEqual({
      success: false,
      error: 'ffmpeg exited with code 2'
    })
  })

  it('kills ffmpeg and resolves with timeout failure', async () => {
    vi.useFakeTimers()
    const { generateThumbnailFromPath } = await import('../../src/main/uploadSourceRegistry')
    const resultPromise = generateThumbnailFromPath('D:/video.mp4', { timeoutMs: 100 })

    await vi.advanceTimersByTimeAsync(100)

    await expect(resultPromise).resolves.toMatchObject({
      success: false,
      kind: 'timeout'
    })
    expect(processState.process.kill).toHaveBeenCalledOnce()
  })

  it('stops ffmpeg before accumulating an oversized thumbnail output', async () => {
    const { generateThumbnailFromPath } = await import('../../src/main/uploadSourceRegistry')
    const resultPromise = generateThumbnailFromPath('D:/video.mp4', { maxOutputBytes: 2 })

    processState.process.stdout.emit('data', Buffer.from([1, 2, 3]))

    await expect(resultPromise).resolves.toMatchObject({
      success: false,
      kind: 'output_too_large'
    })
    expect(processState.process.kill).toHaveBeenCalledOnce()
  })
})
