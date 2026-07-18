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
            <div v-if="isSelf && showSendState" class="message-send-state">
                <template v-if="message.status == 2">
                    <span>{{ sendingText }}</span>
                    <button
                        v-if="message.uploading || message.uploadPaused || message.uploadWaitingNetwork"
                        class="message-retry-btn"
                        type="button"
                        @click="$emit('cancelUploadMessage', message)"
                    >Cancel</button>
                    <button
                        v-if="message.messageType == 5 && (message.uploading || message.uploadPaused)"
                        class="message-retry-btn"
                        type="button"
                        @click="$emit('toggleUploadPause', message)"
                    >{{ message.uploadPaused ? 'Resume' : 'Pause' }}</button>
                </template>
                <button
                    v-else-if="message.status == 0"
                    class="message-retry-btn"
                    type="button"
                    @click="$emit('retryMessage', message)"
                >Retry</button>
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

defineEmits(['cancelUploadMessage', 'toggleUploadPause', 'imageLoaded', 'openFilePreview', 'openVideoPreview', 'retryMessage']);

const isSelf = computed(() => {
    // 自己发送的消息右对齐，别人消息左对齐；群聊昵称展示也依赖这个判断。
    return Utils.isSelfMessage(props.message, props.currentUserId);
});

const isMediaMessage = computed(() => {
    // 图片和视频不使用普通气泡 padding，避免媒体预览被白底包裹。
    return Utils.isImageMessage(props.message) || Utils.isVideoMessage(props.message);
});

const showSendState = computed(() => {
    return props.message?.status == 0 || props.message?.status == 2;
});

const sendingText = computed(() => {
    if (props.message?.uploadWaitingNetwork) {
        return '等待网络恢复...';
    }
    if (props.message?.uploadAwaitingAck) {
        return '等待服务端确认...';
    }
    if (props.message?.uploadPaused) {
        return '上传已暂停';
    }
    if (props.message?.uploading) {
        const progress = Number(props.message?.uploadProgress || 0);
        return progress > 0 ? `Uploading ${progress}%` : 'Uploading...';
    }
    return 'Sending...';
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

.message-send-state {
    margin-top: 4px;
    color: #8a8a8a;
    font-size: 12px;
    line-height: 18px;
}

.message-retry-btn {
    padding: 0;
    border: none;
    background: transparent;
    color: #d93026;
    font-size: 12px;
    line-height: 18px;
    cursor: pointer;
}
</style>
