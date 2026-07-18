<template>
    <!-- 普通文件预览弹窗只负责确认接收，实际下载由 useFileTransfer 统一处理。 -->
    <el-dialog
        :model-value="modelValue"
        width="690px"
        top="60px"
        class="file-preview-dialog"
        :show-close="true"
        :close-on-click-modal="true"
        :append-to-body="true"
        @update:model-value="$emit('update:modelValue', $event)"
        @closed="$emit('closed')"
    >
        <div class="file-preview-panel" v-if="message">
            <div class="file-preview-icon">
                <span>?</span>
            </div>
            <div class="file-preview-name">{{ Utils.getFileMessageName(message) }}</div>
            <div class="file-preview-size">文件大小：{{ Utils.formatFileSize(message.fileSize, { emptyForZero: true }) }}</div>
            <button
                class="file-preview-action"
                type="button"
                :disabled="Utils.isFileReceiveDisabled(message) || receiving"
                @click="$emit('receive')"
            >
                {{ actionText }}
            </button>
            <button
                v-if="downloadState?.status === 'downloading'"
                class="file-preview-cancel"
                type="button"
                @click="$emit('cancel')"
            >取消下载</button>
            <el-progress
                v-if="downloadState?.status === 'downloading'"
                class="file-preview-progress"
                :percentage="Number(downloadState.progress || 0)"
                :stroke-width="4"
            />
            <div v-if="downloadState?.status === 'failed'" class="file-preview-error">
                {{ downloadState.error || '下载失败' }}
            </div>
            <div v-if="downloadState?.status === 'done'" class="file-preview-path" :title="downloadState.path">
                {{ downloadState.path }}
            </div>
            <div v-if="downloadState?.status === 'done'" class="file-preview-actions">
                <button type="button" @click="$emit('openFile')">打开文件</button>
                <button type="button" @click="$emit('showInFolder')">打开所在文件夹</button>
            </div>
            <div class="file-preview-expire">将在13天后无法下载</div>
        </div>
    </el-dialog>
</template>

<script setup>
import { computed } from 'vue';
import Utils from '@/utils/Utils';

const props = defineProps({
    message: {
        type: Object,
        default: null
    },
    modelValue: {
        type: Boolean,
        default: false
    },
    receiving: {
        type: Boolean,
        default: false
    },
    downloadState: {
        type: Object,
        default: () => ({})
    }
});

defineEmits(['cancel', 'closed', 'openFile', 'receive', 'showInFolder', 'update:modelValue']);

const actionText = computed(() => {
    if (props.downloadState?.status === 'downloading' || props.receiving) {
        return `接收中 ${Number(props.downloadState?.progress || 0)}%`;
    }
    if (props.downloadState?.status === 'failed') {
        return '重试下载';
    }
    if (props.downloadState?.status === 'done') {
        return '重新下载';
    }
    return '接收文件';
});
</script>

<style lang="scss" scoped>
:deep(.file-preview-dialog) {
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 18px 56px rgba(0, 0, 0, 0.24);
    -webkit-app-region: no-drag;
}

:deep(.file-preview-dialog .el-dialog__header) {
    height: 44px;
    padding: 0;
    margin: 0;
}

:deep(.file-preview-dialog .el-dialog__headerbtn) {
    top: 12px;
    right: 18px;
    width: 24px;
    height: 24px;
    font-size: 18px;
}

:deep(.file-preview-dialog .el-dialog__body) {
    padding: 0;
}

.file-preview-panel {
    min-height: 455px;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 34px 48px 56px;
    background: #fff;
    color: #111;
    text-align: center;
}

.file-preview-icon {
    position: relative;
    width: 60px;
    height: 74px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    background: #d9dee8;
    color: #7688aa;
    font-size: 28px;
    font-weight: 700;
}

.file-preview-icon::after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    width: 20px;
    height: 20px;
    border-radius: 0 6px 0 4px;
    background: linear-gradient(135deg, #eef2f8 0 50%, #c8cfdb 50% 100%);
}

.file-preview-icon span {
    position: relative;
    z-index: 1;
}

.file-preview-name {
    max-width: 520px;
    margin-top: 28px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 18px;
    line-height: 28px;
    color: #111;
}

.file-preview-size {
    margin-top: 66px;
    font-size: 14px;
    line-height: 20px;
    color: #222;
}

.file-preview-action {
    width: 142px;
    height: 38px;
    margin-top: 40px;
    border: none;
    border-radius: 4px;
    background: #07c160;
    color: #fff;
    font-size: 16px;
    line-height: 38px;
    cursor: pointer;
}

.file-preview-action:hover {
    background: #06ad56;
}

.file-preview-action:disabled {
    background: #b8e8ca;
    cursor: not-allowed;
}

.file-preview-progress {
    width: 260px;
    margin-top: 16px;
}

.file-preview-cancel {
    margin-top: 12px;
    border: none;
    background: transparent;
    color: #666;
    cursor: pointer;
}

.file-preview-error {
    max-width: 420px;
    margin-top: 12px;
    color: #d93026;
    font-size: 13px;
    line-height: 18px;
}

.file-preview-path {
    max-width: 480px;
    margin-top: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #666;
    font-size: 12px;
}

.file-preview-actions {
    display: flex;
    gap: 10px;
    margin-top: 12px;

    button {
        height: 28px;
        padding: 0 12px;
        border: 1px solid #d9d9d9;
        border-radius: 4px;
        background: #fff;
        color: #333;
        cursor: pointer;
    }
}

.file-preview-expire {
    margin-top: 12px;
    font-size: 13px;
    line-height: 18px;
    color: #8a8a8a;
}
</style>
