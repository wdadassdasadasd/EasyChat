import { app, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'child_process'
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
  topChatSession,
  clearChatSessionSummaryBySessionId
} from './db/ChatSessionUserModel.js'
import {
  clearMessageBySessionId,
  replacePendingMessage,
  savePendingMessage,
  searchMessageBySessionId,
  selectMessageContextByMessageId,
  selectMessageList,
  updateLocalMessageStatus
} from './db/ChatMessageModel.js'
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
    callback(config)
    initWs(config, e.sender)
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

const sendIpcError = (sender, callbackChannel, error, payload = {}) => {
  if (!sender || sender.isDestroyed?.()) {
    return
  }
  sender.send(callbackChannel, {
    ...payload,
    success: false,
    channel: callbackChannel,
    error: getErrorMessage(error)
  })
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
    const result = await selectUserSessionList()
    e.sender.send('loadSessionDataCallback', result)
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
    // 历史消息分页在主进程完成，sessionId/loadSeq 原样带回给 renderer 做防串线校验。
    const result = data?.targetMessageId
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
    e.sender.send('loadChatMessageCallback', {
      ...result,
      sessionId: data?.sessionId,
      loadMode: data?.loadMode || result?.loadMode,
      loadSeq: data?.loadSeq
    })
  })
}

const onMarkSessionRead = () => {
  registerSafeIpcOn('markSessionRead', 'markSessionReadCallback', async (e, contactId) => {
    // 已读会同步清零本地会话未读数，renderer 收到新会话列表后红点也会随之刷新。
    await markSessionRead(contactId)
    e.sender.send('markSessionReadCallback', {
      contactId,
      success: true
    })
  })
}

const onResetToLogin = (_mainWindow, callback) => {
  const reset = () => {
    closeWs()
    callback()
    return true
  }

  ipcMain.handle('logout', () => {
    return reset()
  })

  ipcMain.on('reLogin', () => {
    reset()
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
      return await saveSendMessageToLocal(payload)
    } catch (error) {
      return {
        success: false,
        channel: 'saveSendMessage',
        error: getErrorMessage(error)
      }
    }
  })
}

const onClearChatMessage = () => {
  registerSafeIpcOn(
    'clearChatMessage',
    'clearChatMessageCallback',
    async (e, { sessionId } = {}) => {
      try {
        // 清空记录写入 clear 游标后删除当前本地消息，后续旧 WebSocket 回补会被过滤。
        await clearMessageBySessionId(sessionId)
        const session = await clearChatSessionSummaryBySessionId(sessionId)
        e.sender.send('clearChatMessageCallback', {
          success: true,
          sessionId,
          session
        })
      } catch (error) {
        e.sender.send('clearChatMessageCallback', {
          success: false,
          sessionId,
          error: error?.message || String(error)
        })
      }
    }
  )
}

const onSearchChatMessage = () => {
  registerSafeIpcOn('searchChatMessage', 'searchChatMessageCallback', async (e, data = {}) => {
    // 搜索只查当前 session 的本地消息，并把 searchSeq 带回 renderer 丢弃过期结果。
    const dataList = await searchMessageBySessionId(data)
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

// M-13: ffmpeg 视频封面提取，若系统未安装 ffmpeg 则返回失败由渲染进程降级处理
ipcMain.handle('generateVideoThumbnail', async (_e, data = {}) => {
  const { filePath } = data
  if (!filePath || !fs.existsSync(filePath)) {
    return { success: false, error: 'File not found' }
  }

  return new Promise((resolve) => {
    const chunks = []
    const ffmpeg = spawn('ffmpeg', [
      '-i',
      filePath,
      '-ss',
      '00:00:01',
      '-vframes',
      '1',
      '-f',
      'image2pipe',
      '-vcodec',
      'mjpeg',
      '-'
    ])

    ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk))
    ffmpeg.stdout.on('end', () => {
      const buffer = Buffer.concat(chunks)
      if (buffer.length > 0) {
        const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
        resolve({ success: true, arrayBuffer: ab })
      }
    })

    ffmpeg.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })

    ffmpeg.on('close', (code) => {
      if (code !== 0 && chunks.length === 0) {
        resolve({ success: false, error: `ffmpeg exited with code ${code}` })
      }
    })
  })
})

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
          } catch (e) {}
          finish({ success: false, error: getErrorMessage(error) })
        })
        // M-2: 处理响应流错误，清理临时文件
        response.on('error', (error) => {
          try {
            if (fs.existsSync(tempPath)) {
              fs.unlinkSync(tempPath)
            }
          } catch (e) {}
          finish({ success: false, error: getErrorMessage(error) })
        })
      })

      activeDownloads.set(String(messageId), request)
      request.on('error', (error) => {
        try {
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath)
          }
        } catch (e) {}
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
            } catch (e) {}
          }
        }
      }
    } catch (e) {}
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
  onLocalFileFolder,
  onOpenTempVideoFile,
  onChatFileDownload
}
