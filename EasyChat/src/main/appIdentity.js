import path from 'path'

const APP_NAME = 'EasyChat'
const USER_DATA_DIR_NAME = 'EasyChat'

const hasExplicitUserDataDirectory = (argv = []) =>
  argv.some((argument) => String(argument).toLowerCase().startsWith('--user-data-dir'))

const resolveAppUserDataPath = ({ appDataDir, argv = [] } = {}) => {
  if (!appDataDir || hasExplicitUserDataDirectory(argv)) return null
  return path.join(appDataDir, USER_DATA_DIR_NAME)
}

const configureAppIdentity = ({ app, argv = process.argv } = {}) => {
  app.setName(APP_NAME)
  const userDataPath = resolveAppUserDataPath({
    appDataDir: app.getPath('appData'),
    argv
  })
  if (userDataPath) {
    app.setPath('userData', userDataPath)
  }
  return userDataPath
}

export {
  APP_NAME,
  USER_DATA_DIR_NAME,
  configureAppIdentity,
  hasExplicitUserDataDirectory,
  resolveAppUserDataPath
}
