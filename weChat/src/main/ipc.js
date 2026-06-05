import { app, dialog, ipcMain, shell } from 'electron'
import fs from 'fs'
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
  ipcMain.on('openChat', (e, config) => {
    store.initUserId(config.userId)
    store.setUserData('token', config.token)
    addUserSetting(config.userId, config.email)
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
    const value = store.getData(key)
    console.log('收到渲染进程的获取事件Key:', key)
    e.sender.send('getLocalStoreCallback', value)
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

const onDelChatSession = () => {
  ipcMain.on('delChatSession', (e, contactId) => {
    // 删除会话仅把会话置为不可见，不删除 chat_message 历史记录。
    delChatSession(contactId)
  })
}

const onTopChatSession = () => {
  ipcMain.on('topChatSession', (e, { contactId, topType }) => {
    // 置顶状态由 renderer 乐观更新，这里负责把结果持久化。
    topChatSession(contactId, topType)
  })
}

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
  registerSafeIpcOn('topChatSession', 'topChatSessionCallback', async (e, { contactId, topType }) => {
    await topChatSession(contactId, topType)
    e.sender.send('topChatSessionCallback', {
      contactId,
      topType,
      success: true
    })
  })
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
    fs.writeFileSync(filePath, Buffer.from(buffer))
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
  onOpenTempVideoFile
}
