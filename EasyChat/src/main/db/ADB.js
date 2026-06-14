import { add_tables, optional_tables, add_index, alter_tables } from './Tables'
import fs from 'fs'
import sqlite3 from 'sqlite3'
import os from 'os'
import { AsyncLocalStorage } from 'async_hooks'
import { MAX_SQL_IN_PARAMS } from '../constants'

const globalColumnMap = {
  chat_message: {
    userId: 'user_id',
    messageId: 'message_id',
    sessionId: 'session_id',
    messageType: 'message_type',
    messageContent: 'message_content',
    contactType: 'contact_type',
    sendUserId: 'send_user_id',
    sendUserNickName: 'send_user_nick_name',
    sendTime: 'send_time',
    status: 'status',
    fileSize: 'file_size',
    fileName: 'file_name',
    filePath: 'file_path',
    uploadSourceId: 'upload_source_id',
    fileType: 'file_type'
  },
  chat_session_user: {
    userId: 'user_id',
    contactId: 'contact_id',
    contactType: 'contact_type',
    sessionId: 'session_id',
    status: 'status',
    contactName: 'contact_name',
    lastMessage: 'last_message',
    lastReceiveTime: 'last_receive_time',
    noReadCount: 'no_read_count',
    memberCount: 'member_count',
    topType: 'top_type'
  },
  user_setting: {
    userId: 'user_id',
    email: 'email',
    sysSetting: 'sys_setting',
    contactNoRead: 'contact_no_read',
    serverPort: 'server_port'
  }
}

const NODE_ENV = process.env.NODE_ENV

const userDir = os.homedir()
console.log(userDir)
const flieFolder = userDir + (NODE_ENV === 'development' ? '/.weChattest/' : '/.weChat/')

if (!fs.existsSync(flieFolder)) {
  fs.mkdirSync(flieFolder)
}

const db = new sqlite3.Database(flieFolder + 'local.db')
if (typeof db.configure === 'function') {
  db.configure('busyTimeout', 5000)
}

let writeQueue = Promise.resolve()
let writeQueueSize = 0
const transactionContext = new AsyncLocalStorage()
const WAL_CHECKPOINT_WRITE_INTERVAL = 500
const VALID_WAL_CHECKPOINT_MODES = new Set(['PASSIVE', 'FULL', 'RESTART', 'TRUNCATE'])
let dbInitialized = false
let dbInitError = null
let dbReadyPromise = null
let successfulWriteCount = 0
let checkpointInFlight = false

const ensureDbReady = async () => {
  if (dbInitialized) {
    return
  }
  if (dbInitError) {
    throw dbInitError
  }
  await dbReadyPromise
  if (dbInitError) {
    throw dbInitError
  }
}

const runWalCheckpointNow = (mode = 'PASSIVE') => {
  const normalizedMode = String(mode || 'PASSIVE').toUpperCase()
  const checkpointMode = VALID_WAL_CHECKPOINT_MODES.has(normalizedMode) ? normalizedMode : 'PASSIVE'
  return new Promise((resolve, reject) => {
    db.all(`PRAGMA wal_checkpoint(${checkpointMode})`, (err, rows = []) => {
      if (err) {
        reject(err)
        return
      }
      resolve(rows)
    })
  })
}

const checkpointWal = async (mode = 'PASSIVE') => {
  await ensureDbReady()
  return runWalCheckpointNow(mode)
}

const scheduleWalCheckpoint = () => {
  successfulWriteCount += 1
  if (
    successfulWriteCount < WAL_CHECKPOINT_WRITE_INTERVAL ||
    checkpointInFlight ||
    transactionContext.getStore()?.inTransaction ||
    !dbInitialized
  ) {
    return
  }

  successfulWriteCount = 0
  checkpointInFlight = true
  setTimeout(() => {
    runWalCheckpointNow('PASSIVE')
      .catch((err) => {
        console.error('ADB WAL checkpoint failed', err)
      })
      .finally(() => {
        checkpointInFlight = false
      })
  }, 0)
}

const enqueueDbWrite = (task) => {
  if (transactionContext.getStore()?.inTransaction) {
    return task()
  }
  writeQueueSize += 1
  const nextTask = writeQueue
    .catch((err) => {
      console.error('ADB write queue: previous task failed, continuing with next', err)
    })
    .then(task)
    .then((result) => {
      scheduleWalCheckpoint()
      return result
    })
  // M-30: 定期压缩 Promise 链，防止长时间运行下链无限增长导致内存压力
  if (writeQueueSize >= 1000) {
    nextTask.finally(() => {
      writeQueueSize = 0
    })
  }
  writeQueue = nextTask
  return nextTask
}

const runRawSql = (sql) => {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => {
      if (err) {
        console.error(`init database failed:${sql}`, err)
        reject(err)
        return
      }
      resolve()
    })
  })
}

const toCamelCase = (str) => {
  return str.replace(/_([a-z])/g, function (_match, p1) {
    return String.fromCharCode(p1.charCodeAt(0) - 32)
  })
}

const convertDbObj2BizObj = (data) => {
  if (!data) {
    return null
  }
  const bizData = {}
  for (let item in data) {
    bizData[toCamelCase(item)] = data[item]
  }
  return bizData
}

const queryAllNow = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(sql)
    stmt.all(params, function (err, row = []) {
      if (err) {
        console.error(
          `SQL queryAll failed: ${sql}, params: ${JSON.stringify(params)}, error: ${err}`
        )
        stmt.finalize(() => reject(err))
        return
      }
      row.forEach((item, index) => {
        row[index] = convertDbObj2BizObj(item)
      })
      stmt.finalize(() => resolve(row))
    })
  })
}

const queryAll = async (sql, params = []) => {
  await ensureDbReady()
  return queryAllNow(sql, params)
}

const queryOneNow = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(sql)
    stmt.get(params, function (err, row) {
      if (err) {
        console.error(
          `SQL queryOne failed: ${sql}, params: ${JSON.stringify(params)}, error: ${err}`
        )
        stmt.finalize(() => reject(err))
        return
      }
      if (!row) {
        stmt.finalize(() => resolve(null))
        return
      }
      stmt.finalize(() => resolve(convertDbObj2BizObj(row)))
    })
  })
}

const queryOne = async (sql, params = []) => {
  await ensureDbReady()
  return queryOneNow(sql, params)
}

const queryCountNow = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(sql)
    stmt.get(params, function (err, row) {
      if (err) {
        console.error(
          `SQL queryCount failed: ${sql}, params: ${JSON.stringify(params)}, error: ${err}`
        )
        stmt.finalize(() => reject(err))
        return
      }
      if (!row) {
        stmt.finalize(() => resolve(0))
        return
      }
      const firstValue = Object.values(row)[0]
      stmt.finalize(() => resolve(firstValue || 0))
    })
  })
}

const queryCount = async (sql, params = []) => {
  await ensureDbReady()
  return queryCountNow(sql, params)
}

const runStrictNow = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(sql)
    stmt.run(params, function (err) {
      if (err) {
        console.error(`SQL failed:${sql},params:${params},error:${err}`)
        stmt.finalize(() => reject(err))
        return
      }
      const changes = this.changes
      stmt.finalize(() => resolve(changes))
    })
  })
}

const runStrict = async (sql, params = []) => {
  await ensureDbReady()
  return enqueueDbWrite(() => runStrictNow(sql, params))
}

const run = async (sql, params = []) => {
  return runStrict(sql, params).catch((err) => {
    console.error(
      `SQL run failed (non-fatal): ${sql}, params: ${JSON.stringify(params)}, error: ${err}`
    )
    return 0
  })
}

const runInTransaction = async (callback) => {
  await ensureDbReady()
  if (transactionContext.getStore()?.inTransaction) {
    return callback()
  }

  return enqueueDbWrite(async () => {
    return transactionContext.run({ inTransaction: true }, async () => {
      await runStrictNow('begin immediate transaction', [])
      try {
        const result = await callback()
        await runStrictNow('commit', [])
        return result
      } catch (error) {
        await runStrictNow('rollback', []).catch(() => {})
        throw error
      }
    })
  })
}

const runPragma = () => {
  return new Promise((resolve, reject) => {
    db.run('PRAGMA journal_mode=WAL', (journalErr) => {
      if (journalErr) {
        reject(journalErr)
        return
      }
      db.run('PRAGMA synchronous=NORMAL', (syncErr) => {
        if (syncErr) {
          reject(syncErr)
          return
        }
        resolve()
      })
    })
  })
}

const getInsertColumnsAndParams = (tableName, data) => {
  const columnsMap = globalColumnMap[tableName]
  if (!columnsMap) {
    throw new Error(`Unknown database table: ${tableName}`)
  }
  const entries = Object.entries(columnsMap).filter(([bizColumn]) => data[bizColumn] !== undefined)
  const dbColumns = entries.map(([, dbColumn]) => dbColumn)
  const params = entries.map(([bizColumn]) => data[bizColumn])
  if (dbColumns.length === 0) {
    throw new Error(`No insertable columns for table: ${tableName}`)
  }
  return { dbColumns, params }
}

const buildInsertSql = (sqlPrefix, tableName, data) => {
  const { dbColumns, params } = getInsertColumnsAndParams(tableName, data)
  const preper = dbColumns.map(() => '?').join(',')
  const sql = `${sqlPrefix} ${tableName} (${dbColumns.join(',')}) values (${preper})`
  return { sql, params }
}

const insert = async (sqlPrefix, tableName, data) => {
  const { sql, params } = buildInsertSql(sqlPrefix, tableName, data)
  return run(sql, params)
}

const insertStrict = async (sqlPrefix, tableName, data) => {
  const { sql, params } = buildInsertSql(sqlPrefix, tableName, data)
  return runStrict(sql, params)
}

const insertOrReplace = (tableName, data) => {
  return insert('insert or replace into', tableName, data)
}

const insertOrReplaceStrict = (tableName, data) => {
  return insertStrict('insert or replace into', tableName, data)
}

const insertOrReplaceManyStrict = async (tableName, rows = []) => {
  await ensureDbReady()
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0
  }

  const groups = new Map()
  for (const row of rows) {
    const { dbColumns, params } = getInsertColumnsAndParams(tableName, row)
    const key = dbColumns.join(',')
    const group = groups.get(key) || { dbColumns, rows: [] }
    group.rows.push(params)
    groups.set(key, group)
  }

  let changedRows = 0
  for (const { dbColumns, rows: groupedRows } of groups.values()) {
    const rowsPerStatement = Math.max(1, Math.floor(MAX_SQL_IN_PARAMS / dbColumns.length))
    const rowPlaceholders = `(${dbColumns.map(() => '?').join(',')})`
    for (let offset = 0; offset < groupedRows.length; offset += rowsPerStatement) {
      const batch = groupedRows.slice(offset, offset + rowsPerStatement)
      const sql = `insert or replace into ${tableName} (${dbColumns.join(',')}) values ${batch
        .map(() => rowPlaceholders)
        .join(',')}`
      changedRows += await runStrict(sql, batch.flat())
    }
  }

  return changedRows
}

const insertOrIgnore = (tableName, data) => {
  return insert('insert or ignore into', tableName, data)
}

const update = async (tableName, data, paramData) => {
  const columnsMap = globalColumnMap[tableName]
  const dbColumns = []
  const params = []
  const whereColumns = []
  for (let item in data) {
    if (data[item] !== undefined && columnsMap[item] !== undefined) {
      dbColumns.push(`${columnsMap[item]}=?`)
      params.push(data[item])
    }
  }
  for (let item in paramData) {
    if (paramData[item] !== undefined && paramData[item] !== null) {
      params.push(paramData[item])
      whereColumns.push(`${columnsMap[item]}=?`)
    }
  }
  const sql = `update ${tableName} set ${dbColumns.join(',')} where ${whereColumns.join(' and ')}`
  return run(sql, params)
}

const createTable = async () => {
  for (const item of add_tables) {
    await runRawSql(item)
  }
  for (const item of optional_tables || []) {
    await runRawSql(item).catch((error) => {
      console.error(`optional database feature failed:${item}`, error)
    })
  }
  for (const item of add_index) {
    await runRawSql(item)
  }
  for (const item of alter_tables) {
    const tableName = item.tableName || item.table_Name
    const fieldList = await queryAllNow(`PRAGMA table_info(${tableName})`, [])
    const field = fieldList.some((row) => row.name === item.field)
    if (!field && item.sql) {
      await runRawSql(item.sql)
    }
  }
}

const init = async () => {
  await runPragma()
  await createTable()
}

dbReadyPromise = init()
  .then(() => {
    dbInitialized = true
  })
  .catch((err) => {
    dbInitError = err
    console.error('Database initialization failed', err)
    throw err
  })

const dbReady = dbReadyPromise.catch((err) => {
  console.error('Database initialization failed', err)
  throw err
})

export {
  dbReady,
  ensureDbReady,
  checkpointWal,
  insertOrReplace,
  insertOrReplaceStrict,
  insertOrReplaceManyStrict,
  insertOrIgnore,
  queryAll,
  queryOne,
  queryCount,
  run,
  runStrict,
  runInTransaction,
  insert,
  update
}
