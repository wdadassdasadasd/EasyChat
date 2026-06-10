import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useVirtualMessageList } from '@/views/chat/composables/useVirtualMessageList'

describe('useVirtualMessageList', () => {
  it('scrolls to the real DOM bottom when measured virtual height is stale', () => {
    const messageList = ref([])
    const virtualList = useVirtualMessageList(messageList)
    const container = {
      clientHeight: 120,
      scrollHeight: 480,
      scrollTop: 0
    }

    virtualList.scrollToBottom(container)

    expect(container.scrollTop).toBe(360)
    expect(virtualList.getBottomGap(container)).toBe(0)
    expect(virtualList.getScrollState(container)).toMatchObject({
      scrollHeight: 480,
      scrollTop: 360,
      clientHeight: 120,
      bottomGap: 0
    })
  })
})
