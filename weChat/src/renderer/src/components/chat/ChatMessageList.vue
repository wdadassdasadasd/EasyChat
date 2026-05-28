<template>
    <div class="chat-panel">
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
                    <template v-for="item in renderList" :key="item.key">
                        <div v-if="item.type === 'time'" class="message-time-divider">
                            {{ item.text }}
                        </div>
                        <ChatMessage
                            v-else
                            :message="item.message"
                            :currentChatSession="currentChatSession"
                            :currentUserId="currentUserId"
                            :showGroupMemberNick="showGroupMemberNick"
                            @imageLoaded="$emit('imageLoaded')"
                            @openFilePreview="$emit('openFilePreview', $event)"
                        />
                    </template>
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
import { computed, ref } from 'vue';
import ChatMessage from './ChatMessage.vue';

const emit = defineEmits(['imageLoaded', 'loadMore', 'openFilePreview', 'userScroll']);

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
});

const messagePanelRef = ref(null);
const messageBottomRef = ref(null);
const TIME_SEPARATOR_GAP = 5 * 60 * 1000;
const LOAD_MORE_THRESHOLD = 80;

const normalizeTimestamp = (time) => {
    const timestamp = Number(time);
    if (!timestamp || Number.isNaN(timestamp)) {
        return 0;
    }
    return timestamp < 100000000000 ? timestamp * 1000 : timestamp;
};

const getStartOfDay = (date) => {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

const formatMessageTime = (time) => {
    const timestamp = normalizeTimestamp(time);
    if (!timestamp) {
        return '';
    }

    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    const now = new Date();
    const dayDiff = Math.floor((getStartOfDay(now) - getStartOfDay(date)) / (24 * 60 * 60 * 1000));
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const timeText = `${hour}:${minute}`;

    if (dayDiff === 0) {
        return timeText;
    }
    if (dayDiff === 1) {
        return `昨天 ${timeText}`;
    }
    if (dayDiff > 1 && dayDiff < 7) {
        const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        return `${weekdays[date.getDay()]} ${timeText}`;
    }
    if (date.getFullYear() === now.getFullYear()) {
        return `${date.getMonth() + 1}月${date.getDate()}日 ${timeText}`;
    }
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${timeText}`;
};

const renderList = computed(() => {
    const list = [];
    let previousTime = 0;

    props.messageList.forEach((message, index) => {
        const currentTime = normalizeTimestamp(message?.sendTime);
        const shouldShowTime = currentTime && (index === 0 || !previousTime || currentTime - previousTime >= TIME_SEPARATOR_GAP);
        if (shouldShowTime) {
            list.push({
                type: 'time',
                key: `time-${message.messageId || index}-${currentTime}`,
                text: formatMessageTime(currentTime)
            });
        }
        list.push({
            type: 'message',
            key: `message-${message.messageId || index}`,
            message
        });
        if (currentTime) {
            previousTime = currentTime;
        }
    });

    return list;
});

const handleScroll = (event) => {
    const target = event.target;
    if (!target || props.messageLoadingMore || props.messagePanelPhase !== 'ready') {
        return;
    }
    if (target.scrollTop <= LOAD_MORE_THRESHOLD) {
        emit('loadMore');
    }
};

defineExpose({
    messageBottomRef,
    messagePanelRef
});
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
    margin: 10px 0 18px;
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
