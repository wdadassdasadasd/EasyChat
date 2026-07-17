import os from 'os'
import path from 'path'

const getEasyChatPaths = ({ homeDir = os.homedir(), nodeEnv = process.env.NODE_ENV } = {}) => {
  const rootDir = path.join(homeDir, nodeEnv === 'development' ? '.weChattest' : '.weChat')
  return Object.freeze({
    rootDir,
    databasePath: path.join(rootDir, 'local.db'),
    receiveRecoveryDir: path.join(rootDir, 'receive-recovery'),
    localFilesDir: path.join(rootDir, 'fileStorge')
  })
}

export { getEasyChatPaths }
