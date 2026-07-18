import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useVirtualMessageList } from '@/views/chat/composables/useVirtualMessageList'

describe('useVirtualMessageList', () => {
  beforeEach(() => {
    global.requestAnimationFrame = vi.fn((callback) => {
      callback()
      return 1
    })
  })

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

  it('computes visible messages with overscan from scroll position and viewport height', () => {
    const messageList = ref(
      Array.from({ length: 20 }, (_, index) => ({
        messageId: index + 1,
        messageType: 2
      }))
    )
    const virtualList = useVirtualMessageList(messageList, { estimateHeight: 10, overscan: 1 })

    virtualList.handleScroll({
      target: {
        scrollTop: 50,
        clientHeight: 30
      }
    })

    expect(virtualList.startIndex.value).toBe(5)
    expect(virtualList.endIndex.value).toBe(10)
    expect(virtualList.visibleMessages.value.map((message) => message.messageId)).toEqual([
      6, 7, 8, 9, 10
    ])
    expect(virtualList.topSpacerHeight.value).toBe(50)
    expect(virtualList.bottomSpacerHeight.value).toBe(100)
  })

  it('keeps measured heights by messageId when older messages are prepended', () => {
    const messageList = ref([
      { messageId: 'a', messageType: 2 },
      { messageId: 'b', messageType: 2 }
    ])
    const virtualList = useVirtualMessageList(messageList, { estimateHeight: 10, overscan: 1 })

    virtualList.setMessageHeight(messageList.value[0], 0, 50)
    expect(virtualList.totalHeight.value).toBe(60)

    messageList.value = [{ messageId: 'old', messageType: 2 }, ...messageList.value]

    expect(virtualList.totalHeight.value).toBe(70)
    expect(virtualList.heightMap.value.get('a')).toBe(50)

    virtualList.resetHeightMap()

    expect(virtualList.heightMap.value.size).toBe(0)
    expect(virtualList.totalHeight.value).toBe(30)
  })

  it('uses media-specific estimated heights before rows are measured', () => {
    const messageList = ref([
      { messageId: 1, messageType: 5, fileType: 0 },
      { messageId: 2, messageType: 5, fileType: 1 },
      { messageId: 3, messageType: 5, fileType: 2 },
      { messageId: 4, messageType: 2 }
    ])
    const virtualList = useVirtualMessageList(messageList, { estimateHeight: 76, overscan: 1 })

    expect(virtualList.totalHeight.value).toBe(210 + 170 + 96 + 76)
  })

  it('keeps a 10,000-message history window bounded to the viewport and overscan', () => {
    const messageList = ref(
      Array.from({ length: 10000 }, (_item, index) => ({ messageId: index + 1, messageType: 2 }))
    )
    const virtualList = useVirtualMessageList(messageList, { estimateHeight: 50, overscan: 8 })

    virtualList.handleScroll({
      target: {
        scrollTop: 250000,
        clientHeight: 600
      }
    })

    expect(virtualList.visibleMessages.value).toHaveLength(28)
    expect(virtualList.visibleMessages.value).not.toHaveLength(messageList.value.length)
    expect(
      virtualList.topSpacerHeight.value + virtualList.bottomSpacerHeight.value
    ).toBeGreaterThan(0)
  })
})
