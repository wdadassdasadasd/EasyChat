import { describe, expect, it } from 'vitest'
import path from 'path'
import { getEasyChatPaths } from '../../src/main/appPaths.js'

describe('getEasyChatPaths', () => {
  it('uses the legacy production root consistently', () => {
    const rootDir = path.join('/home/alice', '.weChat')
    expect(getEasyChatPaths({ homeDir: '/home/alice', nodeEnv: 'production' })).toEqual({
      rootDir,
      databasePath: path.join(rootDir, 'local.db'),
      receiveRecoveryDir: path.join(rootDir, 'receive-recovery'),
      localFilesDir: path.join(rootDir, 'fileStorge')
    })
  })

  it('keeps all development data under the isolated test root', () => {
    const rootDir = path.join('/home/alice', '.weChattest')
    expect(getEasyChatPaths({ homeDir: '/home/alice', nodeEnv: 'development' })).toEqual({
      rootDir,
      databasePath: path.join(rootDir, 'local.db'),
      receiveRecoveryDir: path.join(rootDir, 'receive-recovery'),
      localFilesDir: path.join(rootDir, 'fileStorge')
    })
  })
})
