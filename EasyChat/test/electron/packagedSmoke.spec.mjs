import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'

const packagedExecutable = process.env.EASYCHAT_PACKAGED_EXE

test('packaged EasyChat initializes SQLite and restarts with the isolated data directory', async () => {
  test.skip(!packagedExecutable, 'EASYCHAT_PACKAGED_EXE is required for the packaged smoke test')

  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easychat-packaged-'))
  const userDataDir = path.join(rootDir, 'user-data')
  const dataRoot = path.join(rootDir, 'application-data')
  const sqlitePath = path.join(dataRoot, 'local.db')

  try {
    for (let launchNumber = 1; launchNumber <= 2; launchNumber += 1) {
      const electronApp = await electron.launch({
        executablePath: packagedExecutable,
        args: [
          `--user-data-dir=${userDataDir}`,
          '--disable-gpu',
          '--noerrdialogs',
          ...(process.platform === 'win32' ? ['--no-sandbox'] : [])
        ],
        env: { ...process.env, EASYCHAT_DATA_ROOT: dataRoot }
      })

      try {
        const page = await electronApp.firstWindow()
        await page.waitForFunction(() => typeof window.api === 'object')
        const identity = await electronApp.evaluate(({ app }) => ({
          isPackaged: app.isPackaged,
          name: app.getName(),
          version: app.getVersion(),
          userData: app.getPath('userData')
        }))
        expect(identity).toEqual({
          isPackaged: true,
          name: 'EasyChat',
          version: '1.0.0',
          userData: userDataDir
        })
        await expect.poll(() => fs.existsSync(sqlitePath)).toBe(true)
      } finally {
        await electronApp.close()
      }
    }
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
