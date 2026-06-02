<template>
    <!-- 单条消息只做展示分发：文本直接渲染，媒体按 messageType/fileType 下发到专用组件。 -->
    <div :id="'message' + message.messageId" :class="['message-row', isSelf ? 'message-row-self' : '']">
        <AvatarBase
            v-if="!isSelf"
            :userId="message.sendUserId"
            :width="36"
            :borderRadius="4"
            class="message-avatar"
        />
        <div :class="['message-body', isSelf ? 'message-body-self' : '']">
            <div
                v-if="currentChatSession.contactType == 1 && !isSelf && showGroupMemberNick"
                class="message-nick"
            >{{ message.sendUserNickName }}</div>
            <div :class="['message-item', isSelf ? 'message-item-self' : '', isMediaMessage ? 'message-item-media' : '', Utils.isFileMessage(message) ? 'message-item-file' : '']">
                <ChatMessageImage
                    v-if="Utils.isImageMessage(message)"
                    :message="message"
                    @loaded="$emit('imageLoaded')"
                />
                <ChatMessageVideo
                    v-else-if="Utils.isVideoMessage(message)"
                    :message="message"
                    @loaded="$emit('imageLoaded')"
                    @open="$emit('openVideoPreview', $event)"
                />
                <ChatMessageFile
                    v-else-if="Utils.isFileMessage(message)"
                    :message="message"
                    :isSelf="isSelf"
                    @open="$emit('openFilePreview', $event)"
                />
                <template v-else>
                    {{ message.messageContent }}
                </template>
            </div>
        </div>
        <AvatarBase
            v-if="isSelf"
            :userId="message.sendUserId"
            :width="36"
            :borderRadius="4"
            class="message-avatar"
        />
    </div>
</template>

<script setup>
import { computed } from 'vue';
import AvatarBase from '@/components/AvatarBase.vue';
import Utils from '@/utils/Utils';
import ChatMessageFile from './ChatMessageFile.vue';
import ChatMessageImage from './ChatMessageImage.vue';
import ChatMessageVideo from './ChatMessageVideo.vue';

const props = defineProps({
    currentChatSession: {
        type: Object,
        default: () => ({})
    },
    currentUserId: {
        type: [String, Number],
        default: ''
    },
    message: {
        type: Object,
        default: () => ({})
    },
    showGroupMemberNick: {
        type: Boolean,
        default: true
    }
});

defineEmits(['imageLoaded', 'openFilePreview', 'openVideoPreview']);

const isSelf = computed(() => {
    // 自己发送的消息右对齐，别人消息左对齐；群聊昵称展示也依赖这个判断。
    return Utils.isSelfMessage(props.message, props.currentUserId);
});

const isMediaMessage = computed(() => {
    // 图片和视频不使用普通气泡 padding，避免媒体预览被白底包裹。
    return Utils.isImageMessage(props.message) || Utils.isVideoMessage(props.message);
});
</script>

<style lang="scss" scoped>
.message-row {
    box-sizing: border-box;
    flex-shrink: 0;
    display: flex;
    padding-bottom: 14px;
    align-items: flex-start;
}

.message-row-self {
    justify-content: flex-end;
}

.message-avatar {
    flex-shrink: 0;
}

.message-body {
    max-width: min(68%, 560px);
    margin: 0 10px;
}

.message-body-self {
    text-align: right;
}

.message-nick {
    font-size: 12px;
    color: #999;
    margin-bottom: 3px;
    padding-left: 2px;
    line-height: 1.4;
}

.message-item {
    display: inline-block;
    padding: 9px 13px;
    border-radius: 4px;
    background: #ffffff;
    color: #333;
    line-height: 1.6;
    word-break: break-word;
    box-shadow: 0 1px 1px rgba(0, 0, 0, 0.04);
    text-align: left;
}

.message-item-self {
    background: #95ec69;
}

.message-item-media {
    padding: 0;
    background: transparent;
    box-shadow: none;
}

.message-item-file {
    padding: 0;
    background: transparent;
    box-shadow: none;
}
</style>
