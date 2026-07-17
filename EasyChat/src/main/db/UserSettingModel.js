import store from '../store'
import { insertOrIgnore, queryOne, runInTransaction, runStrict, update } from './ADB'
import fs from 'fs'
import path from 'path'
import { getEasyChatPaths } from '../appPaths.js'

const defaultLocalFileFolder = () => {
  return getEasyChatPaths().localFilesDir
}

const ensureFolder = async (folder) => {
  // 文件目录检查使用异步 I/O，避免同步 fs 阻塞 Electron 主进程。
  if (!folder) {
    return
  }
  try {
    await fs.promises.access(folder)
  } catch {
    await fs.promises.mkdir(folder, { recursive: true })
  }
}

const parseSysSetting = (sysSetting) => {
  try {
    return sysSetting ? JSON.parse(sysSetting) : {}
  } catch (e) {
    // 解析失败时记录警告而非静默丢弃，便于定位本地设置损坏问题。
    console.error('Failed to parse sys_setting JSON, resetting to empty object', e)
    return {}
  }
}

const getFolderStats = async (folder) => {
  // 统计下载目录可能递归大量文件，必须使用异步 I/O 保持主进程响应。
  const stats = {
    exists: false,
    fileCount: 0,
    totalSize: 0
  }

  if (!folder) {
    return stats
  }
  try {
    await fs.promises.access(folder)
  } catch {
    return stats
  }

  stats.exists = true
  const walk = async (dir) => {
    let fileList = []
    try {
      fileList = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch (e) {
      return
    }
    for (const item of fileList) {
      const fullPath = path.join(dir, item.name)
      if (item.isDirectory()) {
        await walk(fullPath)
      } else if (item.isFile()) {
        try {
          const fileStat = await fs.promises.stat(fullPath)
          stats.fileCount++
          stats.totalSize += fileStat.size
        } catch (e) {
          // Ignore files that disappear while the folder is being scanned.
        }
      }
    }
  }

  await walk(folder)
  return stats
}

const normalizeContactApplyNoReadCount = (value) => {
  const count = Number(value)
  return Number.isSafeInteger(count) && count >= 0 ? count : 0
}

const setContactApplyNoReadCount = async (userId, noReadCount) => {
  if (!userId) {
    return 0
  }
  return await runStrict('update user_setting set contact_no_read=? where user_id=?', [
    normalizeContactApplyNoReadCount(noReadCount),
    userId
  ])
}

const addUserSetting = async (userId, email) => {
  // 端口分配和用户设置写入必须在同一事务中，防止并发注册拿到相同端口。
  return runInTransaction(async () => {
    let sql = 'select max(server_port) maxserver_port from user_setting'
    const maxServerInfo = await queryOne(sql, [])
    let serverPort = maxServerInfo?.maxserverPort
    if (serverPort == null) {
      serverPort = 10240
    } else {
      serverPort++
    }

    const sysSetting = {
      localFileFolder: defaultLocalFileFolder()
    }
    sql = 'select * from user_setting where user_id=?'
    const userInfo = await queryOne(sql, [userId])
    let resultServerPort = null
    let localFileFolder = null

    if (userInfo) {
      await update('user_setting', { email }, { userId })
      resultServerPort = userInfo.serverPort
      localFileFolder =
        parseSysSetting(userInfo.sysSetting).localFileFolder || sysSetting.localFileFolder
    } else {
      await insertOrIgnore('user_setting', {
        userId,
        email,
        sysSetting: JSON.stringify(sysSetting),
        contactNoRead: 0,
        serverPort
      })
      resultServerPort = serverPort
      localFileFolder = sysSetting.localFileFolder
    }

    await ensureFolder(localFileFolder)
    store.setUserData('localServerPort', resultServerPort)
    store.setUserData('localFileFolder', localFileFolder)
  })
}

const getLocalFileFolder = async () => {
  const userId = store.getUserId()
  const defaultFolder = defaultLocalFileFolder()
  let localFileFolder = store.getUserData('localFileFolder')

  if (!localFileFolder && userId) {
    const userInfo = await queryOne('select * from user_setting where user_id=?', [userId])
    localFileFolder = parseSysSetting(userInfo?.sysSetting).localFileFolder
  }

  localFileFolder = localFileFolder || defaultFolder
  await ensureFolder(localFileFolder)
  store.setUserData('localFileFolder', localFileFolder)

  return {
    localFileFolder,
    defaultFolder,
    isDefault: path.normalize(localFileFolder) === path.normalize(defaultFolder),
    ...(await getFolderStats(localFileFolder))
  }
}

const updateLocalFileFolder = async (folder) => {
  const userId = store.getUserId()
  if (!userId || !folder) {
    return await getLocalFileFolder()
  }

  const localFileFolder = path.normalize(folder)
  await ensureFolder(localFileFolder)
  const userInfo = await queryOne('select * from user_setting where user_id=?', [userId])
  const sysSetting = parseSysSetting(userInfo?.sysSetting)
  sysSetting.localFileFolder = localFileFolder
  await update('user_setting', { sysSetting: JSON.stringify(sysSetting) }, { userId })
  store.setUserData('localFileFolder', localFileFolder)
  return await getLocalFileFolder()
}

const resetLocalFileFolder = async () => {
  return await updateLocalFileFolder(defaultLocalFileFolder())
}

export {
  normalizeContactApplyNoReadCount,
  setContactApplyNoReadCount,
  addUserSetting,
  getLocalFileFolder,
  updateLocalFileFolder,
  resetLocalFileFolder
}
