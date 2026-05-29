<template>
    <div class="chat-panel">
        <DynamicScroller
            v-if="messageList.length > 0"
            :class="['message-panel', 'message-panel-' + messagePanelPhase]"
            id="message-panel"
            ref="messagePanelRef"
            :items="renderList"
            :min-item-size="64"
            key-field="key"
            @scroll.passive="handleScroll"
            @wheel.passive="$emit('userScroll')"
            @pointerdown="$emit('userScroll')"
        >
            <template #before>
                <div v-if="messageLoadingMore" class="message-loading-tip">Loading...</div>
            </template>
            <template #default="{ item, index, active }">
                <DynamicScrollerItem
                    :item="item"
                    :active="active"
                    :index="index"
                    :size-dependencies="getSizeDependencies(item)"
                    class="message-virtual-item"
                >
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
                        @openVideoPreview="$emit('openVideoPreview', $event)"
                    />
                </DynamicScrollerItem>
            </template>
            <template #after>
                <div ref="messageBottomRef" class="message-bottom-anchor"></div>
            </template>
        </DynamicScroller>
        <div
            v-else
            :class="['message-panel', 'message-panel-' + messagePanelPhase]"
            id="message-panel"
            ref="messagePanelRef"
        >
            <div class="chat-empty">
                <div class="empty-tip">{{ welcomeText }}</div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller';
import ChatMessage from './ChatMessage.vue';

const emit = defineEmits(['imageLoaded', 'loadMore', 'openFilePreview', 'openVideoPreview', 'userScroll']);

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
        return `Yesterday ${timeText}`;
    }
    if (dayDiff > 1 && dayDiff < 7) {
        const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return `${weekdays[date.getDay()]} ${timeText}`;
    }
    if (date.getFullYear() === now.getFullYear()) {
        return `${date.getMonth() + 1}/${date.getDate()} ${timeText}`;
    }
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${timeText}`;
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

const getSizeDependencies = (item) => {
    if (item.type === 'time') {
        return [item.text];
    }
    const message = item.message || {};
    return [
        message.messageContent,
        message.fileName,
        message.fileSize,
        message.filePath,
        message.status,
        message.forceGet
    ];
};

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

.message-panel-entering {
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

.message-virtual-item {
    box-sizing: border-box;
}

.message-bottom-anchor {
    height: 1px;
}

.message-loading-tip,
.message-time-divider {
    color: #9a9a9a;
    font-size: 13px;
    line-height: 20px;
    text-align: center;
}

.message-loading-tip {
    padding-bottom: 10px;
    pointer-events: none;
}

.message-time-divider {
    margin: 10px 0 18px;
}

.chat-empty {
    min-height: 100%;
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
