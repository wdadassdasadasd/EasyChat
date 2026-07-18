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

afterEach(() => {
  delete process.env.EASYCHAT_DATA_ROOT
  vi.resetModules()
  testRoots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }))
})

describe.sequential('ADB schema migrations against SQLite', () => {
  it('upgrades an empty database from v0 to v4 and reports the version', async () => {
    const root = createRoot()
    const adb = await loadAdb(root)
    await adb.dbReady
    expect(adb.getDbDiagnostics().schemaVersion).toBe(4)
    await adb.closeDatabase()

    await withDatabase(path.join(root, 'local.db'), async ({ all }) => {
      const versions = await all('select version, name from schema_migrations order by version')
      expect(versions).toEqual([
        { version: 1, name: 'baseline_schema' },
        { version: 2, name: 'upload_recovery_columns' },
        { version: 3, name: 'reliable_event_schema' },
        { version: 4, name: 'snapshot_recovery_schema' }
      ])
      const messageColumns = await all('pragma table_info(chat_message)')
      const taskColumns = await all('pragma table_info(upload_task)')
      expect(messageColumns.map((column) => column.name)).toContain('upload_source_id')
      expect(taskColumns.map((column) => column.name)).toContain('cover_source_id')
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
    expect(second.getDbDiagnostics().schemaVersion).toBe(4)
    await second.closeDatabase()

    await withDatabase(databasePath, async ({ all }) => {
      expect(await all('select version from schema_migrations order by version')).toEqual([
        { version: 1 },
        { version: 2 },
        { version: 3 },
        { version: 4 }
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
    expect(adb.getDbDiagnostics().schemaVersion).toBe(4)
    await adb.closeDatabase()
  })
})
