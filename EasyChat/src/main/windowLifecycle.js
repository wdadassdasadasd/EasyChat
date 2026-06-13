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

export { restoreOrCreateMainWindow }
