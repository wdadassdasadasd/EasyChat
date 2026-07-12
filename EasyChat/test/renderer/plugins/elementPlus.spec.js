import { describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/elementPlusAppStyles', () => ({}))

import { ElButton, ElConfigProvider, ElInfiniteScroll, ElInput } from 'element-plus'
import {
  elementPlusPlugins,
  ensureElementPlusAppFeatures,
  installElementPlus
} from '@/utils/elementPlus'
import { elementPlusAppPlugins } from '@/utils/elementPlusAppFeatures'

describe('installElementPlus', () => {
  it('registers only the Element Plus components required before login', () => {
    const app = {
      use: vi.fn().mockReturnThis()
    }

    const result = installElementPlus(app)
    const registeredPlugins = app.use.mock.calls.map(([plugin]) => plugin)

    expect(result).toBe(app)
    expect(elementPlusPlugins).toHaveLength(6)
    expect(registeredPlugins).toHaveLength(elementPlusPlugins.length)
    expect(registeredPlugins).toEqual(
      expect.arrayContaining([ElConfigProvider, ElButton, ElInput])
    )
  })

  it('loads and installs application-only components once', async () => {
    const app = {
      use: vi.fn().mockReturnThis()
    }

    await Promise.all([ensureElementPlusAppFeatures(app), ensureElementPlusAppFeatures(app)])

    const registeredPlugins = app.use.mock.calls.map(([plugin]) => plugin)
    expect(registeredPlugins).toHaveLength(elementPlusAppPlugins.length)
    expect(registeredPlugins).toEqual(expect.arrayContaining([ElInfiniteScroll]))
  })
})
