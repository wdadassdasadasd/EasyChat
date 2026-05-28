<template>
    <el-dialog
        :model-value="modelValue"
        width="760px"
        top="42px"
        class="video-preview-dialog"
        :show-close="true"
        :close-on-click-modal="true"
        :append-to-body="true"
        @update:model-value="$emit('update:modelValue', $event)"
        @closed="$emit('closed')"
    >
        <div class="video-preview-panel">
            <div class="video-title" :title="videoName">{{ videoName }}</div>
            <div class="video-stage" v-loading="loading" :element-loading-text="loadingText">
                <video
                    v-if="videoUrl"
                    class="video-player"
                    :src="videoUrl"
                    controls
                    autoplay
                    playsinline
                    @error="$emit('videoError')"
                ></video>
                <div v-if="errorText" class="video-error">
                    {{ errorText }}
                </div>
                <div v-else-if="!videoUrl" class="video-empty">
                    {{ loading ? '加载中...' : '视频暂时无法预览' }}
                </div>
            </div>
            <div class="video-footer">
                <span>{{ Utils.formatFileSize(message?.fileSize, { emptyForZero: true }) }}</span>
                <el-progress
                    v-if="loading"
                    class="video-footer-progress"
                    :percentage="safeProgress"
                    :indeterminate="safeProgress <= 0"
                    :show-text="false"
                    :stroke-width="4"
                />
                <div class="video-actions">
                    <el-button size="small" :disabled="loading || !message" @click="$emit('openExternal')">系统播放器打开</el-button>
                    <el-button size="small" :disabled="loading || !message" @click="$emit('download')">下载</el-button>
                </div>
            </div>
        </div>
    </el-dialog>
</template>

<script setup>
import { computed } from 'vue';
import Utils from '@/utils/Utils';

const props = defineProps({
    loading: {
        type: Boolean,
        default: false
    },
    errorText: {
        type: String,
        default: ''
    },
    message: {
        type: Object,
        default: null
    },
    modelValue: {
        type: Boolean,
        default: false
    },
    videoUrl: {
        type: String,
        default: ''
    },
    progress: {
        type: Number,
        default: 0
    }
});

defineEmits(['closed', 'download', 'openExternal', 'update:modelValue', 'videoError']);

const videoName = computed(() => Utils.getFileMessageName(props.message || {}));
const safeProgress = computed(() => Math.min(100, Math.max(0, Number(props.progress) || 0)));
const loadingText = computed(() => {
    if (!props.loading) {
        return '';
    }
    return safeProgress.value > 0 ? `正在加载视频 ${safeProgress.value}%` : '正在加载视频...';
});
</script>

<style lang="scss" scoped>
:deep(.video-preview-dialog) {
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 18px 56px rgba(0, 0, 0, 0.24);
    -webkit-app-region: no-drag;
}

:deep(.video-preview-dialog .el-dialog__header) {
    height: 42px;
    padding: 0;
    margin: 0;
    background: #1f1f1f;
}

:deep(.video-preview-dialog .el-dialog__headerbtn) {
    top: 10px;
    right: 14px;
}

:deep(.video-preview-dialog .el-dialog__close) {
    color: #d8d8d8;
}

:deep(.video-preview-dialog .el-dialog__body) {
    padding: 0;
}

.video-preview-panel {
    background: #151515;
    color: #fff;
}

.video-title {
    height: 42px;
    padding: 0 54px 0 18px;
    display: flex;
    align-items: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #f5f5f5;
    font-size: 14px;
}

.video-stage {
    position: relative;
    height: 430px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
}

.video-player {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
    background: #000;
}

.video-empty {
    color: #aaa;
    font-size: 14px;
}

.video-error {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    max-width: 520px;
    padding: 10px 14px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.68);
    color: #fff;
    font-size: 13px;
    line-height: 1.6;
    text-align: center;
}

.video-footer {
    height: 52px;
    padding: 0 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: #aaa;
    font-size: 13px;
    background: #1f1f1f;
}

.video-footer-progress {
    width: 180px;
    margin-left: auto;
    margin-right: 12px;
}

.video-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}
</style>
