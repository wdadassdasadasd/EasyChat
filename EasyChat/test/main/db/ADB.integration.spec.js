import fs from 'fs'
import os from 'os'
import path from 'path'
import sqlite3 from 'sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'

const testRoots = []

const createRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'easychat-adb-'))
  testRoots.push(root)
  return root
}

const withDatabase = async (filePath, task) => {
  const database = new sqlite3.Database(filePath)
  try {
    return await task({
      run: (sql, params = []) =>
        new Promise((resolve, reject) => {
          database.run(sql, params, (error) => (error ? reject(error) : resolve()))
        }),
      all: (sql, params = []) =>
        new Promise((resolve, reject) => {
          database.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows)))
        })
    })
  } finally {
    await new Promise((resolve, reject) => database.close((error) => (error ? reject(error) : resolve())))
  }
}

const loadAdb = async (root) => {
  process.env.EASYCHAT_DATA_ROOT = root
  vi.resetModules()
  return await import('../../../src/main/db/ADB.js')
}

const loadChatMessageModel = async (root) => {
  process.env.EASYCHAT_DATA_ROOT = root
  vi.resetModules()
  vi.doMock('../../../src/main/store.js', () => ({
    default: {
      getUserId: () => 'u1'
    }
  }))
  const adb = await import('../../../src/main/db/ADB.js')
  await adb.dbReady
  const chatMessageModel = await import('../../../src/main/db/ChatMessageModel.js')
  return { adb, chatMessageModel }
}

afterEach(() => {
  delete process.env.EASYCHAT_DATA_ROOT
  vi.doUnmock('../../../src/main/store.js')
  vi.resetModules()
  testRoots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }))
})

describe.sequential('ADB schema migrations against SQLite', () => {
  it('upgrades an empty database from v0 to v5 and reports the version', async () => {
    const root = createRoot()
    const adb = await loadAdb(root)
    await adb.dbReady
    expect(adb.getDbDiagnostics().schemaVersion).toBe(5)
    await adb.closeDatabase()

    await withDatabase(path.join(root, 'local.db'), async ({ all }) => {
      const versions = await all('select version, name from schema_migrations order by version')
      expect(versions).toEqual([
        { version: 1, name: 'baseline_schema' },
        { version: 2, name: 'upload_recovery_columns' },
        { version: 3, name: 'reliable_event_schema' },
        { version: 4, name: 'snapshot_recovery_schema' },
        { version: 5, name: 'fts_index_state_schema' }
      ])
      const messageColumns = await all('pragma table_info(chat_message)')
      const taskColumns = await all('pragma table_info(upload_task)')
      expect(messageColumns.map((column) => column.name)).toContain('upload_source_id')
      expect(taskColumns.map((column) => column.name)).toContain('cover_source_id')
      expect((await all('pragma table_info(fts_index_state)')).map((column) => column.name)).toContain(
        'last_row_id'
      )
    })
  })

  it('baselines a pre-ledger database before creating indexes for later columns', async () => {
    const root = createRoot()
    const databasePath = path.join(root, 'local.db')
    fs.mkdirSync(root, { recursive: true })
    await withDatabase(databasePath, async ({ run }) => {
      await run(
        [
          'create table chat_message(',
          'user_id varchar not null, message_id bigint not null, session_id varchar,',
          'message_type integer, message_content varchar, contact_type integer, send_user_id varchar,',
          'send_user_nick_name varchar, send_time bigint, status integer, file_size bigint,',
          'file_name varchar, file_path varchar, upload_source_id varchar, file_type integer,',
          'primary key(user_id, message_id))'
        ].join(' ')
      )
      await run(
        [
          'create table upload_task(',
          'user_id varchar not null, task_id varchar not null, message_id bigint not null,',
          'upload_source_id varchar not null, state varchar not null, upload_id varchar,',
          'file_name varchar not null, file_size bigint not null, file_type integer, total_chunks integer,',
          'uploaded_bytes bigint default 0, last_error varchar, created_at bigint not null,',
          'updated_at bigint not null, primary key(user_id, task_id))'
        ].join(' ')
      )
    })

    const adb = await loadAdb(root)
    await expect(adb.dbReady).resolves.toBeUndefined()
    await adb.closeDatabase()

    await withDatabase(databasePath, async ({ all }) => {
      const columns = await all('pragma table_info(chat_message)')
      expect(columns.map((column) => column.name)).toEqual(
        expect.arrayContaining(['client_message_id', 'upload_source_id'])
      )
      const indexes = await all("pragma index_list('chat_message')")
      expect(indexes.map((index) => index.name)).toContain('idx_chat_message_user_client_message')
    })
  })

  it('upgrades an existing v1 database once and remains idempotent', async () => {
    const root = createRoot()
    const databasePath = path.join(root, 'local.db')
    fs.mkdirSync(root, { recursive: true })
    await withDatabase(databasePath, async ({ run }) => {
      await run('create table schema_migrations(version integer primary key, name varchar not null, applied_at bigint not null)')
      await run("insert into schema_migrations(version, name, applied_at) values (1, 'baseline_schema', 1)")
      await run('create table chat_message(user_id varchar not null, message_id bigint not null, primary key(user_id, message_id))')
      await run('create table upload_task(user_id varchar not null, task_id varchar not null, message_id bigint not null, primary key(user_id, task_id))')
    })

    const first = await loadAdb(root)
    await first.dbReady
    await first.closeDatabase()
    const second = await loadAdb(root)
    await second.dbReady
    expect(second.getDbDiagnostics().schemaVersion).toBe(5)
    await second.closeDatabase()

    await withDatabase(databasePath, async ({ all }) => {
      expect(await all('select version from schema_migrations order by version')).toEqual([
        { version: 1 },
        { version: 2 },
        { version: 3 },
        { version: 4 },
        { version: 5 }
      ])
    })
  })

  it('rolls back v2 without advancing its migration record when the schema cannot be altered', async () => {
    const root = createRoot()
    const databasePath = path.join(root, 'local.db')
    fs.mkdirSync(root, { recursive: true })
    await withDatabase(databasePath, async ({ run }) => {
      await run('create table schema_migrations(version integer primary key, name varchar not null, applied_at bigint not null)')
      await run("insert into schema_migrations(version, name, applied_at) values (1, 'baseline_schema', 1)")
      await run('create table chat_message(user_id varchar not null, message_id bigint not null, primary key(user_id, message_id))')
      await run('create view upload_task as select 1 as user_id, 1 as task_id, 1 as message_id')
    })

    const adb = await loadAdb(root)
    await expect(adb.dbReady).rejects.toThrow()
    await adb.closeDatabase()
    await withDatabase(databasePath, async ({ all }) => {
      expect(await all('select version from schema_migrations order by version')).toEqual([{ version: 1 }])
      const columns = await all('pragma table_info(chat_message)')
      expect(columns.map((column) => column.name)).not.toContain('upload_source_id')
    })
  })

  it('does not block required migrations when FTS initialization fails', async () => {
    const root = createRoot()
    const databasePath = path.join(root, 'local.db')
    fs.mkdirSync(root, { recursive: true })
    await withDatabase(databasePath, async ({ run }) => {
      await run('create view chat_message_fts as select 1 as message_content')
    })
    const adb = await loadAdb(root)
    await expect(adb.dbReady).resolves.toBeUndefined()
    expect(adb.getDbDiagnostics().schemaVersion).toBe(5)
    await adb.closeDatabase()
  })

  it('backfills FTS in bounded resumable batches before marking a user ready', async () => {
    const root = createRoot()
    const { adb, chatMessageModel } = await loadChatMessageModel(root)
    const messages = Array.from({ length: 101 }, (_item, index) => [
      'u1',
      index + 1,
      's1',
      `message ${index + 1}`,
      `file-${index + 1}.txt`
    ])
    const placeholders = messages.map(() => '(?,?,?,?,?)').join(',')

    await adb.runStrict(
      `insert into chat_message(user_id,message_id,session_id,message_content,file_name) values ${placeholders}`,
      messages.flat()
    )

    await expect(chatMessageModel.backfillFtsBatchForUser('u1')).resolves.toEqual({ complete: false })
    expect(
      await adb.queryOne('select status,last_row_id from fts_index_state where user_id=?', ['u1'])
    ).toMatchObject({ status: 'pending', lastRowId: 100 })
    expect(await adb.queryOne('select count(*) as count from chat_message_fts where user_id=?', ['u1'])).toEqual({
      count: 100
    })

    await expect(chatMessageModel.backfillFtsBatchForUser('u1')).resolves.toEqual({ complete: true })
    expect(
      await adb.queryOne('select status,last_row_id from fts_index_state where user_id=?', ['u1'])
    ).toMatchObject({ status: 'ready', lastRowId: 101 })
    expect(await adb.queryOne('select count(*) as count from chat_message_fts where user_id=?', ['u1'])).toEqual({
      count: 101
    })
    await adb.closeDatabase()
  })

  it('persists a duplicate V2 event only once while advancing its cursor', async () => {
    const root = createRoot()
    const { adb, chatMessageModel } = await loadChatMessageModel(root)
    const event = {
      version: 2,
      eventId: 'event-1',
      serverSequence: 7,
      occurredAt: 1700000000000,
      type: 'CONTACT_CHANGED',
      payload: { contactId: 'u2' }
    }

    const result = await chatMessageModel.applyV2Events([event, event])

    expect(result.eventTypes).toEqual(['CONTACT_CHANGED'])
    expect(await adb.queryOne('select count(*) as count from processed_event where user_id=?', ['u1'])).toEqual({
      count: 1
    })
    expect(await adb.queryOne('select server_sequence from sync_cursor where user_id=?', ['u1'])).toEqual({
      serverSequence: 7
    })
    await adb.closeDatabase()
  })

  it('creates the session summary and unread count with a received V2 message', async () => {
    const root = createRoot()
    const { adb, chatMessageModel } = await loadChatMessageModel(root)
    const result = await chatMessageModel.applyV2Events([
      {
        version: 2,
        eventId: 'message-event-1',
        serverSequence: 8,
        occurredAt: 1700000000001,
        type: 'MESSAGE_UPSERT',
        payload: {
          messageId: 101,
          sessionId: 'direct-u2',
          contactId: 'u1',
          contactType: 0,
          messageType: 2,
          messageContent: 'hello from u2',
          sendUserId: 'u2',
          sendTime: 1700000000001
        }
      }
    ])

    expect(result.savedMessages).toHaveLength(1)
    expect(await adb.queryOne(
      'select contact_id,session_id,last_message,no_read_count from chat_session_user where user_id=? and contact_id=?',
      ['u1', 'u2']
    )).toEqual({
      contactId: 'u2',
      sessionId: 'direct-u2',
      lastMessage: 'hello from u2',
      noReadCount: 1
    })
    await adb.closeDatabase()
  })

  it('persists 5,000 cross-session messages within the release budget without duplicate unread counts', async () => {
    const root = createRoot()
    const { adb, chatMessageModel } = await loadChatMessageModel(root)
    const sessionCount = 100
    const messagesPerSession = 50
    const now = Date.now()
    const sessionRows = Array.from({ length: sessionCount }, (_item, index) => ({
      contactId: `remote-${index}`,
      contactType: 0,
      sessionId: `session-${index}`,
      contactName: `Remote ${index}`,
      lastMessage: '',
      lastReceiveTime: now,
      noReadCount: 0,
      topType: 0
    }))
    const messages = Array.from({ length: sessionCount * messagesPerSession }, (_item, index) => {
      const sessionIndex = index % sessionCount
      return {
        messageId: index + 1,
        sessionId: `session-${sessionIndex}`,
        contactId: `remote-${sessionIndex}`,
        contactType: 0,
        messageType: 2,
        messageContent: `benchmark message ${index + 1}`,
        sendUserId: `remote-${sessionIndex}`,
        sendUserNickName: `Remote ${sessionIndex}`,
        sendTime: now + index,
        status: 1
      }
    })

    const startedAt = performance.now()
    const firstResult = await chatMessageModel.saveMessageBatch(messages, { sessionRows })
    const duration = performance.now() - startedAt
    const duplicateResult = await chatMessageModel.saveMessageBatch(messages.slice(0, 1000), {
      sessionRows
    })

    expect(firstResult.savedCount).toBe(5000)
    expect(duplicateResult.savedCount).toBe(0)
    expect(duration).toBeLessThan(10000)
    expect(
      await adb.queryOne('select count(*) as count from chat_message where user_id=?', ['u1'])
    ).toEqual({ count: 5000 })
    expect(
      await adb.queryOne(
        'select sum(no_read_count) as total from chat_session_user where user_id=?',
        ['u1']
      )
    ).toEqual({ total: 5000 })
    expect(
      await adb.queryOne(
        'select min(no_read_count) as minimum,max(no_read_count) as maximum from chat_session_user where user_id=?',
        ['u1']
      )
    ).toEqual({ minimum: 50, maximum: 50 })
    await adb.closeDatabase()
  }, 15000)
})
