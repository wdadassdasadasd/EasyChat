import { describe, expect, it, vi, beforeEach } from 'vitest'

// ── hoisted mutable state so vi.mock factories can capture it ──
const { mockIpcOn, mockIpcHandle, mockSender } = vi.hoisted(() => {
  const s = { send: vi.fn(), isDestroyed: vi.fn(() => false) }
  return { mockIpcOn: {}, mockIpcHandle: {}, mockSender: s }
})

vi.mock('electron', () => ({
  app: {},
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true })) },
  shell: {
    openPath: vi.fn(async () => null),
    showItemInFolder: vi.fn(),
    openExternal: vi.fn()
  },
  ipcMain: {
    on: vi.fn((channel, handler) => {
      mockIpcOn[channel] = handler
    }),
    handle: vi.fn((channel, handler) => {
      mockIpcHandle[channel] = handler
    })
  }
}))

vi.mock('../../src/main/ipcSecurity', () => ({
  buildUntrustedSenderResult: (channel) => ({ success: false, channel, kind: 'untrusted_sender' }),
  isTrustedIpcEvent: () => true
}))

vi.mock('../../src/main/secureSessionStore', () => ({
  clearSecureSession: vi.fn(),
  getSecureStorageStatus: vi.fn(() => ({ available: true, kind: 'secure_storage_available' })),
  restoreSecureSession: vi.fn(() => ({ success: false, kind: 'not_authenticated' })),
  saveSecureSession: vi.fn(() => ({ success: true, persistent: true }))
}))

// ── helper: wrap sender as Electron-style IPC event object ──
const ipcEvent = (overrides = {}) => ({ sender: mockSender, ...overrides })

vi.mock('../../src/main/store', () => ({
  default: {
    initUserId: vi.fn(),
    getUserId: () => 'u1',
    getData: vi.fn(() => 'test-value'),
    setData: vi.fn(),
    deleteData: vi.fn(),
    clearLegacyTokenData: vi.fn(),
    setUserData: vi.fn(),
    getUserData: vi.fn(),
    deleteUserData: vi.fn()
  }
}))

vi.mock('../../src/main/wsClient', () => ({
  initWs: vi.fn(),
  closeWs: vi.fn()
}))

vi.mock('../../src/main/uploadSourceRegistry', () => ({
  MAX_CHUNK_SIZE: 4 * 1024 * 1024,
  generateUploadSourceThumbnail: vi.fn(async () => ({ success: true })),
  readUploadSourceChunk: vi.fn(async () => ({ success: true, arrayBuffer: new ArrayBuffer(1) })),
  registerUploadSource: vi.fn(async () => ({ success: true, uploadSourceId: 'source-1' })),
  releaseUploadSource: vi.fn(() => ({ success: true, released: true }))
}))

vi.mock('../../src/main/uploadCoverRegistry', () => ({
  registerUploadCover: vi.fn(async () => ({ success: true, coverSourceId: 'cover-1' })),
  releaseUploadCover: vi.fn(async () => ({ success: true, released: true }))
}))

vi.mock('../../src/main/uploadTaskManager', () => ({
  acknowledgeUploadTask: vi.fn(async () => ({ success: true })),
  activateUploadTasks: vi.fn(),
  cancelUploadTask: vi.fn(async () => ({ success: true })),
  deactivateUploadTasks: vi.fn(async () => {}),
  enqueueUploadTask: vi.fn(async () => ({ success: true })),
  pauseUploadTask: vi.fn(async () => ({ success: true })),
  resumePersistedUploadTasks: vi.fn(async () => ({ protectedMessageIds: [] })),
  resumeUploadTask: vi.fn(async () => ({ success: true })),
  setUploadTaskEventTarget: vi.fn()
}))

vi.mock('../../src/main/db/ChatSessionUserModel', () => ({
  selectUserSessionList: vi.fn(async () => [
    { contactId: 'c1', sessionId: 's1', contactType: 0, contactName: 'Test User' }
  ]),
  delChatSession: vi.fn(async () => 1),
  markSessionRead: vi.fn(async () => 1),
  topChatSession: vi.fn(async () => 1),
  clearChatSessionSummaryBySessionId: vi.fn(async (sid) => ({
    sessionId: sid,
    contactId: 'c1',
    lastMessage: '',
    noReadCount: 0
  }))
}))

vi.mock('../../src/main/db/ChatMessageModel', () => ({
  clearMessageAndSessionSummaryBySessionId: vi.fn(async (sid) => ({
    sessionId: sid,
    contactId: 'c1',
    lastMessage: '',
    noReadCount: 0
  })),
  clearMessageBySessionId: vi.fn(async () => 1),
  isCurrentUserMessageFilePath: vi.fn(async () => true),
  recoverStalePendingMessages: vi.fn(async () => ({ success: true, recoveredCount: 2 })),
  replacePendingMessage: vi.fn(async ({ message, localMessageId }) => ({
    success: true,
    messageId: message?.messageId,
    localMessageId
  })),
  savePendingMessage: vi.fn(async ({ message }) => ({
    success: true,
    messageId: message?.messageId
  })),
  searchMessageBySessionId: vi.fn(async () => [{ messageId: 1, messageContent: 'found match' }]),
  selectMessageContextByMessageId: vi.fn(async () => [
    { messageId: 5, messageContent: 'context msg' }
  ]),
  selectMessageList: vi.fn(async () => ({
    dataList: [{ messageId: 1, messageContent: 'hello' }],
    hasMore: false
  })),
  updateLocalMessageStatus: vi.fn(async ({ messageId, status }) => ({
    success: true,
    messageId,
    status
  }))
}))

vi.mock('../../src/main/db/UserSettingModel', () => ({
  addUserSetting: vi.fn(),
  getLocalFileFolder: vi.fn(async () => ({ localFileFolder: '/tmp/chat' })),
  resetLocalFileFolder: vi.fn(async () => ({ localFileFolder: '/tmp/chat' })),
  updateLocalFileFolder: vi.fn(async (folderPath) => ({ localFileFolder: folderPath }))
}))

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn((p) =>
      ['/tmp/exists.mp4', '/tmp/chat/file.mp4', '/tmp/outside.mp4'].includes(String(p))
    ),
    promises: {
      readFile: vi.fn(async () => Buffer.from([1, 2, 3])),
      realpath: vi.fn(async (filePath) => filePath),
      stat: vi.fn(async () => ({ isFile: () => true, size: 3 })),
      writeFile: vi.fn(async () => {})
    },
    createWriteStream: vi.fn(() => ({ on: vi.fn(), close: vi.fn((cb) => cb && cb()) })),
    renameSync: vi.fn(),
    unlinkSync: vi.fn(),
    readdirSync: vi.fn(() => [])
  }
}))

vi.mock('path', () => ({
  default: {
    extname: vi.fn((n) => '.' + String(n).split('.').pop()),
    basename: vi.fn((n) => n),
    isAbsolute: vi.fn((p) => /^([A-Za-z]:[\\/]|\/)/.test(String(p))),
    join: vi.fn((...args) => args.join('/')),
    relative: vi.fn((from, to) => {
      const prefix = `${String(from).replace(/\/$/, '')}/`
      return String(to).startsWith(prefix) ? String(to).slice(prefix.length) : '../outside'
    }),
    resolve: vi.fn((value) => value)
  }
}))

vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const proc = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn()
    }
    setImmediate(() => {
      const dataCb = proc.stdout.on.mock.calls.find((c) => c[0] === 'data')?.[1]
      if (dataCb) dataCb(Buffer.from([0xff, 0xd8, 0xff]))
      const endCb = proc.stdout.on.mock.calls.find((c) => c[0] === 'end')?.[1]
      if (endCb) endCb()
    })
    return proc
  })
}))

vi.mock('http', () => ({
  default: {
    get: vi.fn(() => {
      const req = { on: vi.fn(), destroy: vi.fn(), abort: vi.fn() }
      return req
    })
  }
}))
vi.mock('https', () => ({
  default: {
    get: vi.fn(() => {
      const req = { on: vi.fn(), destroy: vi.fn(), abort: vi.fn() }
      return req
    })
  }
}))

// ── reset before each test ──
let ipcExports
beforeEach(async () => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  mockSender.send.mockClear()
  mockSender.isDestroyed.mockReturnValue(false)
  vi.resetModules()
  ipcExports = await import('../../src/main/ipc')
  const store = (await import('../../src/main/store')).default
  store.getUserData.mockReset()
  store.getUserData.mockReturnValue(undefined)
})

// ═══════════════════════════════════════════════
// Store channels
// ═══════════════════════════════════════════════
describe('IPC: SetLocalStore', () => {
  it('registers handler via onSetLocalStore and saves data', () => {
    ipcExports.onSetLocalStore()
    const handler = mockIpcOn['SetLocalStore']
    expect(handler).toBeDefined()

    handler(ipcEvent(), { key: 'devDomain', value: 'http://localhost:5050' })
    // fire-and-forget, no callback sent
  })

  it('rejects unknown keys without writing to the store', async () => {
    const store = (await import('../../src/main/store')).default
    ipcExports.onSetLocalStore()

    mockIpcOn.SetLocalStore(ipcEvent(), { key: 'token', value: 'stolen' })

    expect(store.setData).not.toHaveBeenCalled()
  })
})

describe('IPC: GetLocalStore', () => {
  it('returns stored value via callback', () => {
    ipcExports.onGetLocalStore()
    const handler = mockIpcOn['GetLocalStore']
    expect(handler).toBeDefined()

    handler(ipcEvent(), 'devDomain')
    expect(mockSender.send).toHaveBeenCalledWith('getLocalStoreCallback', 'test-value')
  })

  it('sends undefined on store error', async () => {
    const store = (await import('../../src/main/store')).default
    store.getData.mockImplementationOnce(() => {
      throw new Error('boom')
    })

    ipcExports.onGetLocalStore()
    const handler = mockIpcOn['GetLocalStore']

    handler(ipcEvent(), 'devDomain')
    expect(mockSender.send).toHaveBeenCalledWith('getLocalStoreCallback', undefined)
  })
})

// ═══════════════════════════════════════════════
// Session channels (registerSafeIpcOn)
// ═══════════════════════════════════════════════
describe('IPC: startAuthenticatedSession', () => {
  it('recovers stale pending messages before starting WebSocket', async () => {
    const { recoverStalePendingMessages } = await import('../../src/main/db/ChatMessageModel')
    const { initWs } = await import('../../src/main/wsClient')
    const callback = vi.fn()

    ipcExports.onLoginSuccess({}, callback)
    const handler = mockIpcHandle.startAuthenticatedSession
    expect(handler).toBeDefined()

    await handler(ipcEvent(), {
      userId: 'u1',
      token: 'token-1',
      email: 'u1@example.com'
    })

    expect(recoverStalePendingMessages).toHaveBeenCalled()
    expect(callback).toHaveBeenCalled()
    expect(initWs).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', token: 'token-1' }),
      mockSender
    )
  })

  it('waits for WebSocket initialization before opening the chat window', async () => {
    const { initWs } = await import('../../src/main/wsClient')
    let resolveInit
    initWs.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInit = resolve
        })
    )
    const callback = vi.fn()

    ipcExports.onLoginSuccess({}, callback)
    const openChatPromise = mockIpcHandle.startAuthenticatedSession(ipcEvent(), {
      userId: 'u1',
      token: 'token-1',
      email: 'u1@example.com'
    })

    await vi.waitFor(() => expect(initWs).toHaveBeenCalled())
    expect(callback).not.toHaveBeenCalled()

    resolveInit()
    await openChatPromise
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }))
  })

  it('replays durable local replacements before stale pending recovery', async () => {
    const store = (await import('../../src/main/store')).default
    const { replacePendingMessage, recoverStalePendingMessages } =
      await import('../../src/main/db/ChatMessageModel')
    const payload = {
      mode: 'replace',
      localMessageId: -9,
      message: { messageId: 900, sessionId: 's1' },
      chatSession: { contactId: 'c1' }
    }
    store.getUserData.mockImplementation((key) => {
      return key === 'localReplaceRecoveryQueue' ? [payload] : undefined
    })
    const callback = vi.fn()

    ipcExports.onLoginSuccess({}, callback)
    await mockIpcHandle.startAuthenticatedSession(ipcEvent(), {
      userId: 'u1',
      token: 'token-1',
      email: 'u1@example.com'
    })

    expect(replacePendingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        localMessageId: -9,
        message: expect.objectContaining({ messageId: 900 })
      })
    )
    expect(store.deleteUserData).toHaveBeenCalledWith('localReplaceRecoveryQueue')
    expect(recoverStalePendingMessages).toHaveBeenCalled()
    expect(replacePendingMessage.mock.invocationCallOrder.at(-1)).toBeLessThan(
      recoverStalePendingMessages.mock.invocationCallOrder.at(-1)
    )
  })
})

describe('IPC: loadSessionData', () => {
  it('returns session list via callback', async () => {
    ipcExports.onLoadSessionData()
    const handler = mockIpcOn['loadSessionData']
    expect(handler).toBeDefined()

    await handler(ipcEvent())
    const calls = mockSender.send.mock.calls
    const sessionCall = calls.find((c) => c[0] === 'loadSessionDataCallback')
    expect(sessionCall).toBeDefined()
    expect(sessionCall[1]).toEqual([expect.objectContaining({ contactId: 'c1', sessionId: 's1' })])
  })

  it('sends error callback when DB fails', async () => {
    const { selectUserSessionList } = await import('../../src/main/db/ChatSessionUserModel')
    selectUserSessionList.mockRejectedValueOnce(new Error('DB crash'))

    ipcExports.onLoadSessionData()
    const handler = mockIpcOn['loadSessionData']

    await handler(ipcEvent())
    const calls = mockSender.send.mock.calls
    const errCall = calls.find((c) => c[0] === 'loadSessionDataCallback')
    expect(errCall).toBeDefined()
    expect(errCall[1]).toHaveProperty('success', false)
    expect(errCall[1]).toHaveProperty('error', 'DB crash')
  })
})

describe('IPC: delChatSession', () => {
  it('sends success callback on delete', async () => {
    ipcExports.onDelChatSession()
    const handler = mockIpcOn['delChatSession']
    expect(handler).toBeDefined()

    await handler(ipcEvent(), 'c1')
    expect(mockSender.send).toHaveBeenCalledWith('delChatSessionCallback', {
      contactId: 'c1',
      success: true
    })
  })

  it('includes contactId when persistence fails', async () => {
    const { delChatSession } = await import('../../src/main/db/ChatSessionUserModel')
    delChatSession.mockRejectedValueOnce(new Error('DB unavailable'))
    ipcExports.onDelChatSession()

    await mockIpcOn.delChatSession(ipcEvent(), 'c1')

    expect(mockSender.send).toHaveBeenCalledWith(
      'delChatSessionCallback',
      expect.objectContaining({
        contactId: 'c1',
        success: false,
        kind: 'db_error'
      })
    )
  })
})

describe('IPC: topChatSession', () => {
  it('sends callback with contactId and topType', async () => {
    ipcExports.onTopChatSession()
    const handler = mockIpcOn['topChatSession']
    expect(handler).toBeDefined()

    await handler(ipcEvent(), { contactId: 'c1', topType: 1 })
    expect(mockSender.send).toHaveBeenCalledWith('topChatSessionCallback', {
      contactId: 'c1',
      topType: 1,
      success: true
    })
  })
})

describe('IPC: markSessionRead', () => {
  it('sends callback on mark read', async () => {
    ipcExports.onMarkSessionRead()
    const handler = mockIpcOn['markSessionRead']
    expect(handler).toBeDefined()

    await handler(ipcEvent(), { contactId: 'c1', operationId: 'read-1' })
    expect(mockSender.send).toHaveBeenCalledWith('markSessionReadCallback', {
      contactId: 'c1',
      operationId: 'read-1',
      success: true
    })
  })
})

// ═══════════════════════════════════════════════
// Chat message channels
// ═══════════════════════════════════════════════
describe('IPC: loadChatMessage', () => {
  it('returns paginated messages', async () => {
    ipcExports.onLoadChatMessage()
    const handler = mockIpcOn['loadChatMessage']
    expect(handler).toBeDefined()

    await handler(ipcEvent(), { sessionId: 's1', loadSeq: 1 })
    const call = mockSender.send.mock.calls.find((c) => c[0] === 'loadChatMessageCallback')
    expect(call).toBeDefined()
    expect(call[1]).toMatchObject({
      dataList: [expect.objectContaining({ messageId: 1 })],
      hasMore: false,
      sessionId: 's1',
      loadSeq: 1
    })
  })

  it('returns context messages for targetMessageId', async () => {
    ipcExports.onLoadChatMessage()
    const handler = mockIpcOn['loadChatMessage']

    await handler(ipcEvent(), { sessionId: 's1', targetMessageId: 5, loadSeq: 1 })
    const call = mockSender.send.mock.calls.find((c) => c[0] === 'loadChatMessageCallback')
    expect(call).toBeDefined()
    expect(call[1]).toMatchObject({
      dataList: [expect.objectContaining({ messageId: 5 })],
      targetMessageId: 5,
      loadMode: 'context',
      sessionId: 's1',
      loadSeq: 1
    })
  })

  it('sends error callback when message query fails', async () => {
    const { selectMessageList } = await import('../../src/main/db/ChatMessageModel')
    selectMessageList.mockRejectedValueOnce(new Error('read failed'))

    ipcExports.onLoadChatMessage()
    const handler = mockIpcOn['loadChatMessage']

    await handler(ipcEvent(), { sessionId: 's1', loadSeq: 9 })
    expect(mockSender.send).toHaveBeenCalledWith(
      'loadChatMessageCallback',
      expect.objectContaining({
        success: false,
        error: 'read failed',
        sessionId: 's1',
        loadSeq: 9
      })
    )
  })
})

describe('IPC: clearChatMessage', () => {
  it('clears messages and returns updated session', async () => {
    ipcExports.onClearChatMessage()
    const handler = mockIpcOn['clearChatMessage']
    expect(handler).toBeDefined()

    await handler(ipcEvent(), { sessionId: 's1' })
    expect(mockSender.send).toHaveBeenCalledWith(
      'clearChatMessageCallback',
      expect.objectContaining({ success: true, sessionId: 's1' })
    )
  })
})

describe('IPC: searchChatMessage', () => {
  it('returns search results', async () => {
    ipcExports.onSearchChatMessage()
    const handler = mockIpcOn['searchChatMessage']
    expect(handler).toBeDefined()

    await handler(ipcEvent(), { sessionId: 's1', keyword: 'hello', searchSeq: 1 })
    const call = mockSender.send.mock.calls.find((c) => c[0] === 'searchChatMessageCallback')
    expect(call).toBeDefined()
    expect(call[1]).toMatchObject({
      sessionId: 's1',
      keyword: 'hello',
      searchSeq: 1,
      dataList: [expect.objectContaining({ messageId: 1 })]
    })
  })

  it('sends unified error callback when search fails', async () => {
    const { searchMessageBySessionId } = await import('../../src/main/db/ChatMessageModel')
    searchMessageBySessionId.mockRejectedValueOnce(new Error('db search failed'))

    ipcExports.onSearchChatMessage()
    const handler = mockIpcOn['searchChatMessage']

    await handler(ipcEvent(), { sessionId: 's1', keyword: 'hello', searchSeq: 7 })
    expect(mockSender.send).toHaveBeenCalledWith(
      'searchChatMessageCallback',
      expect.objectContaining({
        success: false,
        channel: 'searchChatMessageCallback',
        kind: 'db_error',
        error: 'db search failed',
        sessionId: 's1',
        searchSeq: 7
      })
    )
  })
})

// ═══════════════════════════════════════════════
// saveSendMessage (ipcMain.handle)
// ═══════════════════════════════════════════════
describe('IPC: saveSendMessage', () => {
  let handler
  beforeEach(() => {
    ipcExports.onSaveSendMessage()
    handler = mockIpcHandle['saveSendMessage']
  })

  it('returns handler', () => {
    expect(handler).toBeDefined()
  })

  it('saves pending message', async () => {
    const result = await handler(
      {},
      { message: { messageId: 100, sessionId: 's1' }, mode: 'pending' }
    )
    expect(result.success).toBe(true)
  })

  it('replaces pending with server message', async () => {
    const result = await handler(
      {},
      {
        localMessageId: -1,
        message: { messageId: 200, sessionId: 's1' },
        mode: 'replace'
      }
    )
    expect(result.success).toBe(true)
    expect(result.messageId).toBe(200)
  })

  it('updates message status', async () => {
    const result = await handler({}, { message: { messageId: 300 }, mode: 'status', status: 1 })
    expect(result.success).toBe(true)
    expect(result.status).toBe(1)
  })

  it('rejects implicit replace without a local message id', async () => {
    const result = await handler(
      {},
      { message: { messageId: 400, sessionId: 's1' }, chatSession: { contactId: 'c1' } }
    )
    expect(result).toMatchObject({
      success: false,
      kind: 'validation_error',
      recoveryQueued: false
    })
  })

  it('rejects malformed text messages before calling the database', async () => {
    const { savePendingMessage } = await import('../../src/main/db/ChatMessageModel')
    const result = await handler(
      {},
      {
        mode: 'pending',
        message: {
          messageId: -1,
          sessionId: 's1',
          messageType: 2,
          messageContent: 'x'.repeat(501)
        }
      }
    )

    expect(result).toMatchObject({ success: false, kind: 'validation_error' })
    expect(savePendingMessage).not.toHaveBeenCalled()
  })

  it('queues a durable recovery payload when local replace throws', async () => {
    const store = (await import('../../src/main/store')).default
    const { replacePendingMessage } = await import('../../src/main/db/ChatMessageModel')
    store.getUserData.mockReturnValueOnce([])
    replacePendingMessage.mockRejectedValueOnce(new Error('database unavailable'))
    const payload = {
      mode: 'replace',
      localMessageId: -10,
      message: { messageId: 1000, sessionId: 's1' },
      chatSession: { contactId: 'c1' }
    }

    const result = await handler({}, payload)

    expect(result).toMatchObject({
      success: false,
      kind: 'db_error',
      recoveryQueued: true
    })
    expect(store.setUserData).toHaveBeenCalledWith('localReplaceRecoveryQueue', [payload])
  })
})

describe('IPC: upload sources', () => {
  it('registers only the named source-based handlers', async () => {
    ipcExports.onUploadSources()

    expect(mockIpcHandle['generateVideoThumbnail']).toBeUndefined()
    expect(mockIpcHandle['registerUploadSource']).toBeDefined()
    expect(mockIpcHandle['readUploadSourceChunk']).toBeDefined()
    expect(mockIpcHandle['releaseUploadSource']).toBeDefined()
    expect(mockIpcHandle['registerUploadCover']).toBeDefined()
    expect(mockIpcHandle['releaseUploadCover']).toBeDefined()
    expect(mockIpcHandle['generateUploadSourceThumbnail']).toBeDefined()
  })

  it('rejects missing chunk ranges before reading the upload source', async () => {
    const { readUploadSourceChunk } = await import('../../src/main/uploadSourceRegistry')
    ipcExports.onUploadSources()

    const result = await mockIpcHandle.readUploadSourceChunk(ipcEvent(), {
      uploadSourceId: 'source-1',
      end: 1024
    })

    expect(result).toMatchObject({ success: false, kind: 'validation_error' })
    expect(readUploadSourceChunk).not.toHaveBeenCalled()
  })

  it('registers only bounded cover payloads', async () => {
    const { registerUploadCover } = await import('../../src/main/uploadCoverRegistry')
    ipcExports.onUploadSources()

    const result = await mockIpcHandle.registerUploadCover(ipcEvent(), {
      arrayBuffer: new Uint8Array([1, 2, 3]).buffer,
      type: 'image/jpeg'
    })

    expect(result).toMatchObject({ success: true, coverSourceId: 'cover-1' })
    expect(registerUploadCover).toHaveBeenCalledOnce()
  })
})

describe('IPC: local video access', () => {
  it('rejects files that do not belong to the current user message history', async () => {
    const { isCurrentUserMessageFilePath } = await import('../../src/main/db/ChatMessageModel')
    isCurrentUserMessageFilePath.mockResolvedValueOnce(false)
    ipcExports.onOpenTempVideoFile()

    const result = await mockIpcHandle.readLocalVideoFile(ipcEvent(), {
      filePath: '/tmp/exists.mp4'
    })

    expect(result).toMatchObject({ success: false, kind: 'validation_error' })
  })

  it('does not open local videos outside the current user message history', async () => {
    const { shell } = await import('electron')
    const { isCurrentUserMessageFilePath } = await import('../../src/main/db/ChatMessageModel')
    isCurrentUserMessageFilePath.mockResolvedValueOnce(false)
    ipcExports.onOpenTempVideoFile()

    const result = await mockIpcHandle.openLocalVideoFile(ipcEvent(), {
      filePath: '/tmp/exists.mp4'
    })

    expect(result).toMatchObject({ success: false, kind: 'validation_error' })
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('rejects oversized local video reads before loading the file', async () => {
    const fs = (await import('fs')).default
    fs.promises.stat.mockResolvedValueOnce({
      isFile: () => true,
      size: 128 * 1024 * 1024 + 1
    })
    ipcExports.onOpenTempVideoFile()

    const result = await mockIpcHandle.readLocalVideoFile(ipcEvent(), {
      filePath: '/tmp/exists.mp4'
    })

    expect(result).toMatchObject({ success: false, kind: 'validation_error' })
    expect(fs.promises.readFile).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════
// File download channels
// ═══════════════════════════════════════════════
describe('IPC: downloadChatFile', () => {
  const allowDownloadDomain = async (origin = 'http://files.example.com') => {
    const store = (await import('../../src/main/store')).default
    store.getData.mockImplementation((key) => {
      if (key === 'devDomain' || key === 'prodDomain') {
        return origin
      }
      return 'test-value'
    })
  }

  it('rejects when url or messageId missing', async () => {
    await allowDownloadDomain()
    ipcExports.onChatFileDownload()
    const handler = mockIpcHandle['downloadChatFile']

    const result = await handler(ipcEvent(), {})
    expect(result.success).toBe(false)
    expect(result.kind).toBe('validation_error')
  })

  it('rejects duplicate download', async () => {
    await allowDownloadDomain()
    ipcExports.onChatFileDownload()
    const handler = mockIpcHandle['downloadChatFile']

    // Start a download (don't await — it will hang internally)
    handler(ipcEvent(), {
      url: 'http://files.example.com/f',
      messageId: 'dup1',
      fileName: 'f.mp4'
    })

    // Let the microtask queue flush so activeDownloads is populated
    await new Promise((r) => setTimeout(r, 50))

    // Second call must be rejected immediately
    const result = await handler(ipcEvent(), {
      url: 'http://files.example.com/f',
      messageId: 'dup1',
      fileName: 'f.mp4'
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('already downloading')
  }, 10000)

  it('rejects downloads outside configured backend domains before network access', async () => {
    await allowDownloadDomain('http://api.example.com')
    const http = (await import('http')).default
    ipcExports.onChatFileDownload()

    const result = await mockIpcHandle.downloadChatFile(ipcEvent(), {
      url: 'http://evil.example.com/file',
      messageId: 'blocked-1',
      fileName: 'file.bin'
    })

    expect(result).toMatchObject({
      success: false,
      kind: 'validation_error'
    })
    expect(http.get).not.toHaveBeenCalled()
  })

  it('allows development renderer proxy download urls produced by getApiUrl', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    vi.resetModules()
    ipcExports = await import('../../src/main/ipc')
    await allowDownloadDomain('http://localhost:5050')
    const http = (await import('http')).default
    const request = { on: vi.fn(), destroy: vi.fn(), abort: vi.fn() }
    http.get.mockReturnValueOnce(request)
    ipcExports.onChatFileDownload()

    mockIpcHandle.downloadChatFile(ipcEvent(), {
      url: 'http://localhost:5173/api/chat/streamFile?token=download-token',
      messageId: 'dev-proxy-1',
      fileName: 'file.bin'
    })

    await new Promise((r) => setTimeout(r, 0))
    expect(http.get).toHaveBeenCalledWith(
      'http://localhost:5173/api/chat/streamFile?token=download-token',
      expect.any(Function)
    )
  })

  it('rejects unsafe redirects and clears the active download state', async () => {
    await allowDownloadDomain()
    const http = (await import('http')).default
    const createRequest = () => ({ on: vi.fn(), destroy: vi.fn(), abort: vi.fn() })
    http.get
      .mockImplementationOnce((_url, callback) => {
        const request = createRequest()
        setImmediate(() =>
          callback({
            statusCode: 302,
            headers: { location: 'file:///etc/passwd' },
            resume: vi.fn()
          })
        )
        return request
      })
      .mockImplementationOnce((_url, callback) => {
        const request = createRequest()
        setImmediate(() =>
          callback({
            statusCode: 500,
            headers: {},
            resume: vi.fn()
          })
        )
        return request
      })

    ipcExports.onChatFileDownload()
    const handler = mockIpcHandle.downloadChatFile
    const payload = {
      url: 'http://files.example.com/file',
      messageId: 'redirect-1',
      fileName: 'file.bin'
    }

    const first = await handler(ipcEvent(), payload)
    const second = await handler(ipcEvent(), payload)

    expect(first.success).toBe(false)
    expect(first.error).toContain('redirect rejected')
    expect(second.error).toContain('HTTP 500')
    expect(http.get).toHaveBeenCalledTimes(2)
  })

  it('rejects redirects to non-configured http origins', async () => {
    await allowDownloadDomain('http://files.example.com')
    const http = (await import('http')).default
    http.get.mockImplementationOnce((_url, callback) => {
      const request = { on: vi.fn(), destroy: vi.fn(), abort: vi.fn() }
      setImmediate(() =>
        callback({
          statusCode: 302,
          headers: { location: 'http://other.example.com/file' },
          resume: vi.fn()
        })
      )
      return request
    })

    ipcExports.onChatFileDownload()
    const result = await mockIpcHandle.downloadChatFile(ipcEvent(), {
      url: 'http://files.example.com/file',
      messageId: 'redirect-origin-1',
      fileName: 'file.bin'
    })

    expect(result).toMatchObject({
      success: false,
      kind: 'validation_error'
    })
    expect(result.error).toContain('origin is not allowed')
    expect(http.get).toHaveBeenCalledTimes(1)
  })
})

describe('IPC: cancelDownloadChatFile', () => {
  it('handles cancel for non-existent download', async () => {
    ipcExports.onChatFileDownload()
    const handler = mockIpcHandle['cancelDownloadChatFile']

    const result = await handler({}, { messageId: 'nonexistent' })
    expect(result.success).toBe(true)
  })
})

describe('IPC: openDownloadedFile', () => {
  it('returns error when filePath missing or file not found', async () => {
    ipcExports.onChatFileDownload()
    const handler = mockIpcHandle['openDownloadedFile']

    const result = await handler({}, {})
    expect(result.success).toBe(false)
  })

  it('rejects existing files outside the configured download folder', async () => {
    const { shell } = await import('electron')
    ipcExports.onChatFileDownload()

    const result = await mockIpcHandle.openDownloadedFile({}, { filePath: '/tmp/outside.mp4' })

    expect(result).toMatchObject({ success: false, kind: 'validation_error' })
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('opens existing files inside the configured download folder', async () => {
    const { shell } = await import('electron')
    ipcExports.onChatFileDownload()

    const result = await mockIpcHandle.openDownloadedFile({}, { filePath: '/tmp/chat/file.mp4' })

    expect(result.success).toBe(true)
    expect(shell.openPath).toHaveBeenCalledWith('/tmp/chat/file.mp4')
  })
})

describe('IPC: showDownloadedFileInFolder', () => {
  it('returns error when filePath missing', async () => {
    ipcExports.onChatFileDownload()
    const handler = mockIpcHandle['showDownloadedFileInFolder']

    const result = await handler({}, {})
    expect(result.success).toBe(false)
  })

  it('rejects files outside the configured download folder', async () => {
    const { shell } = await import('electron')
    ipcExports.onChatFileDownload()

    const result = await mockIpcHandle.showDownloadedFileInFolder(
      {},
      { filePath: '/tmp/outside.mp4' }
    )

    expect(result).toMatchObject({ success: false, kind: 'validation_error' })
    expect(shell.showItemInFolder).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════
// logout
// ═══════════════════════════════════════════════
describe('IPC: logout', () => {
  it('closes WebSocket and calls callback', async () => {
    ipcExports.onResetToLogin({}, () => {})
    const handler = mockIpcHandle['logout']
    expect(handler).toBeDefined()

    const { closeWs } = await import('../../src/main/wsClient')
    const store = (await import('../../src/main/store')).default
    await handler()
    expect(closeWs).toHaveBeenCalled()
    expect(store.initUserId).toHaveBeenCalledWith(null)
  })
})

describe('IPC: authenticated data boundary', () => {
  it('rejects session reads after the active user has been cleared', async () => {
    const store = (await import('../../src/main/store')).default
    const originalGetUserId = store.getUserId
    store.getUserId = () => null
    ipcExports.onLoadSessionData()

    await mockIpcOn.loadSessionData(ipcEvent())

    expect(mockSender.send).toHaveBeenCalledWith(
      'loadSessionDataCallback',
      expect.objectContaining({ success: false, kind: 'not_authenticated' })
    )
    store.getUserId = originalGetUserId
  })
})

// ═══════════════════════════════════════════════
// Local file folder channels
// ═══════════════════════════════════════════════
describe('IPC: local file folder', () => {
  it('getLocalFileFolder returns folder path', async () => {
    ipcExports.onLocalFileFolder()
    const handler = mockIpcHandle['getLocalFileFolder']

    const result = await handler()
    expect(result.localFileFolder).toBe('/tmp/chat')
  })

  it('resetLocalFileFolder resets to default', async () => {
    ipcExports.onLocalFileFolder()
    const handler = mockIpcHandle['resetLocalFileFolder']

    const result = await handler()
    expect(result.localFileFolder).toBe('/tmp/chat')
  })
})

// ═══════════════════════════════════════════════
// registerSafeIpcOn: error path coverage
// ═══════════════════════════════════════════════
describe('registerSafeIpcOn error wrapping', () => {
  it('returns validation_error without calling the database', async () => {
    const { topChatSession } = await import('../../src/main/db/ChatSessionUserModel')
    ipcExports.onTopChatSession()

    await mockIpcOn.topChatSession(ipcEvent(), { contactId: '', topType: 9 })

    expect(topChatSession).not.toHaveBeenCalled()
    expect(mockSender.send).toHaveBeenCalledWith(
      'topChatSessionCallback',
      expect.objectContaining({ success: false, kind: 'validation_error' })
    )
  })

  it('sends error when markSessionRead DB call fails', async () => {
    const { markSessionRead } = await import('../../src/main/db/ChatSessionUserModel')
    markSessionRead.mockRejectedValueOnce(new Error('DB timeout'))

    ipcExports.onMarkSessionRead()
    const handler = mockIpcOn['markSessionRead']

    await handler(ipcEvent(), 'c1')
    expect(mockSender.send).toHaveBeenCalledWith(
      'markSessionReadCallback',
      expect.objectContaining({ success: false, error: 'DB timeout' })
    )
  })

  it('sends error when clearChatMessage DB call fails', async () => {
    const { clearMessageAndSessionSummaryBySessionId } =
      await import('../../src/main/db/ChatMessageModel')
    clearMessageAndSessionSummaryBySessionId.mockRejectedValueOnce(new Error('txn fail'))

    ipcExports.onClearChatMessage()
    const handler = mockIpcOn['clearChatMessage']

    await handler(ipcEvent(), { sessionId: 's1' })
    expect(mockSender.send).toHaveBeenCalledWith(
      'clearChatMessageCallback',
      expect.objectContaining({ success: false, error: 'txn fail' })
    )
  })
})
