import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const componentPath = path.resolve(
  process.cwd(),
  'src/renderer/src/components/chat/ChatMessageSearchDialog.vue'
)

describe('ChatMessageSearchDialog source contract', () => {
  it('handles search error callbacks and stops loading', () => {
    const source = fs.readFileSync(componentPath, 'utf8')

    expect(source).toContain('data?.success === false')
    expect(source).toContain('messageSearching.value = false')
    expect(source).toContain("proxy.Message.error('搜索聊天记录失败，请稍后重试。')")
  })

  it('keeps user-facing search text in readable Chinese', () => {
    const source = fs.readFileSync(componentPath, 'utf8')

    expect(source).toContain('查找聊天内容')
    expect(source).toContain('搜索当前会话的聊天记录')
    expect(source).toContain('没有找到相关聊天记录')
    expect(source).toContain('请输入搜索内容')
  })
})
