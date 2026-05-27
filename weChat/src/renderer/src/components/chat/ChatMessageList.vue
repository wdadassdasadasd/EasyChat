<template>
    <div class="chat-panel">
        <div
            :class="['message-panel', 'message-panel-' + messagePanelPhase]"
            id="message-panel"
            ref="messagePanelRef"
            @wheel.passive="$emit('userScroll')"
            @pointerdown="$emit('userScroll')"
        >
            <div class="message-panel-content">
                <template v-if="messageList.length > 0">
                    <ChatMessage
                        v-for="(data, index) in messageList"
                        :key="data.messageId || index"
                        :message="data"
                        :currentChatSession="currentChatSession"
                        :currentUserId="currentUserId"
                        :showGroupMemberNick="showGroupMemberNick"
                        @imageLoaded="$emit('imageLoaded')"
                        @openFilePreview="$emit('openFilePreview', $event)"
                    />
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
import { ref } from 'vue';
import ChatMessage from './ChatMessage.vue';

defineProps({
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
    showGroupMemberNick: {
        type: Boolean,
        default: true
    },
    welcomeText: {
        type: String,
        default: ''
    }
});

defineEmits(['imageLoaded', 'loadMore', 'openFilePreview', 'userScroll']);

const messagePanelRef = ref(null);
const messageBottomRef = ref(null);

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
