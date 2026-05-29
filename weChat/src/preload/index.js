import { contextBridge, ipcRenderer, webUtils } from 'electron'

const sendChannels = new Set([
  'loginOrRegister',
  'openChat',
  'winTitleOp',
  'SetLocalStore',
  'GetLocalStore',
  'loadSessionData',
  'delChatSession',
  'topChatSession',
  'loadChatMessage',
  'markSessionRead',
  'reLogin',
  'saveSendMessage',
  'clearChatMessage',
  'searchChatMessage'
])

const receiveChannels = new Set([
  'getLocalStoreCallback',
  'loadSessionDataCallback',
  'loadChatMessageCallback',
  'markSessionReadCallback',
  'saveSendMessageCallback',
  'clearChatMessageCallback',
  'searchChatMessageCallback',
  'receiveMessage',
  'receiveMessageBatch'
])

const invokeChannels = new Set([
  'logout',
  'getLocalFileFolder',
  'changeLocalFileFolder',
  'resetLocalFileFolder',
  'openLocalFileFolder',
  'openTempVideoFile',
  'readLocalVideoFile',
  'openLocalVideoFile'
])

const listenerMap = new Map()

const getWrappedListener = (channel, listener) => {
  if (!receiveChannels.has(channel) || typeof listener !== 'function') {
    return null
  }

  let channelListeners = listenerMap.get(channel)
  if (!channelListeners) {
    channelListeners = new Map()
    listenerMap.set(channel, channelListeners)
  }

  if (channelListeners.has(listener)) {
    return channelListeners.get(listener)
  }

  const wrappedListener = (_event, ...args) => {
    listener({}, ...args)
  }
  channelListeners.set(listener, wrappedListener)
  return wrappedListener
}

const safeIpcRenderer = {
  send: (channel, ...args) => {
    if (sendChannels.has(channel)) {
      ipcRenderer.send(channel, ...args)
    }
  },
  invoke: (channel, ...args) => {
    if (!invokeChannels.has(channel)) {
      return Promise.reject(new Error(`IPC invoke channel is not allowed: ${channel}`))
    }
    return ipcRenderer.invoke(channel, ...args)
  },
  on: (channel, listener) => {
    const wrappedListener = getWrappedListener(channel, listener)
    if (wrappedListener) {
      ipcRenderer.on(channel, wrappedListener)
    }
  },
  once: (channel, listener) => {
    if (!receiveChannels.has(channel) || typeof listener !== 'function') {
      return
    }
    ipcRenderer.once(channel, (_event, ...args) => {
      listener({}, ...args)
    })
  },
  removeListener: (channel, listener) => {
    const channelListeners = listenerMap.get(channel)
    const wrappedListener = channelListeners?.get(listener)
    if (wrappedListener) {
      ipcRenderer.removeListener(channel, wrappedListener)
      channelListeners.delete(listener)
    }
  },
  removeAllListeners: (channel) => {
    if (!receiveChannels.has(channel)) {
      return
    }
    const channelListeners = listenerMap.get(channel)
    if (channelListeners) {
      channelListeners.forEach((wrappedListener) => {
        ipcRenderer.removeListener(channel, wrappedListener)
      })
      channelListeners.clear()
    }
  }
}

// Custom APIs for renderer
const api = {
  getPathForFile: (file) => {
    if (!file) {
      return ''
    }
    return webUtils.getPathForFile(file)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', {
      ipcRenderer: safeIpcRenderer
    })
    contextBridge.exposeInMainWorld('ipcRenderer', safeIpcRenderer)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = {
    ipcRenderer: safeIpcRenderer
  }
  window.ipcRenderer = safeIpcRenderer
  window.api = api
}
