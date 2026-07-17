import { app, dialog, ipcMain, shell } from 'electron'
import fs from 'fs'
import http from 'http'
import https from 'https'
import path from 'path'
import { IPC_CALLBACK_CHANNELS } from '../shared/ipcChannels.js'
import { initWs, closeWs } from './wsClient.js'
import logger from './logger.js'
import store from './store.js'
import {
  addUserSetting,
  getLocalFileFolder,
  resetLocalFileFolder,
  updateLocalFileFolder
} from './db/UserSettingModel.js'
import {
  selectUserSessionList,
  delChatSession,
  markSessionRead,
  topChatSession
} from './db/ChatSessionUserModel.js'
import {
  clearMessageAndSessionSummaryBySessionId,
  isCurrentUserMessageFilePath,
  replacePendingMessage,
  recoverStalePendingMessages,
  savePendingMessage,
  searchMessageBySessionId,
  selectMessageContextByMessageId,
  selectMessageList,
  updateLocalMessageStatus
} from './db/ChatMessageModel.js'
import {
  MAX_CHUNK_SIZE,
  generateUploadSourceThumbnail,
  readUploadSourceChunk,
  registerUploadSource,
  releaseUploadSource
} from './uploadSourceRegistry.js'
import { registerUploadCover, releaseUploadCover } from './uploadCoverRegistry.js'
import {
  acknowledgeUploadTask,
  cancelUploadTask,
  enqueueUploadTask,
  pauseUploadTask,
  resumePersistedUploadTasks,
  resumeUploadTask,
  setUploadTaskEventTarget,
  activateUploadTasks,
  deactivateUploadTasks
} from './uploadTaskManager.js'
import {
  validateClearChatMessage,
  validateContactId,
  validateDownload,
  validateDownloadId,
  validateFilePathPayload,
  validateHttpUrl,
  validateLoadChatMessage,
  validateLoginOrRegister,
  validateMarkSessionRead,
  validateOpenChat,
  validateSaveSendMessage,
  validateSearchChatMessage,
  validateStoreRead,
  validateStoreWrite,
  validateTempVideo,
  validateTopChatSession,
  validateUploadSourceChunk,
  validateUploadCoverId,
  validateUploadCoverRegistration,
  validateUploadSourceId,
  validateUploadTaskMessageId,
  validateEnqueueUploadTask,
  validateUploadSourceRegistration,
  validateWindowOperation
} from './ipcValidation.js'
import { getTempVideoFolder } from './tempVideoFiles.js'

const LOCAL_REPLACE_RECOVERY_KEY = 'localReplaceRecoveryQueue'
const MAX_LOCAL_REPLACE_RECOVERY_ITEMS = 100
const MAX_LOCAL_VIDEO_READ_SIZE = 128 * 1024 * 1024
const NODE_ENV = process.env.NODE_ENV
const DEFAULT_DEV_RENDERER_DOWNLOAD_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]

const getLocalReplaceRecoveryQueue = () => {
  const queue = store.getUserData(LOCAL_REPLACE_RECOVERY_KEY)
  return Array.isArray(queue) ? queue : []
}

const saveLocalReplaceRecoveryQueue = (queue) => {
  if (queue.length === 0) {
    store.deleteUserData(LOCAL_REPLACE_RECOVERY_KEY)
    return
  }
  store.setUserData(LOCAL_REPLACE_RECOVERY_KEY, queue.slice(-MAX_LOCAL_REPLACE_RECOVERY_ITEMS))
}

const getLocalReplaceRecoveryId = (payload = {}) => {
  return `${payload.localMessageId ?? ''}:${payload.message?.messageId ?? ''}`
}

const queueLocalReplaceRecovery = (payload = {}) => {
  if (payload.mode !== 'replace' || !payload.localMessageId || !payload.message?.messageId) {
    return false
  }
  // HTTP 已成功但本地 replace 失败时，把替换请求持久化，下一次打开聊天窗口继续回放。
  const recoveryId = getLocalReplaceRecoveryId(payload)
  const queue = getLocalReplaceRecoveryQueue().filter(
    (item) => getLocalReplaceRecoveryId(item) !== recoveryId
  )
  queue.push(payload)
  saveLocalReplaceRecoveryQueue(queue)
  return true
}

const removeLocalReplaceRecovery = (payload = {}) => {
  const recoveryId = getLocalReplaceRecoveryId(payload)
  const queue = getLocalReplaceRecoveryQueue()
  const nextQueue = queue.filter((item) => getLocalReplaceRecoveryId(item) !== recoveryId)
  if (nextQueue.length !== queue.length) {
    saveLocalReplaceRecoveryQueue(nextQueue)
  }
}

const recoverLocalReplaceQueue = async () => {
  const queue = getLocalReplaceRecoveryQueue()
  if (queue.length === 0) {
    return { recoveredCount: 0, remainingCount: 0 }
  }

  // 回放失败的 replace 会保留在队列中，避免已发送消息长期停留在本地临时 id。
  const remaining = []
  let recoveredCount = 0
  for (const payload of queue) {
    try {
      const result = await saveSendMessageToLocal(payload)
      if (result?.success) {
        recoveredCount += 1
      } else {
        remaining.push(payload)
      }
    } catch (error) {
      remaining.push(payload)
      console.error('Failed to replay local message replacement', error)
    }
  }
  saveLocalReplaceRecoveryQueue(remaining)
  return { recoveredCount, remainingCount: remaining.length }
}
//通知主进程切换登录/注册窗口
const onLoginOnRegister = (mainWindow, callback) => {
  ipcMain.on('loginOrRegister', (e, isLogin) => {
    try {
      validateLoginOrRegister(isLogin)
    } catch (error) {
      console.error('IPC loginOrRegister rejected', error)
      return
    }
    callback(isLogin)
  })
}

//初始化用户数据，并启动ws
const onLoginSuccess = (mainWindow, callback) => {
  ipcMain.on('openChat', async (e, config) => {
    try {
      validateOpenChat(config)
      await deactivateUploadTasks()
      store.initUserId(config.userId)
      store.setUserData('token', config.token)
      await addUserSetting(config.userId, config.email)
      try {
        activateUploadTasks({ userId: config.userId, token: config.token, eventTarget: e.sender })
        const replaceRecovery = await recoverLocalReplaceQueue()
        if (replaceRecovery.recoveredCount) {
          logger.info(`Recovered local message replacements: ${replaceRecovery.recoveredCount}`)
        }
        const uploadRecovery = await resumePersistedUploadTasks({
          onTerminalStatus: async ({ messageId, succeeded }) => {
            await updateLocalMessageStatus({ messageId, status: succeeded ? 1 : 0 })
          }
        })
        const result = await recoverStalePendingMessages({
          excludeMessageIds: uploadRecovery?.protectedMessageIds || []
        })
        if (result?.recoveredCount) {
          logger.info(`Recovered stale pending messages: ${result.recoveredCount}`)
        }
      } catch (error) {
        console.error('Failed to recover stale pending messages', error)
      }
      await initWs(config, e.sender)
      setUploadTaskEventTarget(e.sender)
      callback(config)
    } catch (error) {
      console.error('IPC openChat failed', error)
    }
  })
}

const winTitleOp = (callback) => {
  ipcMain.on('winTitleOp', (e, data) => {
    try {
      validateWindowOperation(data)
    } catch (error) {
      console.error('IPC winTitleOp rejected', error)
      return
    }
    callback(e, data)
  })
}

const getErrorMessage = (error) => {
  return error?.message || String(error || 'unknown error')
}

const getErrorKind = (error) => {
  if (error?.kind) {
    return error.kind
  }
  const message = getErrorMessage(error).toLowerCase()
  if (message.includes('timeout')) {
    return 'timeout'
  }
  if (message.includes('database') || message.includes('sqlite') || message.includes('db')) {
    return 'db_error'
  }
  return 'ipc_error'
}

const buildValidationError = (message) => {
  const error = new Error(message)
  error.kind = 'validation_error'
  return error
}

const buildIpcErrorPayload = (callbackChannel, error, payload = {}) => {
  return {
    ...payload,
    success: false,
    channel: callbackChannel,
    kind: getErrorKind(error),
    error: getErrorMessage(error)
  }
}

const sendIpcError = (sender, callbackChannel, error, payload = {}) => {
  if (!sender || sender.isDestroyed?.()) {
    return
  }
  sender.send(callbackChannel, buildIpcErrorPayload(callbackChannel, error, payload))
}

const registerSafeIpcOn = (channel, callbackChannel, handler) => {
  ipcMain.on(channel, async (e, data) => {
    try {
      await handler(e, data)
    } catch (error) {
      console.error(`IPC ${channel} failed`, error)
      const context =
        error?.kind === 'validation_error' ? {} : data && typeof data === 'object' ? data : {}
      sendIpcError(e.sender, callbackChannel, error, context)
    }
  })
}

const registerSafeIpcHandle = (channel, handler) => {
  ipcMain.handle(channel, async (e, data) => {
    try {
      return await handler(e, data)
    } catch (error) {
      console.error(`IPC ${channel} failed`, error)
      return buildIpcErrorPayload(channel, error)
    }
  })
}

//存数据到主进程store
const onSetLocalStore = () => {
  ipcMain.on('SetLocalStore', (e, payload) => {
    try {
      validateStoreWrite(payload)
    } catch (error) {
      console.error('IPC SetLocalStore rejected', error)
      return
    }
    const { key, value } = payload
    store.setData(key, value)
  })
}

const onGetLocalStore = () => {
  ipcMain.on('GetLocalStore', (e, payload) => {
    try {
      validateStoreRead(payload)
    } catch (error) {
      console.error('IPC GetLocalStore rejected', error)
      e.sender.send(IPC_CALLBACK_CHANNELS.getLocalStore, undefined)
      return
    }
    const key = typeof payload === 'string' ? payload : payload.key
    try {
      const value = store.getData(key)
      e.sender.send(IPC_CALLBACK_CHANNELS.getLocalStore, value)
    } catch (error) {
      console.error('Failed to get local store data', error)
      e.sender.send(IPC_CALLBACK_CHANNELS.getLocalStore, undefined)
    }
  })
}

//查询本地会话列表
const onLoadSessionData = () => {
  registerSafeIpcOn('loadSessionData', IPC_CALLBACK_CHANNELS.loadSessionData, async (e) => {
    // renderer 左侧会话列表只读本地 SQLite，WebSocket/发送链路负责提前把会话写入表。
    try {
      const result = await selectUserSessionList()
      e.sender.send(IPC_CALLBACK_CHANNELS.loadSessionData, result)
    } catch (error) {
      // DB 读错误显式传播到 renderer，避免 renderer 将错误对象当作空列表。
      e.sender.send(
        IPC_CALLBACK_CHANNELS.loadSessionData,
        buildIpcErrorPayload(IPC_CALLBACK_CHANNELS.loadSessionData, error)
      )
    }
  })
}

// 仅保留带校验和统一错误回包的安全 IPC 监听器。

//分页查询聊天消息
const onDelChatSessionSafe = () => {
  registerSafeIpcOn(
    'delChatSession',
    IPC_CALLBACK_CHANNELS.deleteChatSession,
    async (e, contactId) => {
      validateContactId(contactId)
      try {
        await delChatSession(contactId)
        e.sender.send(IPC_CALLBACK_CHANNELS.deleteChatSession, {
          contactId,
          success: true
        })
      } catch (error) {
        sendIpcError(e.sender, IPC_CALLBACK_CHANNELS.deleteChatSession, error, { contactId })
      }
    }
  )
}

const onTopChatSessionSafe = () => {
  registerSafeIpcOn('topChatSession', IPC_CALLBACK_CHANNELS.topChatSession, async (e, data) => {
    validateTopChatSession(data)
    const { contactId, topType } = data
    await topChatSession(contactId, topType)
    e.sender.send(IPC_CALLBACK_CHANNELS.topChatSession, {
      contactId,
      topType,
      success: true
    })
  })
}

const onLoadChatMessage = () => {
  registerSafeIpcOn('loadChatMessage', IPC_CALLBACK_CHANNELS.loadChatMessage, async (e, data) => {
    validateLoadChatMessage(data)
    // 包裹 DB 查询以捕获错误，显式传播到 renderer。
    let result
    try {
      result = data?.targetMessageId
        ? {
            dataList: await selectMessageContextByMessageId({
              sessionId: data.sessionId,
              messageId: data.targetMessageId
            }),
            hasMore: true,
            targetMessageId: data.targetMessageId,
            loadMode: 'context'
          }
        : await selectMessageList(data)
    } catch (error) {
      e.sender.send(IPC_CALLBACK_CHANNELS.loadChatMessage, {
        ...buildIpcErrorPayload(IPC_CALLBACK_CHANNELS.loadChatMessage, error),
        sessionId: data?.sessionId,
        loadSeq: data?.loadSeq
      })
      return
    }
    e.sender.send(IPC_CALLBACK_CHANNELS.loadChatMessage, {
      ...result,
      sessionId: data?.sessionId,
      loadMode: data?.loadMode || result?.loadMode,
      loadSeq: data?.loadSeq
    })
  })
}

const onMarkSessionRead = () => {
  registerSafeIpcOn(
    'markSessionRead',
    IPC_CALLBACK_CHANNELS.markSessionRead,
    async (e, data = {}) => {
      validateMarkSessionRead(data)
      const contactId = typeof data === 'object' ? data.contactId : data
      const operationId = typeof data === 'object' ? data.operationId : undefined
      // 已读会同步清零本地会话未读数，renderer 收到新会话列表后红点也会随之刷新。
      await markSessionRead(contactId)
      e.sender.send(IPC_CALLBACK_CHANNELS.markSessionRead, {
        contactId,
        operationId,
        success: true
      })
    }
  )
}

const onResetToLogin = (_mainWindow, callback) => {
  const reset = async () => {
    await deactivateUploadTasks()
    await closeWs()
    callback()
    return true
  }

  ipcMain.handle('logout', async () => {
    return await reset()
  })

  ipcMain.on('reLogin', async () => {
    try {
      await reset()
    } catch (error) {
      console.error('reLogin reset failed', error)
    }
  })
}

const onUploadSources = () => {
  registerSafeIpcHandle('registerUploadSource', async (_e, data = {}) => {
    validateUploadSourceRegistration(data)
    return await registerUploadSource(data)
  })
  registerSafeIpcHandle('readUploadSourceChunk', async (_e, data = {}) => {
    validateUploadSourceChunk(data, MAX_CHUNK_SIZE)
    return await readUploadSourceChunk(data)
  })
  registerSafeIpcHandle('releaseUploadSource', async (_e, data = {}) => {
    validateUploadSourceId(data)
    return releaseUploadSource(data)
  })
  registerSafeIpcHandle('registerUploadCover', async (_e, data = {}) => {
    validateUploadCoverRegistration(data)
    return await registerUploadCover(data)
  })
  registerSafeIpcHandle('releaseUploadCover', async (_e, data = {}) => {
    validateUploadCoverId(data)
    return await releaseUploadCover(data)
  })
  registerSafeIpcHandle('generateUploadSourceThumbnail', async (_e, data = {}) => {
    validateUploadSourceId(data)
    return await generateUploadSourceThumbnail(data)
  })
}

const onUploadTasks = () => {
  registerSafeIpcHandle('enqueueUploadTask', async (_e, data = {}) => {
    validateEnqueueUploadTask(data)
    return enqueueUploadTask(data)
  })
  registerSafeIpcHandle('pauseUploadTask', async (_e, data = {}) => {
    validateUploadTaskMessageId(data)
    return pauseUploadTask(data)
  })
  registerSafeIpcHandle('resumeUploadTask', async (_e, data = {}) => {
    validateUploadTaskMessageId(data)
    return resumeUploadTask(data)
  })
  registerSafeIpcHandle('cancelUploadTask', async (_e, data = {}) => {
    validateUploadTaskMessageId(data)
    return cancelUploadTask(data)
  })
  registerSafeIpcHandle('acknowledgeUploadTask', async (_e, data = {}) => {
    validateUploadTaskMessageId(data)
    if (typeof data.succeeded !== 'boolean') throw buildValidationError('succeeded must be boolean')
    return acknowledgeUploadTask(data)
  })
}

//保存发送的消息到本地，并更新会话
const saveSendMessageToLocal = async ({
  message,
  chatSession,
  localMessageId,
  mode,
  status
} = {}) => {
  if (!message) {
    return {
      success: false,
      error: 'message is empty'
    }
  }

  if (mode === 'pending') {
    return await savePendingMessage({ message, chatSession })
  }

  if (mode === 'status') {
    return await updateLocalMessageStatus({
      messageId: message.messageId,
      status: status ?? message.status,
      chatSession
    })
  }

  return await replacePendingMessage({
    localMessageId,
    message,
    chatSession
  })
}

const onSaveSendMessage = () => {
  ipcMain.handle('saveSendMessage', async (_e, payload) => {
    try {
      validateSaveSendMessage(payload)
      const result = await saveSendMessageToLocal(payload)
      if (result?.success && payload?.mode === 'replace') {
        removeLocalReplaceRecovery(payload)
      }
      return result
    } catch (error) {
      let recoveryQueued = false
      if (error?.kind !== 'validation_error') {
        try {
          recoveryQueued = queueLocalReplaceRecovery(payload)
        } catch (recoveryError) {
          console.error('Failed to queue local message replacement recovery', recoveryError)
        }
      }
      return buildIpcErrorPayload('saveSendMessage', error, { recoveryQueued })
    }
  })
}

const onClearChatMessage = () => {
  registerSafeIpcOn(
    'clearChatMessage',
    IPC_CALLBACK_CHANNELS.clearChatMessage,
    async (e, data = {}) => {
      validateClearChatMessage(data)
      const { sessionId } = data
      try {
        // Clear cursor, message rows, and session summary must commit together.
        const session = await clearMessageAndSessionSummaryBySessionId(sessionId)
        e.sender.send(IPC_CALLBACK_CHANNELS.clearChatMessage, {
          success: true,
          sessionId,
          session
        })
      } catch (error) {
        e.sender.send(
          IPC_CALLBACK_CHANNELS.clearChatMessage,
          buildIpcErrorPayload(IPC_CALLBACK_CHANNELS.clearChatMessage, error, { sessionId })
        )
      }
    }
  )
}

const onSearchChatMessage = () => {
  registerSafeIpcOn(
    'searchChatMessage',
    IPC_CALLBACK_CHANNELS.searchChatMessage,
    async (e, data = {}) => {
      validateSearchChatMessage(data)
      // 搜索只查当前 session 的本地消息，并把 searchSeq 带回 renderer 丢弃过期结果。
      let dataList
      try {
        dataList = await searchMessageBySessionId(data)
      } catch (error) {
        e.sender.send(IPC_CALLBACK_CHANNELS.searchChatMessage, {
          ...buildIpcErrorPayload(IPC_CALLBACK_CHANNELS.searchChatMessage, error),
          sessionId: data.sessionId,
          keyword: data.keyword,
          searchSeq: data.searchSeq
        })
        return
      }
      e.sender.send(IPC_CALLBACK_CHANNELS.searchChatMessage, {
        sessionId: data.sessionId,
        keyword: data.keyword,
        searchSeq: data.searchSeq,
        dataList
      })
    }
  )
}

const onLocalFileFolder = () => {
  ipcMain.handle('getLocalFileFolder', async () => {
    return await getLocalFileFolder()
  })

  ipcMain.handle('changeLocalFileFolder', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择文件保存位置',
      properties: ['openDirectory', 'createDirectory']
    })

    if (result.canceled || !result.filePaths?.length) {
      return await getLocalFileFolder()
    }

    return await updateLocalFileFolder(result.filePaths[0])
  })

  ipcMain.handle('resetLocalFileFolder', async () => {
    return await resetLocalFileFolder()
  })

  ipcMain.handle('openLocalFileFolder', async () => {
    const folderInfo = await getLocalFileFolder()
    const error = await shell.openPath(folderInfo.localFileFolder)
    return {
      ...folderInfo,
      success: !error,
      error
    }
  })
}

const onOpenTempVideoFile = () => {
  registerSafeIpcHandle('openTempVideoFile', async (e, data = {}) => {
    // 没有本地原文件时，renderer 会把已下载视频 blob 交给主进程写入临时文件再打开。
    const { fileName = 'video.mp4', buffer } = data
    // 限制临时视频文件大小，防止 renderer 传入超大 blob 耗尽主进程内存。
    const MAX_TEMP_VIDEO_SIZE = 256 * 1024 * 1024
    validateTempVideo(data, MAX_TEMP_VIDEO_SIZE)

    const safeFileName = String(fileName).replace(/[\\/:*?"<>|]/g, '_')
    const tempFolder = getTempVideoFolder(app.getPath('temp'))
    fs.mkdirSync(tempFolder, { recursive: true })
    const filePath = path.join(tempFolder, `${Date.now()}_${safeFileName}`)
    await fs.promises.writeFile(filePath, Buffer.from(buffer))
    const error = await shell.openPath(filePath)

    return {
      success: !error,
      error,
      filePath
    }
  })

  registerSafeIpcHandle('readLocalVideoFile', async (e, data = {}) => {
    // 自己刚发送的视频可从本地路径读取，用于服务端文件尚未可下载时的预览回退。
    const { filePath } = data
    validateFilePathPayload(data)
    if (!filePath || !fs.existsSync(filePath)) {
      return {
        success: false,
        error: '本地视频文件不存在'
      }
    }
    if (!(await isCurrentUserMessageFilePath(filePath))) {
      return {
        success: false,
        kind: 'validation_error',
        error: '本地视频文件不属于当前用户消息'
      }
    }
    const stat = await fs.promises.stat(filePath)
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_LOCAL_VIDEO_READ_SIZE) {
      return {
        success: false,
        kind: 'validation_error',
        error: '本地视频文件大小不受支持'
      }
    }

    // 大视频文件异步读取，避免阻塞主进程事件循环。
    const buffer = await fs.promises.readFile(filePath)
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    )
    return {
      success: true,
      arrayBuffer,
      fileSize: buffer.length
    }
  })

  registerSafeIpcHandle('openLocalVideoFile', async (e, data = {}) => {
    // 系统播放器入口优先打开本地原文件，避免重复下载大视频。
    const { filePath } = data
    validateFilePathPayload(data)
    if (!filePath || !fs.existsSync(filePath)) {
      return {
        success: false,
        error: '本地视频文件不存在'
      }
    }
    if (!(await isCurrentUserMessageFilePath(filePath))) {
      return {
        success: false,
        kind: 'validation_error',
        error: '本地视频文件不属于当前用户消息'
      }
    }

    const error = await shell.openPath(filePath)
    return {
      success: !error,
      error
    }
  })
}

const activeDownloads = new Map()

const sanitizeFileName = (fileName = 'download') => {
  const safeName = String(fileName || 'download').replace(/[\\/:*?"<>|]/g, '_')
  return safeName.trim() || 'download'
}

const resolveConflictFilePath = (folder, fileName) => {
  const safeName = sanitizeFileName(fileName)
  const ext = path.extname(safeName)
  const base = path.basename(safeName, ext)
  let targetPath = path.join(folder, safeName)
  let index = 1
  while (fs.existsSync(targetPath)) {
    targetPath = path.join(folder, `${base} (${index})${ext}`)
    index += 1
  }
  return targetPath
}

const MAX_DOWNLOAD_REDIRECTS = 10

const addHttpOrigin = (origins, value, label) => {
  if (!value) {
    return
  }
  try {
    const parsed = new URL(value)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      origins.add(parsed.origin)
    }
  } catch (error) {
    console.error(`Invalid configured download domain: ${label}`, error)
  }
}

const getAllowedDownloadOrigins = () => {
  const domainKeys =
    NODE_ENV === 'development' ? ['devDomain', 'prodDomain'] : ['prodDomain', 'devDomain']
  const origins = new Set()
  domainKeys.forEach((key) => {
    addHttpOrigin(origins, store.getData(key), key)
  })
  if (NODE_ENV === 'development') {
    addHttpOrigin(origins, process.env.ELECTRON_RENDERER_URL, 'ELECTRON_RENDERER_URL')
    DEFAULT_DEV_RENDERER_DOWNLOAD_ORIGINS.forEach((origin) =>
      addHttpOrigin(origins, origin, 'default dev renderer origin')
    )
  }
  return origins
}

const validateDownloadUrlOrigin = (url, allowedOrigins = getAllowedDownloadOrigins()) => {
  const normalizedUrl = validateHttpUrl(url)
  const parsedUrl = new URL(normalizedUrl)
  if (!allowedOrigins.has(parsedUrl.origin)) {
    throw buildValidationError('Download URL origin is not allowed')
  }
  return normalizedUrl
}

const isPathWithinFolder = async (filePath, folderPath) => {
  const [realFilePath, realFolderPath] = await Promise.all([
    fs.promises.realpath(filePath),
    fs.promises.realpath(folderPath)
  ])
  const relativePath = path.relative(realFolderPath, realFilePath)
  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

const downloadToFile = ({
  e,
  fileName,
  fileSize,
  maxSize,
  messageId,
  url,
  allowedOrigins,
  _redirectDepth = 0
}) => {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result) => {
      if (settled) {
        return
      }
      settled = true
      activeDownloads.delete(String(messageId))
      resolve(result)
    }

    // 初始化、URL 解析或网络创建失败时统一清理活动下载状态。
    ;(async () => {
      if (_redirectDepth >= MAX_DOWNLOAD_REDIRECTS) {
        finish({ success: false, error: 'Download failed: too many redirects' })
        return
      }
      const normalizedUrl = validateDownloadUrlOrigin(url, allowedOrigins)
      const folderInfo = await getLocalFileFolder()
      const targetPath = resolveConflictFilePath(folderInfo.localFileFolder, fileName)
      const tempPath = `${targetPath}.download`
      const transport = normalizedUrl.startsWith('https:') ? https : http
      const request = transport.get(normalizedUrl, (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume()
          try {
            const redirectUrl = new URL(response.headers.location, normalizedUrl).toString()
            validateDownloadUrlOrigin(redirectUrl, allowedOrigins)
            downloadToFile({
              e,
              fileName,
              fileSize,
              maxSize,
              messageId,
              url: redirectUrl,
              allowedOrigins,
              _redirectDepth: _redirectDepth + 1
            })
              .then(finish)
              .catch((error) => {
                finish({ success: false, error: getErrorMessage(error) })
              })
            } catch (error) {
              finish({
                success: false,
                ...(error?.kind ? { kind: error.kind } : {}),
                error: `Download redirect rejected: ${getErrorMessage(error)}`
              })
            }
          return
        }

        if (response.statusCode !== 200 && response.statusCode !== 206) {
          response.resume()
          finish({ success: false, error: `Download failed: HTTP ${response.statusCode}` })
          return
        }

        const contentLength = Number(response.headers['content-length'] || 0)
        const expectedSize = Number(fileSize || contentLength || 0)
        const limit = Number(maxSize || 0)
        if ((limit && contentLength > limit) || (limit && expectedSize > limit)) {
          response.resume()
          finish({ success: false, error: 'File is too large to download safely.' })
          return
        }

        const output = fs.createWriteStream(tempPath)
        let downloaded = 0
        let downloadTimeout = setTimeout(() => {
          request.destroy(new Error('Download timed out: no data received for 30 seconds'))
        }, 30000)
        const finishDownload = (result) => {
          if (downloadTimeout) {
            clearTimeout(downloadTimeout)
            downloadTimeout = null
          }
          finish(result)
        }

        response.on('data', (chunk) => {
          //  收到数据后重置超时定时器
          if (downloadTimeout) {
            clearTimeout(downloadTimeout)
            downloadTimeout = setTimeout(() => {
              request.destroy(new Error('Download timed out: no data received for 30 seconds'))
            }, 30000)
          }
          downloaded += chunk.length
          if (limit && downloaded > limit) {
            request.destroy(new Error('File is too large to download safely.'))
            return
          }
          const total = expectedSize || contentLength
          const progress = total ? Math.min(99, Math.round((downloaded / total) * 100)) : 0
          e.sender.send('downloadChatFileProgress', {
            messageId,
            progress,
            loaded: downloaded,
            total
          })
        })

        response.pipe(output)
        output.on('finish', () => {
          output.close(() => {
            try {
              fs.renameSync(tempPath, targetPath)
              e.sender.send('downloadChatFileProgress', { messageId, progress: 100 })
              finishDownload({ success: true, filePath: targetPath, progress: 100 })
            } catch (error) {
              finishDownload({ success: false, error: getErrorMessage(error) })
            }
          })
        })
        output.on('error', (error) => {
          try {
            fs.unlinkSync(tempPath)
          } catch (e) {
            // Best-effort cleanup after stream failure.
          }
          finishDownload({ success: false, error: getErrorMessage(error) })
        })
        //  处理响应流错误，清理临时文件
        response.on('error', (error) => {
          try {
            if (fs.existsSync(tempPath)) {
              fs.unlinkSync(tempPath)
            }
          } catch (e) {
            // Best-effort cleanup after response failure.
          }
          finishDownload({ success: false, error: getErrorMessage(error) })
        })
      })

      activeDownloads.set(String(messageId), request)
      request.on('error', (error) => {
        try {
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath)
          }
        } catch (e) {
          // Best-effort cleanup after request failure.
        }
        finish({ success: false, error: getErrorMessage(error) })
      })
    })().catch((error) => {
      finish({ success: false, error: getErrorMessage(error) })
    })
  })
}

const onChatFileDownload = () => {
  registerSafeIpcHandle('downloadChatFile', async (e, data = {}) => {
    validateDownload(data)
    const { fileName, fileSize, maxSize, messageId, url } = data
    const allowedOrigins = getAllowedDownloadOrigins()
    validateDownloadUrlOrigin(url, allowedOrigins)
    if (activeDownloads.has(String(messageId))) {
      return {
        success: false,
        error: 'File is already downloading'
      }
    }
    return await downloadToFile({ e, fileName, fileSize, maxSize, messageId, url, allowedOrigins })
  })

  registerSafeIpcHandle('cancelDownloadChatFile', async (_e, data = {}) => {
    validateDownloadId(data)
    const request = activeDownloads.get(String(data.messageId || ''))
    if (request) {
      request.destroy(new Error('Download canceled'))
      activeDownloads.delete(String(data.messageId))
    }
    // 清理取消下载时残留的临时文件
    try {
      const folderInfo = await getLocalFileFolder()
      const tempPattern = String(data.messageId || '')
      if (tempPattern && folderInfo?.localFileFolder) {
        const files = fs.readdirSync(folderInfo.localFileFolder)
        for (const file of files) {
          if (file.endsWith('.download') && file.includes(tempPattern)) {
            try {
              fs.unlinkSync(path.join(folderInfo.localFileFolder, file))
            } catch (e) {
              // Best-effort cleanup for canceled downloads.
            }
          }
        }
      }
    } catch (e) {
      // Cancel remains successful even if temporary-file cleanup fails.
    }
    return { success: true }
  })

  registerSafeIpcHandle('openDownloadedFile', async (_e, data = {}) => {
    validateFilePathPayload(data)
    if (!data.filePath || !fs.existsSync(data.filePath)) {
      return {
        success: false,
        error: 'File does not exist'
      }
    }
    const folderInfo = await getLocalFileFolder()
    if (!(await isPathWithinFolder(data.filePath, folderInfo.localFileFolder))) {
      return {
        success: false,
        kind: 'validation_error',
        error: 'File is outside the configured download folder'
      }
    }
    const error = await shell.openPath(data.filePath)
    return {
      success: !error,
      error
    }
  })

  registerSafeIpcHandle('showDownloadedFileInFolder', async (_e, data = {}) => {
    validateFilePathPayload(data)
    if (!data.filePath || !fs.existsSync(data.filePath)) {
      return {
        success: false,
        error: 'File does not exist'
      }
    }
    const folderInfo = await getLocalFileFolder()
    if (!(await isPathWithinFolder(data.filePath, folderInfo.localFileFolder))) {
      return {
        success: false,
        kind: 'validation_error',
        error: 'File is outside the configured download folder'
      }
    }
    shell.showItemInFolder(data.filePath)
    return { success: true }
  })
}
export {
  onLoginOnRegister,
  onLoginSuccess,
  onResetToLogin,
  winTitleOp,
  onSetLocalStore,
  onGetLocalStore,
  onLoadSessionData,
  onDelChatSessionSafe as onDelChatSession,
  onMarkSessionRead,
  onTopChatSessionSafe as onTopChatSession,
  onLoadChatMessage,
  onSaveSendMessage,
  onClearChatMessage,
  onSearchChatMessage,
  onUploadSources,
  onUploadTasks,
  onLocalFileFolder,
  onOpenTempVideoFile,
  onChatFileDownload
}
