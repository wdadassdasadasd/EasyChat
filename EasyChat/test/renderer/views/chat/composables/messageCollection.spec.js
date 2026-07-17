import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMessageCollection } from '@/views/chat/composables/message/messageCollection'

describe('createMessageCollection', () => {
  beforeEach(() => {
    global.URL.revokeObjectURL = vi.fn()
  })

  it('deduplicates by messageId and preserves a server echo during replacement', () => {
    const messageList = ref([])
    const collection = createMessageCollection(messageList)

    collection.appendMessageIfMissing({ messageId: -1, messageContent: 'pending' })
    collection.appendMessageIfMissing({ messageId: 10, messageContent: 'echo' })
    collection.replaceMessageById(-1, { messageId: 10, status: 1 })

    expect(messageList.value).toEqual([{ messageId: 10, messageContent: 'echo', status: 1 }])
    expect(collection.appendMessageIfMissing({ messageId: 10 })).toBe(false)
  })

  it('releases discarded preview URLs but retains URLs reused by a replacement list', () => {
    const messageList = ref([{ messageId: 1, localPreviewUrl: 'blob:keep' }])
    const collection = createMessageCollection(messageList)

    collection.replaceMessageList([
      { messageId: 2, localPreviewUrl: 'blob:keep' },
      { messageId: 3, localCoverUrl: 'blob:new' }
    ])
    collection.clear()

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:keep')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:new')
  })
})
