const restoreOrCreateMainWindow = ({ BrowserWindow, createWindow }) => {
  const [mainWindow] = BrowserWindow.getAllWindows()
  if (!mainWindow) {
    return createWindow()
  }

  if (mainWindow.isMinimized?.()) {
    mainWindow.restore()
  }
  mainWindow.setSkipTaskbar?.(false)
  mainWindow.show()
  mainWindow.focus()
  return mainWindow
}

const openExternalHttpUrl = async ({ shell, url }) => {
  let parsedUrl
  try {
    parsedUrl = new URL(url)
  } catch {
    return false
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return false
  }
  try {
    await shell.openExternal(parsedUrl.toString())
    return true
  } catch {
    return false
  }
}

export { openExternalHttpUrl, restoreOrCreateMainWindow }
