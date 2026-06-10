<template>
  <div class="chat-panel">
    <!-- 消息滚动容器：使用虚拟列表只渲染视口内消息，spacer 维持滚动高度。 -->
    <div
      :class="['message-panel', 'message-panel-' + messagePanelPhase]"
      id="message-panel"
      ref="messagePanelRef"
      @scroll.passive="handleScroll"
      @wheel.passive="$emit('userScroll')"
      @pointerdown="$emit('userScroll')"
    >
      <div class="message-panel-content">
        <template v-if="messageList.length > 0">
          <div v-if="messageLoadingMore" class="message-loading-tip">加载中...</div>
          <!-- 虚拟列表顶部占位 -->
          <div class="message-list-spacer" :style="{ height: topSpacerHeight + 'px' }"></div>
          <!-- 仅渲染可见窗口内的消息 + 时间分割线 -->
          <template v-for="item in visibleRenderList" :key="item.key">
            <div v-if="item.type === 'time'" class="message-time-divider">
              {{ item.text }}
            </div>
            <div v-else class="message-row-wrapper" :data-msg-key="item.msgKey">
              <ChatMessage
                :message="item.message"
                :currentChatSession="currentChatSession"
                :currentUserId="currentUserId"
                :showGroupMemberNick="showGroupMemberNick"
                @imageLoaded="onMessageImageLoaded"
                @openFilePreview="$emit('openFilePreview', $event)"
                @openVideoPreview="$emit('openVideoPreview', $event)"
                @cancelUploadMessage="$emit('cancelUploadMessage', $event)"
                @retryMessage="$emit('retryMessage', $event)"
              />
            </div>
          </template>
          <!-- 虚拟列表底部占位 -->
          <div class="message-list-spacer" :style="{ height: bottomSpacerHeight + 'px' }"></div>
          <div ref="messageBottomRef" class="message-bottom-anchor"></div>
        </template>
        <div class="chat-empty" v-else>
          <div class="empty-tip">{{ welcomeText }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, toRef, watch } from 'vue'
import ChatMessage from './ChatMessage.vue'
import { useVirtualMessageList } from '@/views/chat/composables/useVirtualMessageList'
import { CHAT_CONSTANTS } from '@/utils/ChatConstants'

const { LOAD_MORE_THRESHOLD, TIME_SEPARATOR_GAP, VIRTUAL_ESTIMATE_HEIGHT, VIRTUAL_OVERSCAN } =
  CHAT_CONSTANTS

const emit = defineEmits([
  'imageLoaded',
  'loadMore',
  'openFilePreview',
  'openVideoPreview',
  'cancelUploadMessage',
  'retryMessage',
  'userScroll'
])

const props = defineProps({
  currentChatSession: {
    type: Object,
    default: () => ({})
  },
  currentUserId: {
    type: [String, Number],
    default: ''
  },
  messageList: {
    type: Array,
    default: () => []
  },
  messagePanelPhase: {
    type: String,
    default: 'ready'
  },
  messageLoadingMore: {
    type: Boolean,
    default: false
  },
  showGroupMemberNick: {
    type: Boolean,
    default: true
  },
  welcomeText: {
    type: String,
    default: ''
  }
})

const messagePanelRef = ref(null)
const messageBottomRef = ref(null)
const LOAD_MORE_THRESHOLD_PX = LOAD_MORE_THRESHOLD

const normalizeTimestamp = (time) => {
  const timestamp = Number(time)
  if (!timestamp || Number.isNaN(timestamp)) {
    return 0
  }
  return timestamp < 100000000000 ? timestamp * 1000 : timestamp
}

const getStartOfDay = (date) => {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

const formatMessageTime = (time) => {
  const timestamp = normalizeTimestamp(time)
  if (!timestamp) {
    return ''
  }
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const now = new Date()
  const dayDiff = Math.floor((getStartOfDay(now) - getStartOfDay(date)) / (24 * 60 * 60 * 1000))
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const timeText = `${hour}:${minute}`
  if (dayDiff === 0) return timeText
  if (dayDiff === 1) return `昨天 ${timeText}`
  if (dayDiff > 1 && dayDiff < 7) {
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
    return `${weekdays[date.getDay()]} ${timeText}`
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${timeText}`
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${timeText}`
}

// 虚拟列表：只渲染视口 ± overscan 范围内的消息。
const {
  bottomSpacerHeight,
  getBottomGap: getVirtualBottomGap,
  getScrollState: getVirtualScrollState,
  handleScroll: onVirtualScroll,
  resetHeightMap,
  scrollToBottom: virtualScrollToBottom,
  setMessageHeight,
  startIndex,
  topSpacerHeight,
  visibleMessages
} = useVirtualMessageList(toRef(props, 'messageList'), {
  estimateHeight: VIRTUAL_ESTIMATE_HEIGHT,
  overscan: VIRTUAL_OVERSCAN
})

// 可见消息 + 时间分割线，考虑上一消息的发送时间以保证分割线正确。
const visibleRenderList = computed(() => {
  const list = []
  const start = startIndex.value
  const visible = visibleMessages.value
  if (visible.length === 0) {
    return list
  }

  // 取窗口前一条消息的时间作为时间分割线基准。
  const prevMessage = start > 0 ? props.messageList[start - 1] : null
  let previousTime = prevMessage ? normalizeTimestamp(prevMessage.sendTime) : 0

  visible.forEach((message, index) => {
    const globalIndex = start + index
    const currentTime = normalizeTimestamp(message?.sendTime)
    const shouldShowTime =
      currentTime &&
      (index === 0 || !previousTime || currentTime - previousTime >= TIME_SEPARATOR_GAP)
    if (shouldShowTime) {
      list.push({
        type: 'time',
        key: `time-${message.messageId || globalIndex}-${currentTime}`,
        text: formatMessageTime(currentTime)
      })
    }
    const msgKey = message?.messageId != null ? String(message.messageId) : `_idx_${globalIndex}`
    list.push({
      type: 'message',
      key: `message-${msgKey}`,
      message,
      msgIndex: globalIndex,
      msgKey
    })
    if (currentTime) {
      previousTime = currentTime
    }
  })

  return list
})

// 滚动事件同时触发虚拟列表定位和触顶分页。
const handleScroll = (event) => {
  onVirtualScroll(event)
  const target = event.target
  if (!target || props.messageLoadingMore || props.messagePanelPhase !== 'ready') {
    return
  }
  if (target.scrollTop <= LOAD_MORE_THRESHOLD_PX) {
    emit('loadMore')
  }
}

// 测量已渲染消息的实际高度，并回填到虚拟列表高度缓存。
// 时间分割线没有独立的 data-msg-key，其高度并入后面第一条消息的测量值，
// 这样虚拟列表的累积高度计算才能与实际 DOM 布局匹配。
const measureVisibleHeights = async () => {
  await nextTick()
  await new Promise((resolve) => window.requestAnimationFrame(resolve))
  const panel = messagePanelRef.value
  if (!panel) return
  const rows = panel.querySelectorAll('[data-msg-key]')
  rows.forEach((row) => {
    const msgKey = row.dataset.msgKey
    const item = visibleRenderList.value.find((v) => v.msgKey === msgKey)
    if (item && item.msgIndex != null && row.offsetHeight > 0) {
      // 检查前一个兄弟元素是否为时间分割线，其高度需要并入本条消息测量值。
      let extraHeight = 0
      const prevSibling = row.previousElementSibling
      if (prevSibling && prevSibling.classList.contains('message-time-divider')) {
        extraHeight = prevSibling.offsetHeight
      }
      setMessageHeight(item.message, item.msgIndex, row.offsetHeight + extraHeight)
    }
  })
}

// 每次可见消息变化后重新测量高度。
watch(
  visibleRenderList,
  () => {
    measureVisibleHeights()
  },
  { flush: 'post' }
)

// 图片/视频封面加载完成后重新测量，布局可能变高。
const onMessageImageLoaded = async () => {
  await measureVisibleHeights()
  emit('imageLoaded')
}

// 外部调用的 API（保持与旧版兼容）。
const getMessagePanelElement = () => {
  return messagePanelRef.value
}

const setElementToBottom = () => {
  const messagePanel = messagePanelRef.value
  if (!messagePanel) return
  const previousScrollBehavior = messagePanel.style.scrollBehavior
  messagePanel.style.scrollBehavior = 'auto'
  virtualScrollToBottom(messagePanel)
  if (previousScrollBehavior) {
    messagePanel.style.scrollBehavior = previousScrollBehavior
  } else {
    messagePanel.style.removeProperty('scroll-behavior')
  }
}

const scrollToBottom = () => {
  setElementToBottom()
}

const getBottomGap = () => {
  return getVirtualBottomGap(messagePanelRef.value)
}

const getScrollState = () => {
  return getVirtualScrollState(messagePanelRef.value)
}

defineExpose({
  getBottomGap,
  getMessagePanelElement,
  getScrollState,
  messageBottomRef,
  messagePanelRef,
  resetHeightMap,
  scrollToBottom
})
</script>

<style lang="scss" scoped>
.chat-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  background: #f5f5f5;
}

.message-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 20px 28px 16px;
  scroll-behavior: auto;
  overscroll-behavior: contain;
  overflow-anchor: none;
}

.message-panel-preparing {
  visibility: hidden;
  pointer-events: none;
}

.message-panel-content {
  position: relative;
  flex: 0 0 auto;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}

.message-panel-entering .message-panel-content {
  animation: message-panel-enter 100ms cubic-bezier(0.2, 0, 0, 1) both;
  will-change: opacity;
}

@keyframes message-panel-enter {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.message-list-spacer {
  flex-shrink: 0;
  width: 1px;
}

.message-row-wrapper {
  flex-shrink: 0;
}

.message-bottom-anchor {
  flex-shrink: 0;
  height: 1px;
}

.message-loading-tip,
.message-time-divider {
  flex-shrink: 0;
  color: #9a9a9a;
  font-size: 13px;
  line-height: 20px;
  text-align: center;
}

.message-loading-tip {
  position: absolute;
  left: 0;
  right: 0;
  top: -14px;
  pointer-events: none;
}

.message-time-divider {
  padding: 10px 0 18px;
}

.chat-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #f5f5f5;
}

.empty-tip {
  color: #aaa;
  font-size: 14px;
  line-height: 1.8;
  text-align: center;
}
</style>
