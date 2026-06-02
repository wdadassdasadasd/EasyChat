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
                {{ receiving ? '接收中' : '接收文件' }}
            </button>
            <div class="file-preview-expire">将在13天后无法下载</div>
        </div>
    </el-dialog>
</template>

<script setup>
import Utils from '@/utils/Utils';

defineProps({
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
    }
});

defineEmits(['closed', 'receive', 'update:modelValue']);
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

.file-preview-expire {
    margin-top: 12px;
    font-size: 13px;
    line-height: 18px;
    color: #8a8a8a;
}
</style>
