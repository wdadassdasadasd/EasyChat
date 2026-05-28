<template>
    <div
        :class="['message-video-card', disabled ? 'message-video-card-disabled' : '']"
        @click="openVideo"
    >
        <video
            v-if="message.localPreviewUrl"
            class="message-video-cover"
            :src="message.localPreviewUrl"
            preload="metadata"
            muted
        ></video>
        <ShowLocalImage
            v-else
            :fileId="message.messageId"
            :width="220"
            partType="chat"
            :fileType="message.fileType"
            :forceGet="message.forceGet"
            :showCover="true"
            @loaded="$emit('loaded')"
        />
        <div class="video-mask">
            <div class="play-button"></div>
        </div>
        <div class="video-name" :title="Utils.getFileMessageName(message)">
            {{ Utils.getFileMessageName(message) }}
        </div>
        <div class="video-status" v-if="message.uploading || message.status == 0">
            {{ message.uploading ? '上传中' : '未上传' }}
        </div>
    </div>
</template>

<script setup>
import { computed } from 'vue';
import ShowLocalImage from '@/components/ShowLocalImage.vue';
import Utils from '@/utils/Utils';

const props = defineProps({
    message: {
        type: Object,
        default: () => ({})
    }
});

const emit = defineEmits(['loaded', 'open']);

const disabled = computed(() => Utils.isVideoPreviewDisabled(props.message));

const openVideo = () => {
    if (disabled.value) {
        return;
    }
    emit('open', props.message);
};
</script>

<style lang="scss" scoped>
.message-video-card {
    position: relative;
    width: 220px;
    height: 138px;
    overflow: hidden;
    border-radius: 4px;
    background: #1f2329;
    cursor: pointer;
}

.message-video-card-disabled {
    cursor: not-allowed;
}

.message-video-cover {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
}

.message-video-card :deep(.image-panel) {
    width: 100%;
    height: 100%;
}

.message-video-card :deep(.el-image) {
    width: 100%;
    height: 100%;
}

.video-mask {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.18);
}

.play-button {
    width: 42px;
    height: 42px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.46);
    position: relative;
}

.play-button::after {
    content: '';
    position: absolute;
    left: 17px;
    top: 12px;
    border-left: 14px solid #fff;
    border-top: 9px solid transparent;
    border-bottom: 9px solid transparent;
}

.video-name {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 18px 8px 7px;
    color: #fff;
    font-size: 12px;
    line-height: 16px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.68), rgba(0, 0, 0, 0));
}

.video-status {
    position: absolute;
    top: 7px;
    right: 7px;
    padding: 2px 6px;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: 12px;
}
</style>
