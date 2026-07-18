import { ipcMain } from 'electron'
import logger from './logger.js'
import { buildUntrustedSenderResult, isTrustedIpcEvent } from './ipcSecurity.js'

const logUntrustedIpc = (channel, mode) => {
  logger.warn('Rejected untrusted IPC sender', { channel, mode })
}

const registerTrustedIpcOn = (channel, handler) => {
  ipcMain.on(channel, (event, ...args) => {
    if (!isTrustedIpcEvent(event)) {
      logUntrustedIpc(channel, 'event')
      return
    }
    return handler(event, ...args)
  })
}

const registerTrustedIpcHandle = (channel, handler) => {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedIpcEvent(event)) {
      logUntrustedIpc(channel, 'invoke')
      return buildUntrustedSenderResult(channel)
    }
    return await handler(event, ...args)
  })
}

export { registerTrustedIpcHandle, registerTrustedIpcOn }
