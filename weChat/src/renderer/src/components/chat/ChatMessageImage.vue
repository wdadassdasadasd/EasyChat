<template>
    <div class="message-image-frame">
        <el-image
            v-if="message.localPreviewUrl"
            :src="message.localPreviewUrl"
            class="message-image"
            fit="scale-down"
            :preview-src-list="[message.localPreviewUrl]"
            :preview-teleported="true"
            :hide-on-click-modal="true"
            @load="$emit('loaded')"
        />
        <ShowLocalImage
            v-else
            :fileId="message.messageId"
            :width="220"
            partType="chat"
            :fileType="message.fileType"
            :forceGet="message.forceGet"
            :preview="true"
            @loaded="$emit('loaded')"
        />
    </div>
</template>

<script setup>
import ShowLocalImage from '@/components/ShowLocalImage.vue';

defineProps({
    message: {
        type: Object,
        default: () => ({})
    }
});

defineEmits(['loaded']);
</script>

<style lang="scss" scoped>
.message-image-frame {
    width: min(520px, 62vw);
    aspect-ratio: 16 / 10;
    min-height: 156px;
    max-height: 260px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-radius: 4px;
    background: transparent;
}

.message-image {
    display: block;
    max-width: 100%;
    max-height: 260px;
    border-radius: 4px;
    object-fit: contain;
}

.message-image-frame :deep(.image-panel) {
    width: 100%;
    height: 100%;
}

.message-image-frame :deep(.el-image) {
    max-width: 100%;
    max-height: 260px;
}
</style>
