import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC_CALLBACK_CHANNELS } from '../shared/ipcChannels.js'

// 预加载层只暴露业务白名单 API，不再暴露完整 ipcRenderer。
// 所有 IPC 调用通过命名方法转发，renderer 无法访问任意 channel。
// sandbox: true 后 preload 仍可 import electron 内置模块。

// --- 白名单定义 ---
const ALLOWED_SEND_CHANNELS = new Set([
  'loadSessionData',
  'markSessionRead',
  'delChatSession',
  'topChatSession',
  'loadChatMessage',
  'clearChatMessage',
  'searchChatMessage',
  'SetLocalStore',
  'loginOrRegister',
  'openChat',
  'winTitleOp',
  'reLogin'
])

const ALLOWED_INVOKE_CHANNELS = new Set([
  'saveSendMessage',
  'logout',
  'getLocalFileFolder',
  'changeLocalFileFolder',
  'resetLocalFileFolder',
  'openLocalFileFolder',
  'openTempVideoFile',
  'readLocalVideoFile',
  'openLocalVideoFile',
  'registerUploadSource',
  'readUploadSourceChunk',
  'releaseUploadSource',
  'generateUploadSourceThumbnail',
  'downloadChatFile',
  'cancelDownloadChatFile',
  'openDownloadedFile',
  'showDownloadedFileInFolder'
])

const ALLOWED_LISTEN_CHANNELS = new Set([
  'receiveMessage',
  'receiveMessageBatch',
  IPC_CALLBACK_CHANNELS.loadChatMessage,
  IPC_CALLBACK_CHANNELS.loadSessionData,
  IPC_CALLBACK_CHANNELS.deleteChatSession,
  IPC_CALLBACK_CHANNELS.markSessionRead,
  IPC_CALLBACK_CHANNELS.topChatSession,
  IPC_CALLBACK_CHANNELS.clearChatMessage,
  IPC_CALLBACK_CHANNELS.searchChatMessage,
  'wsStatusChange',
  'winStateChange',
  'downloadChatFileProgress'
])

// --- 白名单 IPC 底层实现 ---
const electronAPI = {
  ipcSend(channel, ...args) {
    if (!ALLOWED_SEND_CHANNELS.has(channel)) {
      console.error(`IPC send blocked: channel "${channel}" not in allowlist`)
      return
    }
    ipcRenderer.send(channel, ...args)
  },
  ipcInvoke(channel, ...args) {
    if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`IPC invoke blocked: channel "${channel}" not in allowlist`))
    }
    return ipcRenderer.invoke(channel, ...args)
  },
  ipcOn(channel, listener) {
    if (!ALLOWED_LISTEN_CHANNELS.has(channel)) {
      console.error(`IPC on blocked: channel "${channel}" not in allowlist`)
      return () => {}
    }
    const wrappedListener = (_event, ...args) => listener(...args)
    ipcRenderer.on(channel, wrappedListener)
    return () => ipcRenderer.removeListener(channel, wrappedListener)
  }
}

// --- 业务 API：命名方法封装所有 IPC 调用，renderer 只通过 api 对象交互 ---
const api = {
  // --- Fire-and-forget (ipcRenderer.send) ---
  sendLoadSessionData() {
    electronAPI.ipcSend('loadSessionData')
  },
  sendMarkSessionRead(data) {
    electronAPI.ipcSend('markSessionRead', data)
  },
  sendDelChatSession(contactId) {
    electronAPI.ipcSend('delChatSession', contactId)
  },
  sendTopChatSession(data) {
    electronAPI.ipcSend('topChatSession', data)
  },
  sendLoadChatMessage(data) {
    electronAPI.ipcSend('loadChatMessage', data)
  },
  sendClearChatMessage(data) {
    electronAPI.ipcSend('clearChatMessage', data)
  },
  sendSearchChatMessage(data) {
    electronAPI.ipcSend('searchChatMessage', data)
  },
  sendSetLocalStore(data) {
    electronAPI.ipcSend('SetLocalStore', data)
  },
  sendLoginOrRegister(isLogin) {
    electronAPI.ipcSend('loginOrRegister', isLogin)
  },
  sendOpenChat(data) {
    electronAPI.ipcSend('openChat', data)
  },
  sendWinTitleOp(data) {
    electronAPI.ipcSend('winTitleOp', data)
  },
  sendReLogin() {
    electronAPI.ipcSend('reLogin')
  },

  // --- Request-response (ipcRenderer.invoke) ---
  invokeSaveSendMessage(payload) {
    return electronAPI.ipcInvoke('saveSendMessage', payload)
  },
  invokeLogout() {
    return electronAPI.ipcInvoke('logout')
  },
  invokeGetLocalFileFolder() {
    return electronAPI.ipcInvoke('getLocalFileFolder')
  },
  invokeChangeLocalFileFolder() {
    return electronAPI.ipcInvoke('changeLocalFileFolder')
  },
  invokeResetLocalFileFolder() {
    return electronAPI.ipcInvoke('resetLocalFileFolder')
  },
  invokeOpenLocalFileFolder() {
    return electronAPI.ipcInvoke('openLocalFileFolder')
  },
  invokeOpenTempVideoFile(data) {
    return electronAPI.ipcInvoke('openTempVideoFile', data)
  },
  invokeReadLocalVideoFile(data) {
    return electronAPI.ipcInvoke('readLocalVideoFile', data)
  },
  invokeOpenLocalVideoFile(data) {
    return electronAPI.ipcInvoke('openLocalVideoFile', data)
  },
  registerUploadSource(file) {
    if (typeof File === 'undefined' || !(file instanceof File)) {
      return Promise.reject(new TypeError('registerUploadSource only accepts File objects'))
    }
    const filePath = webUtils.getPathForFile(file)
    if (!filePath) {
      return Promise.reject(new Error('The selected file has no local path'))
    }
    return electronAPI.ipcInvoke('registerUploadSource', {
      filePath,
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified
    })
  },
  invokeReadUploadSourceChunk(data) {
    return electronAPI.ipcInvoke('readUploadSourceChunk', data)
  },
  invokeReleaseUploadSource(data) {
    return electronAPI.ipcInvoke('releaseUploadSource', data)
  },
  invokeGenerateUploadSourceThumbnail(data) {
    return electronAPI.ipcInvoke('generateUploadSourceThumbnail', data)
  },
  invokeDownloadChatFile(data) {
    return electronAPI.ipcInvoke('downloadChatFile', data)
  },
  invokeCancelDownloadChatFile(data) {
    return electronAPI.ipcInvoke('cancelDownloadChatFile', data)
  },
  invokeOpenDownloadedFile(data) {
    return electronAPI.ipcInvoke('openDownloadedFile', data)
  },
  invokeShowDownloadedFileInFolder(data) {
    return electronAPI.ipcInvoke('showDownloadedFileInFolder', data)
  },

  // --- Event listeners ---
  onReceiveMessage(listener) {
    return electronAPI.ipcOn('receiveMessage', listener)
  },
  onReceiveMessageBatch(listener) {
    return electronAPI.ipcOn('receiveMessageBatch', listener)
  },
  onLoadChatMessageCallback(listener) {
    return electronAPI.ipcOn(IPC_CALLBACK_CHANNELS.loadChatMessage, listener)
  },
  onLoadSessionDataCallback(listener) {
    return electronAPI.ipcOn(IPC_CALLBACK_CHANNELS.loadSessionData, listener)
  },
  onDelChatSessionCallback(listener) {
    return electronAPI.ipcOn(IPC_CALLBACK_CHANNELS.deleteChatSession, listener)
  },
  onMarkSessionReadCallback(listener) {
    return electronAPI.ipcOn(IPC_CALLBACK_CHANNELS.markSessionRead, listener)
  },
  onTopChatSessionCallback(listener) {
    return electronAPI.ipcOn(IPC_CALLBACK_CHANNELS.topChatSession, listener)
  },
  onClearChatMessageCallback(listener) {
    return electronAPI.ipcOn(IPC_CALLBACK_CHANNELS.clearChatMessage, listener)
  },
  onSearchChatMessageCallback(listener) {
    return electronAPI.ipcOn(IPC_CALLBACK_CHANNELS.searchChatMessage, listener)
  },
  onWsStatusChange(listener) {
    return electronAPI.ipcOn('wsStatusChange', listener)
  },
  onWinStateChange(listener) {
    return electronAPI.ipcOn('winStateChange', listener)
  },
  onDownloadChatFileProgress(listener) {
    return electronAPI.ipcOn('downloadChatFileProgress', listener)
  },

  // --- Utility ---
  getPathForFile(file) {
    if (!file) {
      return ''
    }
    return webUtils.getPathForFile(file)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('Failed to expose APIs via contextBridge', error)
  }
} else {
  console.error(
    'contextIsolation is disabled — refusing to expose IPC APIs for security. ' +
      'Enable contextIsolation in your BrowserWindow webPreferences.'
  )
}
