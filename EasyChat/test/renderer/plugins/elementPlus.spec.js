import { describe, expect, it, vi } from 'vitest'
import { ElButton, ElConfigProvider, ElInfiniteScroll, ElLoading } from 'element-plus'
import { elementPlusPlugins, installElementPlus } from '@/utils/elementPlus'

describe('installElementPlus', () => {
  it('registers the required Element Plus components and directives', () => {
    const app = {
      use: vi.fn().mockReturnThis()
    }

    const result = installElementPlus(app)
    const registeredPlugins = app.use.mock.calls.map(([plugin]) => plugin)

    expect(result).toBe(app)
    expect(elementPlusPlugins).toHaveLength(25)
    expect(registeredPlugins).toHaveLength(elementPlusPlugins.length)
    expect(registeredPlugins).toEqual(
      expect.arrayContaining([ElConfigProvider, ElButton, ElInfiniteScroll, ElLoading])
    )
  })
})
