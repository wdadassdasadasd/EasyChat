import { computed, ref, shallowRef } from 'vue'

/**
 * 将消息映射为稳定的高度缓存键，避免 prepend 后索引漂移导致测量数据失效。
 */
const getMessageKey = (message, index) => {
  if (message?.messageId != null) {
    return String(message.messageId)
  }
  // 没有 messageId 的乐观消息用索引前缀兜底。
  return `_idx_${index}`
}

/**
 * 基于测量高度的虚拟消息列表。
 * - 只渲染视口 + overscan 范围内的消息，其余用 spacer 撑开高度。
 * - 高度缓存按 messageId 键存储，向列表头部 prepend 历史消息不会使已有测量失效。
 * - 通过二分查找在累积高度数组中定位可见范围，O(log n) 每次滚动。
 *
 * @param {import('vue').Ref<Array>} messageList 消息列表 Ref
 * @param {{ estimateHeight?: number, overscan?: number }} options
 */
/**
 * 长聊天记录的虚拟滚动管理入口。
 *
 * 按 messageId 缓存测量高度，计算带 overscan 的可视窗口，
 * 对外暴露上下占位高度，并为外层滚动控制提供稳定的底部距离计算。
 */
export const useVirtualMessageList = (messageList, { estimateHeight = 76, overscan = 8 } = {}) => {
  // 消息高度缓存：key → 测量高度（px）。shallowRef + version 避免全量 reactive 开销。
  const heightMap = shallowRef(new Map())
  const heightVersion = ref(0)
  // 增量更新：记录最早被修改高度的索引，accumulatedHeights 只从该位置开始重算前缀和。
  let heightDirtyFrom = -1
  let prevAcc = []

  const scrollTop = ref(0)
  const viewportHeight = ref(0)

  const notifyHeightChange = () => {
    heightVersion.value += 1
  }

  /** 记录一条消息的测量高度。prepend 后旧消息的 messageId 不变，缓存继续有效。 */
  const setMessageHeight = (message, index, height) => {
    const key = getMessageKey(message, index)
    const map = heightMap.value
    const prev = map.get(key)
    if (prev !== height) {
      map.set(key, height)
      if (heightDirtyFrom < 0 || index < heightDirtyFrom) {
        heightDirtyFrom = index
      }
      notifyHeightChange()
    }
  }

  const getHeight = (index) => {
    const msg = messageList.value[index]
    if (!msg) {
      return estimateHeight
    }
    return heightMap.value.get(getMessageKey(msg, index)) || estimateHeight
  }

  // 累积高度数组：acc[i] = 前 i 条消息的虚拟高度（acc[0] = 0）。
  // 通过 heightDirtyFrom 实现增量更新，避免每次测量都 O(N) 全量重算。
  const accumulatedHeights = computed(() => {
    void heightVersion.value // 消费版本号以触发重新计算
    const list = messageList.value
    const n = list.length

    if (prevAcc.length !== n + 1 || heightDirtyFrom < 0) {
      // 消息数量变化或未跟踪到脏索引时全量重算。
      const acc = new Array(n + 1)
      acc[0] = 0
      for (let i = 0; i < n; i++) {
        acc[i + 1] = acc[i] + getHeight(i)
      }
      prevAcc = acc
      heightDirtyFrom = -1
      return acc
    }

    // 增量更新：从最早的脏索引处开始重算，之前的前缀和直接复用。
    const start = Math.max(0, heightDirtyFrom)
    for (let i = start; i < n; i++) {
      prevAcc[i + 1] = prevAcc[i] + getHeight(i)
    }
    heightDirtyFrom = -1
    return prevAcc
  })

  const totalHeight = computed(() => {
    const acc = accumulatedHeights.value
    return acc[acc.length - 1] || 0
  })

  // 二分查找第一个 acc[i] > target 的索引。
  const upperBound = (acc, target, lo, hi) => {
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (acc[mid] <= target) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }
    return lo
  }

  const startIndex = computed(() => {
    const length = messageList.value.length
    if (length === 0) return 0
    const acc = accumulatedHeights.value
    const raw = upperBound(acc, scrollTop.value, 0, length)
    return Math.max(0, raw - overscan)
  })

  const endIndex = computed(() => {
    const length = messageList.value.length
    if (length === 0) return 0
    const acc = accumulatedHeights.value
    const bottom = scrollTop.value + viewportHeight.value
    const raw = upperBound(acc, bottom, startIndex.value, length)
    return Math.min(length, raw + overscan)
  })

  const visibleMessages = computed(() => {
    return messageList.value.slice(startIndex.value, endIndex.value)
  })

  const topSpacerHeight = computed(() => {
    const acc = accumulatedHeights.value
    const s = startIndex.value
    return s < acc.length ? acc[s] : 0
  })

  const bottomSpacerHeight = computed(() => {
    const acc = accumulatedHeights.value
    const e = endIndex.value
    const total = totalHeight.value
    const endOffset = e < acc.length ? acc[e] : total
    return Math.max(0, total - endOffset)
  })

  const handleScroll = (event) => {
    const target = event?.target
    if (target) {
      scrollTop.value = target.scrollTop
      viewportHeight.value = target.clientHeight
    }
  }

  const getEffectiveScrollHeight = (containerEl) => {
    return Math.max(totalHeight.value, containerEl?.scrollHeight || 0)
  }

  /** 滚动到底部。使用容器实际 scrollHeight 兜底，处理测量误差。 */
  const scrollToBottom = (containerEl) => {
    if (!containerEl) return
    containerEl.scrollTop = Math.max(
      0,
      getEffectiveScrollHeight(containerEl) - containerEl.clientHeight
    )
  }

  /** 底部剩余距离（px），0 表示已到底。 */
  const getBottomGap = (containerEl) => {
    if (!containerEl) return 0
    return Math.max(
      0,
      getEffectiveScrollHeight(containerEl) - containerEl.scrollTop - containerEl.clientHeight
    )
  }

  /** 清空高度缓存（会话切换/清空记录时调用，避免内存无限增长）。 */
  const resetHeightMap = () => {
    heightMap.value = new Map()
    notifyHeightChange()
  }

  /** 完整滚动状态快照。scrollHeight 使用虚拟总高度以保证稳定性。 */
  const getScrollState = (containerEl) => {
    if (!containerEl) return null
    const total = getEffectiveScrollHeight(containerEl)
    return {
      scrollHeight: total,
      scrollTop: containerEl.scrollTop,
      clientHeight: containerEl.clientHeight,
      bottomGap: Math.max(0, total - containerEl.scrollTop - containerEl.clientHeight)
    }
  }

  return {
    bottomSpacerHeight,
    endIndex,
    getBottomGap,
    getScrollState,
    handleScroll,
    resetHeightMap,
    scrollToBottom,
    setMessageHeight,
    startIndex,
    topSpacerHeight,
    totalHeight,
    viewportHeight,
    visibleMessages
  }
}
