import { add_tables, add_index, alter_tables } from './Tables'

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

const fs = require('fs')
const sqlite3 = require('sqlite3')
const os = require('os')
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

const runRawSql = (sql) => {
    return new Promise((resolve) => {
        db.run(sql, (err) => {
            if (err) {
                console.error(`init database failed:${sql}`, err)
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

const queryAll = (sql, params = []) => {
    return new Promise((resolve) => {
        const stmt = db.prepare(sql)
        stmt.all(params, function (err, row = []) {
            if (err) {
                stmt.finalize(() => resolve([]))
                return
            }
            row.forEach((item, index) => {
                row[index] = convertDbObj2BizObj(item)
            })
            stmt.finalize(() => resolve(row))
        })
    })
}

const queryOne = (sql, params = []) => {
    return new Promise((resolve) => {
        const stmt = db.prepare(sql)
        stmt.get(params, function (err, row) {
            if (err || !row) {
                stmt.finalize(() => resolve(null))
                return
            }
            stmt.finalize(() => resolve(convertDbObj2BizObj(row)))
        })
    })
}

const queryCount = (sql, params = []) => {
    return new Promise((resolve) => {
        const stmt = db.prepare(sql)
        stmt.get(params, function (err, row) {
            if (err || !row) {
                stmt.finalize(() => resolve(0))
                return
            }
            const firstValue = Object.values(row)[0]
            stmt.finalize(() => resolve(firstValue || 0))
        })
    })
}

const runStrict = (sql, params = []) => {
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

const run = (sql, params = []) => {
    return runStrict(sql, params).catch(() => 0)
}

const runInTransaction = async (callback) => {
    await runStrict('begin immediate transaction', [])
    try {
        const result = await callback()
        await runStrict('commit', [])
        return result
    } catch (error) {
        await runStrict('rollback', []).catch(() => {})
        throw error
    }
}

const runPragma = () => {
    return new Promise((resolve) => {
        db.run('PRAGMA journal_mode=WAL', () => {
            db.run('PRAGMA busy_timeout=5000', () => {
                resolve()
            })
        })
    })
}

const buildInsertSql = (sqlPrefix, tableName, data) => {
    const columnsMap = globalColumnMap[tableName]
    const dbColumns = []
    const params = []
    for (let item in data) {
        if (data[item] !== undefined && columnsMap[item] !== undefined) {
            dbColumns.push(columnsMap[item])
            params.push(data[item])
        }
    }
    const preper = dbColumns.map(() => '?').join(',')
    const sql = `${sqlPrefix} ${tableName} (${dbColumns.join(',')}) values (${preper})`
    return { sql, params }
}

const insert = (sqlPrefix, tableName, data) => {
    const { sql, params } = buildInsertSql(sqlPrefix, tableName, data)
    return run(sql, params)
}

const insertStrict = (sqlPrefix, tableName, data) => {
    const { sql, params } = buildInsertSql(sqlPrefix, tableName, data)
    return runStrict(sql, params)
}

const insertOrReplace = (tableName, data) => {
    return insert('insert or replace into', tableName, data)
}

const insertOrReplaceStrict = (tableName, data) => {
    return insertStrict('insert or replace into', tableName, data)
}

const insertOrIgnore = (tableName, data) => {
    return insert('insert or ignore into', tableName, data)
}

const update = (tableName, data, paramData) => {
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
    for (const item of add_index) {
        await runRawSql(item)
    }
    for (const item of alter_tables) {
        const tableName = item.tableName || item.table_Name
        const fieldList = await queryAll(`PRAGMA table_info(${tableName})`, [])
        const field = fieldList.some((row) => row.name === item.field)
        if (!field && item.sql) {
            await runRawSql(item.sql)
        }
    }
}

const init = () => {
    db.serialize(async () => {
        await runPragma()
        await createTable()
    })
}

init()

export {
    createTable,
    insertOrReplace,
    insertOrReplaceStrict,
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
