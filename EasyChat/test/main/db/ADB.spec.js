import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbState = vi.hoisted(() => ({
  failInitialization: false,
  failStatementPattern: null,
  prepareCalls: [],
  runCalls: []
}))

vi.mock('os', () => ({
  default: {
    homedir: () => 'D:/home'
  }
}))

vi.mock('fs', () => ({
  default: {
    existsSync: () => true,
    mkdirSync: vi.fn()
  }
}))

vi.mock('../../../src/main/db/Tables', () => ({
  add_index: [],
  add_tables: [],
  upload_recovery_columns: [],
  optional_tables: []
}))

vi.mock('sqlite3', () => ({
  default: {
    Database: class {
      all(_sql, callback) {
        callback(null, [])
      }

      configure() {}

      prepare(sql) {
        const call = { params: null, sql }
        dbState.prepareCalls.push(call)
        return {
          all(params, callback) {
            call.params = params
            callback(null, [])
          },
          finalize(callback) {
            callback()
          },
          get(params, callback) {
            call.params = params
            callback(null, null)
          },
          run(params, callback) {
            call.params = params
            if (dbState.failStatementPattern && sql.includes(dbState.failStatementPattern)) {
              callback(new Error('statement failed'))
              return
            }
            callback.call({ changes: Math.max(1, sql.split('),(').length) }, null)
          }
        }
      }

      run(sql, callback) {
        dbState.runCalls.push(sql)
        if (dbState.failInitialization) {
          callback(new Error('init failed'))
          return
        }
        callback(null)
      }
    }
  }
}))

describe('ADB readiness and batch writes', () => {
  beforeEach(() => {
    vi.resetModules()
    dbState.failInitialization = false
    dbState.failStatementPattern = null
    dbState.prepareCalls.length = 0
    dbState.runCalls.length = 0
  })

  it('rejects dbReady and later queries without preparing SQL after initialization failure', async () => {
    dbState.failInitialization = true
    const adb = await import('../../../src/main/db/ADB')

    await expect(adb.dbReady).rejects.toThrow('init failed')
    await expect(adb.queryAll('select 1')).rejects.toThrow('init failed')
    await expect(adb.insertOrReplaceManyStrict('chat_message', [])).rejects.toThrow('init failed')
    expect(dbState.prepareCalls).toHaveLength(0)
  })

  it('groups compatible rows and keeps every statement within 500 parameters', async () => {
    const adb = await import('../../../src/main/db/ADB')
    await adb.dbReady
    const rows = Array.from({ length: 100 }, (_, index) => ({
      userId: 'u1',
      messageId: index + 1,
      sessionId: 's1',
      messageContent: `message-${index}`,
      sendTime: index,
      status: 1
    }))

    await expect(adb.insertOrReplaceManyStrict('chat_message', rows)).resolves.toBe(100)
    const insertCalls = dbState.prepareCalls.filter((call) =>
      call.sql.includes('insert or replace into chat_message')
    )
    expect(insertCalls.length).toBeGreaterThan(1)
    insertCalls.forEach((call) => {
      expect(call.params.length).toBeLessThanOrEqual(500)
      expect(call.sql).toContain('insert or replace into chat_message')
    })
    await expect(adb.insertOrReplaceManyStrict('chat_message', [])).resolves.toBe(0)
  })

  it('rolls back a transaction when a batched operation fails', async () => {
    const adb = await import('../../../src/main/db/ADB')
    await adb.dbReady
    dbState.failStatementPattern = 'insert or replace into chat_message'

    await expect(
      adb.runInTransaction(async () => {
        await adb.insertOrReplaceManyStrict('chat_message', [
          {
            userId: 'u1',
            messageId: 1,
            sessionId: 's1'
          }
        ])
      })
    ).rejects.toThrow('statement failed')

    expect(dbState.prepareCalls.map((call) => call.sql).slice(-3)).toEqual([
      'begin immediate transaction',
      'insert or replace into chat_message (user_id,message_id,session_id) values (?,?,?)',
      'rollback'
    ])
  })
})
