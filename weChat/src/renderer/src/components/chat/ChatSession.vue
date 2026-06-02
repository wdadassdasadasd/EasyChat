<template>
    <!-- 左侧会话项展示会话快照：未读数、最后一条消息、置顶状态都来自本地会话表。 -->
    <div :class="['chat-session-item', currentSession ? 'active' : '']">
        <div class="avatar-wrap">
            <AvatarBase :userId="data.contactId" :width="45" :borderRadius="4"></AvatarBase>
            <span class="unread-badge" v-if="unreadCount > 0">{{ unreadText }}</span>
        </div>
        <div class="user-info">
            <div class="user-panel">
                <div class="user-name">{{ data.contactName }}</div>
                <div class="message-time">{{ proxy.Utils.formData(data.lastReceiveTime) }}</div>
            </div>
            <div class="last-message" v-html="data.lastMessage"></div>
        </div>
        <div class="contact-tag" v-if="data.contactType==1">群</div>
        <el-icon class="chat-top" v-if="data.topType==1">
            <Top />
        </el-icon>
    </div>
</template>

<script setup>
import { computed, getCurrentInstance } from 'vue';
import AvatarBase from '@/components/AvatarBase.vue';

const { proxy } = getCurrentInstance();

const props = defineProps({
    data: {
        type: Object,
        default: () => ({})
    },
    currentSession: {
        type: Boolean,
        default: false
    }
});

const unreadCount = computed(() => Number(props.data?.noReadCount || 0));
// 列表项红点只负责展示，清零逻辑在 useChatSessions.markSessionRead 中同步到主进程。
const unreadText = computed(() => unreadCount.value > 99 ? '99+' : String(unreadCount.value));
</script>

<style lang="scss" scoped>
.chat-session-item {
    display: flex;
    align-items: center;
    padding: 10px 12px;
    cursor: pointer;
    position: relative;
    transition: background 0.15s;

    &:hover {
        background: #d9d9d9;
    }

    &.active {
        background: #c6c6c6;
    }
}

.avatar-wrap {
    position: relative;
    flex: 0 0 45px;
    width: 45px;
    height: 45px;
}

.unread-badge {
    position: absolute;
    top: -6px;
    right: -7px;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: #fa5151;
    color: #fff;
    font-size: 11px;
    line-height: 18px;
    text-align: center;
    box-sizing: border-box;
    box-shadow: 0 0 0 2px #e5e5e5;
    z-index: 2;
}

.chat-session-item.active .unread-badge {
    box-shadow: 0 0 0 2px #c6c6c6;
}

.user-info {
    flex: 1;
    margin-left: 10px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
}

.user-panel {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
}

.user-name {
    font-size: 14px;
    color: #333;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
}

.message-time {
    font-size: 12px;
    color: #999;
    margin-left: 8px;
    flex-shrink: 0;
}

.last-message {
    font-size: 12px;
    color: #999;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.contact-tag {
    position: absolute;
    top: 6px;
    left: 6px;
    font-size: 10px;
    color: #fff;
    background: #07c160;
    padding: 0 3px;
    border-radius: 2px;
    line-height: 14px;
}

.chat-top {
    position: absolute;
    top: 6px;
    right: 6px;
    font-size: 12px;
    color: #fa9d3b;
}
</style>
