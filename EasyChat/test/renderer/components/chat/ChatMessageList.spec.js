import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const componentPath = path.resolve(
  process.cwd(),
  'src/renderer/src/components/chat/ChatMessageList.vue'
)

const loadTimeDividerPredicate = async () => {
  const source = fs.readFileSync(componentPath, 'utf8')
  const script = source.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1]

  expect(script).toBeTruthy()

  const moduleUrl = `data:text/javascript;base64,${Buffer.from(script).toString('base64')}`
  const module = await import(moduleUrl)
  return module.shouldShowMessageTimeDivider
}

describe('ChatMessageList time divider', () => {
  it('shows the divider for the first message in the global list', async () => {
    const shouldShow = await loadTimeDividerPredicate()

    expect(shouldShow(0, 1_000_000, 0, 300_000)).toBe(true)
  })

  it('does not show a divider for the first visible message when the global predecessor is recent', async () => {
    const shouldShow = await loadTimeDividerPredicate()

    expect(shouldShow(12, 1_299_999, 1_000_000, 300_000)).toBe(false)
  })

  it('shows a divider when the first visible message is at least five minutes after its predecessor', async () => {
    const shouldShow = await loadTimeDividerPredicate()

    expect(shouldShow(12, 1_300_000, 1_000_000, 300_000)).toBe(true)
  })
})
