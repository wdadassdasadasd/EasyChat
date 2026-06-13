import { app, dialog, ipcMain, shell } from 'electron'
import fs from 'fs'
import http from 'http'
import https from 'https'
import path from 'path'
import { initWs, closeWs } from './wsClient.js'
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
  replacePendingMessage,
  recoverStalePendingMessages,
  savePendingMessage,
  searchMessageBySessionId,
  selectMessageContextByMessageId,
  selectMessageList,
  updateLocalMessageStatus
} from './db/ChatMessageModel.js'
import {
  generateUploadSourceThumbnail,
  readUploadSourceChunk,
  registerUploadSource,
  releaseUploadSource
} from './uploadSourceRegistry.js'

const LOCAL_REPLACE_RECOVERY_KEY = 'localReplaceRecoveryQueue'
const MAX_LOCAL_REPLACE_RECOVERY_ITEMS = 100

const getLocalReplaceRecoveryQueue = () => {
  const queue = store.getUserData(LOCAL_REPLACE_RECOVERY_KEY)
  return Array.isArray(queue) ? queue : []
}

const saveLocalReplaceRecoveryQueue = (queue) => {
  if (queue.length === 0) {
    store.deleteUserData(LOCAL_REPLACE_RECOVERY_KEY)
    return
  }
  store.setUserData(
    LOCAL_REPLACE_RECOVERY_KEY,
    queue.slice(-MAX_LOCAL_REPLACE_RECOVERY_ITEMS)
  )
}

const getLocalReplaceRecoveryId = (payload = {}) => {
  return `${payload.localMessageId ?? ''}:${payload.message?.messageId ?? ''}`
}

const queueLocalReplaceRecovery = (payload = {}) => {
  if (payload.mode !== 'replace' || !payload.localMessageId || !payload.message?.messageId) {
    return false
  }
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
    callback(isLogin)
  })
}

//初始化用户数据，并启动ws
const onLoginSuccess = (mainWindow, callback) => {
  ipcMain.on('openChat', async (e, config) => {
    store.initUserId(config.userId)
    store.setUserData('token', config.token)
    await addUserSetting(config.userId, config.email)
    try {
      const replaceRecovery = await recoverLocalReplaceQueue()
      if (replaceRecovery.recoveredCount) {
        console.log(`Recovered local message replacements: ${replaceRecovery.recoveredCount}`)
      }
      const result = await recoverStalePendingMessages()
      if (result?.recoveredCount) {
        console.log(`Recovered stale pending messages: ${result.recoveredCount}`)
      }
    } catch (error) {
      console.error('Failed to recover stale pending messages', error)
    }
    await initWs(config, e.sender)
    callback(config)
  })
}

const winTitleOp = (callback) => {
  ipcMain.on('winTitleOp', (e, data) => {
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
      sendIpcError(e.sender, callbackChannel, error, data && typeof data === 'object' ? data : {})
    }
  })
}

//存数据到主进程store
const onSetLocalStore = () => {
  ipcMain.on('SetLocalStore', (e, { key, value }) => {
    store.setData(key, value)
  })
}

const onGetLocalStore = () => {
  ipcMain.on('GetLocalStore', (e, payload) => {
    const key = typeof payload === 'string' ? payload : payload?.key
    if (!key) {
      return
    }
    try {
      const value = store.getData(key)
      e.sender.send('getLocalStoreCallback', value)
    } catch (error) {
      console.error('Failed to get local store data', error)
      e.sender.send('getLocalStoreCallback', undefined)
    }
  })
}

//查询本地会话列表
const onLoadSessionData = () => {
  registerSafeIpcOn('loadSessionData', 'loadSessionDataCallback', async (e) => {
    // renderer 左侧会话列表只读本地 SQLite，WebSocket/发送链路负责提前把会话写入表。
    try {
      const result = await selectUserSessionList()
      e.sender.send('loadSessionDataCallback', result)
    } catch (error) {
      // P0-3: DB 读错误显式传播到 renderer，避免 renderer 将错误对象当作空列表
      e.sender.send('loadSessionDataCallback', buildIpcErrorPayload('loadSessionDataCallback', error))
    }
  })
}

// H-10: 移除不安全的重复 IPC 监听器，仅保留 Safe 版本

//分页查询聊天消息
const onDelChatSessionSafe = () => {
  registerSafeIpcOn('delChatSession', 'delChatSessionCallback', async (e, contactId) => {
    await delChatSession(contactId)
    e.sender.send('delChatSessionCallback', {
      contactId,
      success: true
    })
  })
}

const onTopChatSessionSafe = () => {
  registerSafeIpcOn(
    'topChatSession',
    'topChatSessionCallback',
    async (e, { contactId, topType }) => {
      await topChatSession(contactId, topType)
      e.sender.send('topChatSessionCallback', {
        contactId,
        topType,
        success: true
      })
    }
  )
}

const onLoadChatMessage = () => {
  registerSafeIpcOn('loadChatMessage', 'loadChatMessageCallback', async (e, data) => {
    // P0-3: 包裹 DB 查询以捕获错误，显式传播到 renderer
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
      e.sender.send('loadChatMessageCallback', {
        ...buildIpcErrorPayload('loadChatMessageCallback', error),
        sessionId: data?.sessionId,
        loadSeq: data?.loadSeq
      })
      return
    }
    e.sender.send('loadChatMessageCallback', {
      ...result,
      sessionId: data?.sessionId,
      loadMode: data?.loadMode || result?.loadMode,
      loadSeq: data?.loadSeq
    })
  })
}

const onMarkSessionRead = () => {
  registerSafeIpcOn('markSessionRead', 'markSessionReadCallback', async (e, data = {}) => {
    const contactId = typeof data === 'object' ? data.contactId : data
    const operationId = typeof data === 'object' ? data.operationId : undefined
    // 已读会同步清零本地会话未读数，renderer 收到新会话列表后红点也会随之刷新。
    await markSessionRead(contactId)
    e.sender.send('markSessionReadCallback', {
      contactId,
      operationId,
      success: true
    })
  })
}

const onResetToLogin = (_mainWindow, callback) => {
  const reset = async () => {
    await closeWs()
    callback()
    return true
  }

  ipcMain.handle('logout', async () => {
    return await reset()
  })

  ipcMain.on('reLogin', async () => {
    await reset()
  })
}

const onUploadSources = () => {
  ipcMain.handle('registerUploadSource', async (_e, data = {}) => {
    return await registerUploadSource(data)
  })
  ipcMain.handle('readUploadSourceChunk', async (_e, data = {}) => {
    return await readUploadSourceChunk(data)
  })
  ipcMain.handle('releaseUploadSource', async (_e, data = {}) => {
    return releaseUploadSource(data)
  })
  ipcMain.handle('generateUploadSourceThumbnail', async (_e, data = {}) => {
    return await generateUploadSourceThumbnail(data)
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
      const result = await saveSendMessageToLocal(payload)
      if (result?.success && payload?.mode === 'replace') {
        removeLocalReplaceRecovery(payload)
      }
      return result
    } catch (error) {
      let recoveryQueued = false
      try {
        recoveryQueued = queueLocalReplaceRecovery(payload)
      } catch (recoveryError) {
        console.error('Failed to queue local message replacement recovery', recoveryError)
      }
      return buildIpcErrorPayload('saveSendMessage', error, { recoveryQueued })
    }
  })
}

const onClearChatMessage = () => {
  registerSafeIpcOn(
    'clearChatMessage',
    'clearChatMessageCallback',
    async (e, { sessionId } = {}) => {
      try {
        // Clear cursor, message rows, and session summary must commit together.
        const session = await clearMessageAndSessionSummaryBySessionId(sessionId)
        e.sender.send('clearChatMessageCallback', {
          success: true,
          sessionId,
          session
        })
      } catch (error) {
        e.sender.send(
          'clearChatMessageCallback',
          buildIpcErrorPayload('clearChatMessageCallback', error, { sessionId })
        )
      }
    }
  )
}

const onSearchChatMessage = () => {
  registerSafeIpcOn('searchChatMessage', 'searchChatMessageCallback', async (e, data = {}) => {
    // 搜索只查当前 session 的本地消息，并把 searchSeq 带回 renderer 丢弃过期结果。
    let dataList
    try {
      dataList = await searchMessageBySessionId(data)
    } catch (error) {
      e.sender.send('searchChatMessageCallback', {
        ...buildIpcErrorPayload('searchChatMessageCallback', error),
        sessionId: data.sessionId,
        keyword: data.keyword,
        searchSeq: data.searchSeq
      })
      return
    }
    e.sender.send('searchChatMessageCallback', {
      sessionId: data.sessionId,
      keyword: data.keyword,
      searchSeq: data.searchSeq,
      dataList
    })
  })
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
  ipcMain.handle('openTempVideoFile', async (e, data = {}) => {
    // 没有本地原文件时，renderer 会把已下载视频 blob 交给主进程写入临时文件再打开。
    const { fileName = 'video.mp4', buffer } = data
    // M-4: 限制临时视频文件大小，防止内存耗尽
    const MAX_TEMP_VIDEO_SIZE = 256 * 1024 * 1024
    if (buffer && Buffer.byteLength(buffer) > MAX_TEMP_VIDEO_SIZE) {
      return {
        success: false,
        error: '视频文件过大，请直接下载后打开'
      }
    }
    if (!buffer) {
      return {
        success: false,
        error: '视频数据为空'
      }
    }

    const safeFileName = String(fileName).replace(/[\\/:*?"<>|]/g, '_')
    const tempFolder = path.join(app.getPath('temp'), 'EasyChat', 'video-preview')
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

  ipcMain.handle('readLocalVideoFile', async (e, data = {}) => {
    // 自己刚发送的视频可从本地路径读取，用于服务端文件尚未可下载时的预览回退。
    const { filePath } = data
    if (!filePath || !fs.existsSync(filePath)) {
      return {
        success: false,
        error: '本地视频文件不存在'
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

  ipcMain.handle('openLocalVideoFile', async (e, data = {}) => {
    // 系统播放器入口优先打开本地原文件，避免重复下载大视频。
    const { filePath } = data
    if (!filePath || !fs.existsSync(filePath)) {
      return {
        success: false,
        error: '本地视频文件不存在'
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

const downloadToFile = ({ e, fileName, fileSize, maxSize, messageId, url, _redirectDepth = 0 }) => {
  return new Promise((resolve) => {
    // H-6: 使用立即调用的 async IIFE 替代 async executor 反模式
    // 若 IIFE 同步抛出，reject 仍被安全捕获
    ;(async () => {
      if (_redirectDepth >= MAX_DOWNLOAD_REDIRECTS) {
        resolve({ success: false, error: 'Download failed: too many redirects' })
        return
      }
      const folderInfo = await getLocalFileFolder()
      const targetPath = resolveConflictFilePath(folderInfo.localFileFolder, fileName)
      const tempPath = `${targetPath}.download`
      const transport = String(url).startsWith('https:') ? https : http
      const request = transport.get(url, (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume()
          resolve(
            downloadToFile({
              e,
              fileName,
              fileSize,
              maxSize,
              messageId,
              url: response.headers.location,
              _redirectDepth: _redirectDepth + 1
            })
          )
          return
        }

        if (response.statusCode !== 200 && response.statusCode !== 206) {
          response.resume()
          resolve({ success: false, error: `Download failed: HTTP ${response.statusCode}` })
          return
        }

        const contentLength = Number(response.headers['content-length'] || 0)
        const expectedSize = Number(fileSize || contentLength || 0)
        const limit = Number(maxSize || 0)
        if ((limit && contentLength > limit) || (limit && expectedSize > limit)) {
          response.resume()
          resolve({ success: false, error: 'File is too large to download safely.' })
          return
        }

        const output = fs.createWriteStream(tempPath)
        let downloaded = 0
        let settled = false
        let downloadTimeout = setTimeout(() => {
          request.destroy(new Error('Download timed out: no data received for 30 seconds'))
        }, 30000)
        const finish = (result) => {
          if (settled) {
            return
          }
          settled = true
          if (downloadTimeout) {
            clearTimeout(downloadTimeout)
            downloadTimeout = null
          }
          activeDownloads.delete(String(messageId))
          resolve(result)
        }

        response.on('data', (chunk) => {
          // H-4: 收到数据后重置超时定时器
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
              finish({ success: true, filePath: targetPath, progress: 100 })
            } catch (error) {
              finish({ success: false, error: getErrorMessage(error) })
            }
          })
        })
        output.on('error', (error) => {
          try {
            fs.unlinkSync(tempPath)
          } catch (e) {
            // Best-effort cleanup after stream failure.
          }
          finish({ success: false, error: getErrorMessage(error) })
        })
        // M-2: 处理响应流错误，清理临时文件
        response.on('error', (error) => {
          try {
            if (fs.existsSync(tempPath)) {
              fs.unlinkSync(tempPath)
            }
          } catch (e) {
            // Best-effort cleanup after response failure.
          }
          finish({ success: false, error: getErrorMessage(error) })
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
        activeDownloads.delete(String(messageId))
        resolve({ success: false, error: getErrorMessage(error) })
      })
    })()
  })
}

const onChatFileDownload = () => {
  ipcMain.handle('downloadChatFile', async (e, data = {}) => {
    const { fileName, fileSize, maxSize, messageId, url } = data
    if (!url || !messageId) {
      return {
        success: false,
        error: 'Download url or messageId is empty'
      }
    }
    if (activeDownloads.has(String(messageId))) {
      return {
        success: false,
        error: 'File is already downloading'
      }
    }
    return await downloadToFile({ e, fileName, fileSize, maxSize, messageId, url })
  })

  ipcMain.handle('cancelDownloadChatFile', async (_e, data = {}) => {
    const request = activeDownloads.get(String(data.messageId || ''))
    if (request) {
      request.destroy(new Error('Download canceled'))
      activeDownloads.delete(String(data.messageId))
    }
    // H-5: 清理取消下载时残留的临时文件
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

  ipcMain.handle('openDownloadedFile', async (_e, data = {}) => {
    if (!data.filePath || !fs.existsSync(data.filePath)) {
      return {
        success: false,
        error: 'File does not exist'
      }
    }
    const error = await shell.openPath(data.filePath)
    return {
      success: !error,
      error
    }
  })

  ipcMain.handle('showDownloadedFileInFolder', async (_e, data = {}) => {
    if (!data.filePath || !fs.existsSync(data.filePath)) {
      return {
        success: false,
        error: 'File does not exist'
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
  onLocalFileFolder,
  onOpenTempVideoFile,
  onChatFileDownload
}
