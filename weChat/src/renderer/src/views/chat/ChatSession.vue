<template>
    <!-- 左侧会话列表的一项：头像、会话名、最后消息、时间、群/置顶标记。 -->
    <div :class="['chat-session-item', currentSession ? 'active' : '']">
        <!-- contactId 可以是好友 ID，也可以是群 ID，用它加载头像。 -->
        <AvatarBase :userId="data.contactId" :width="45" :borderRadius="4"></AvatarBase>
        <div class="user-info">
            <div class="user-panel">
                <!-- contactName 是会话名称：单聊显示好友名，群聊显示群名。 -->
                <div class="user-name">{{ data.contactName }}</div>
                <!-- lastReceiveTime 是最后一条消息时间，用工具方法格式化展示。 -->
                <div class="message-time">{{ proxy.Utils.formData(data.lastReceiveTime) }}</div>
            </div>
            <!-- lastMessage 是左侧会话预览内容；这里用 v-html 是为了兼容表情/富文本片段。 -->
            <div class="last-message" v-html="data.lastMessage"></div>
        </div>
        <!-- contactType == 1 表示群聊。 -->
        <div class="contact-tag" v-if="data.contactType==1">群</div>
        <!-- topType == 1 表示这个会话已置顶。 -->
        <el-icon class="chat-top" v-if="data.topType==1">
            <Top />
        </el-icon>
    </div>
</template>

<script setup>
import { ref, getCurrentInstance } from 'vue';
import AvatarBase from '@/components/AvatarBase.vue';

const { proxy } = getCurrentInstance();

// data 是一条会话记录；currentSession 表示它是否是当前选中的会话。
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
