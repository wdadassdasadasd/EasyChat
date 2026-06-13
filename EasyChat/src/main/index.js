import { app, dialog, shell, BrowserWindow, Menu, Tray } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  onGetLocalStore,
  onLoadSessionData,
  onLocalFileFolder,
  onLoginOnRegister,
  onLoginSuccess,
  onOpenTempVideoFile,
  onChatFileDownload,
  onResetToLogin,
  onSetLocalStore,
  winTitleOp,
  onDelChatSession,
  onMarkSessionRead,
  onTopChatSession,
  onLoadChatMessage,
  onSaveSendMessage,
  onClearChatMessage,
  onSearchChatMessage,
  onUploadSources
} from './ipc.js'
import { dbReady } from './db/ADB.js'
import { initializeLogger } from './logger.js'

initializeLogger()

const NODE_ENV = process.env.NODE_ENV

const login_width = 300
const login_height = 370
const register_height = 450

let ipcHandlersRegistered = false

function createWindow() {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    title: 'WeChat',
    icon: icon,
    width: login_width,
    height: login_height,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    resizable: false,
    frame: false,
    transparent: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      // C-1: 启用 contextIsolation，隔离预加载与渲染进程上下文
      contextIsolation: true
    }
  })

  if (NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools()
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    mainWindow.setTitle('WeChat')
  })

  // 窗口最大化/还原时通知渲染进程，保持 WinOp 按钮图标与实际状态同步。
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('winStateChange', { maximized: true })
  })
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('winStateChange', { maximized: false })
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  //托盘
  const tray = new Tray(icon)
  const contextMenu = [
    {
      label: '退出EasyChat',
      click: function () {
        app.quit()
      }
    }
  ]

  let hasUserTrayMenu = false
  const menu = Menu.buildFromTemplate(contextMenu)
  tray.setToolTip('EasyChat')
  tray.setContextMenu(menu)
  tray.on('click', () => {
    mainWindow.setSkipTaskbar(false)
    mainWindow.show()
  })

  //监听登录注册
  onLoginOnRegister(mainWindow, (isLogin) => {
    mainWindow.setMinimumSize(login_width, login_height)
    if (isLogin) {
      mainWindow.setSize(login_width, login_height)
    } else {
      mainWindow.setSize(login_width, register_height)
    }
    mainWindow.setResizable(false)
  })

  onLoginSuccess(mainWindow, (config) => {
    mainWindow.setResizable(true)
    mainWindow.setMinimumSize(800, 600)
    mainWindow.setSize(850, 800)
    mainWindow.center()
    mainWindow.setMaximizable(true)
    //管理后台的窗口操作
    if (hasUserTrayMenu) {
      contextMenu.shift()
    }
    contextMenu.unshift({
      label: '用户：' + config.nickName,
      click: function () {}
    })
    hasUserTrayMenu = true
    tray.setContextMenu(Menu.buildFromTemplate(contextMenu))
  })
  //在主进程注册 IPC 监听（仅注册一次，防止 macOS activate 事件重复注册）
  if (!ipcHandlersRegistered) {
    ipcHandlersRegistered = true
    onResetToLogin(mainWindow, () => {
      mainWindow.setSkipTaskbar(false)
      mainWindow.show()
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize()
      }
      mainWindow.setResizable(false)
      mainWindow.setMaximizable(false)
      mainWindow.setMinimumSize(login_width, login_height)
      mainWindow.setSize(login_width, login_height)
      mainWindow.center()
      if (hasUserTrayMenu) {
        contextMenu.shift()
        hasUserTrayMenu = false
        tray.setContextMenu(Menu.buildFromTemplate(contextMenu))
      }
      mainWindow.webContents
        .executeJavaScript("localStorage.removeItem('userInfo'); window.location.hash = '#/login';")
        .catch(() => {})
    })

    onSetLocalStore()
    onGetLocalStore()
    // 聊天链路 IPC 集中注册：renderer 只发事件，主进程负责查询/更新本地 SQLite。
    onLoadSessionData()
    onDelChatSession()
    onMarkSessionRead()
    onTopChatSession()
    onLoadChatMessage()
    onSaveSendMessage()
    onClearChatMessage()
    onSearchChatMessage()
    onLocalFileFolder()
    onOpenTempVideoFile()
    onChatFileDownload()
    onUploadSources()

    winTitleOp((e, { action, data }) => {
      const webContents = e.sender
      const win = BrowserWindow.fromWebContents(webContents)
      if (!win) {
        return
      }
      switch (action) {
        case 'close': {
          if (data.type == 0) {
            win.close()
          } else {
            win.setSkipTaskbar(true)
            win.hide()
          }
          break
        }
        case 'minimize': {
          win.minimize()
          break
        }
        case 'maximize': {
          win.maximize()
          break
        }
        case 'unmaximize': {
          win.unmaximize()
          break
        }
        case 'top': {
          win.setAlwaysOnTop(data.top)
          break
        }
      }
    })
  } // end if (!ipcHandlersRegistered)
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  try {
    await dbReady
  } catch (error) {
    console.error('Database initialization blocked application startup', error)
    dialog.showErrorBox(
      'EasyChat 启动失败',
      '本地数据库初始化失败，应用无法安全启动。请检查磁盘空间和目录权限后重试。'
    )
    app.quit()
    return
  }

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// M-10: 应用退出时清理资源
let shutdownStarted = false
app.on('before-quit', (event) => {
  if (shutdownStarted) {
    return
  }
  shutdownStarted = true
  event.preventDefault()
  import('./wsClient.js')
    .then(({ closeWs }) => closeWs())
    .catch((error) => console.error('WebSocket shutdown failed', error))
    .finally(() => app.quit())
})

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.
