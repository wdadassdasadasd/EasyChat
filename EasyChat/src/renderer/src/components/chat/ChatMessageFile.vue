<template>
    <!-- 文件消息卡片只展示元信息和接收状态，点击后由文件预览弹窗执行下载。 -->
    <div
        :class="['file-message-card', isSelf ? 'file-message-card-self' : '']"
        @click="$emit('open', message)"
    >
        <div class="file-message-main">
            <div class="file-message-info">
                <div class="file-message-name">{{ Utils.getFileMessageName(message) }}</div>
                <div class="file-message-meta">
                    {{ Utils.formatFileSize(message.fileSize, { emptyForZero: true }) }}
                    <span class="file-message-status">{{ Utils.getFileMessageStatusText(message) }}</span>
                </div>
            </div>
            <div class="file-message-icon">
                <span>?</span>
            </div>
        </div>
        <el-progress
            v-if="message.uploading"
            class="file-message-progress"
            :percentage="Number(message.uploadProgress || 0)"
            :show-text="false"
            :stroke-width="3"
        />
        <div class="file-message-source">
            <span class="file-message-source-icon"></span>
            <span>微信电脑版</span>
        </div>
    </div>
</template>

<script setup>
import Utils from '@/utils/Utils';

defineProps({
    isSelf: {
        type: Boolean,
        default: false
    },
    message: {
        type: Object,
        default: () => ({})
    }
});

defineEmits(['open']);
</script>

<style lang="scss" scoped>
.file-message-card {
    width: 264px;
    min-height: 114px;
    display: flex;
    flex-direction: column;
    border-radius: 4px;
    background: #fff;
    box-shadow: 0 1px 1px rgba(0, 0, 0, 0.03);
    cursor: pointer;
    box-sizing: border-box;
    overflow: hidden;
    text-align: left;
    transition: background 0.12s ease;

    &:hover {
        background: #fbfbfb;
    }
}

.file-message-card-self {
    background: #fff;
}

.file-message-main {
    min-height: 80px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 12px 10px;
}

.file-message-info {
    min-width: 0;
    flex: 1;
    margin-right: 12px;
}

.file-message-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #111;
    font-size: 14px;
    line-height: 22px;
}

.file-message-meta {
    margin-top: 4px;
    color: #999;
    font-size: 12px;
    line-height: 16px;

    span {
        margin-left: 6px;
    }
}

.file-message-icon {
    position: relative;
    width: 40px;
    height: 48px;
    flex: 0 0 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    background: #d9dee8;
    color: #7688aa;
    font-size: 22px;
    font-weight: 700;
}

.file-message-icon::after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    width: 14px;
    height: 14px;
    border-radius: 0 4px 0 3px;
    background: linear-gradient(135deg, #eef2f8 0 50%, #c8cfdb 50% 100%);
}

.file-message-icon span {
    position: relative;
    z-index: 1;
}

.file-message-source {
    height: 34px;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 12px;
    border-top: 1px solid #ededed;
    color: #9a9a9a;
    font-size: 12px;
}

.file-message-progress {
    margin: -2px 12px 8px;
}

.file-message-source-icon {
    position: relative;
    width: 14px;
    height: 12px;
    border-radius: 7px;
    background: #1aad19;
    flex: 0 0 14px;
}

.file-message-source-icon::after {
    content: '';
    position: absolute;
    right: -3px;
    bottom: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #8bd85f;
    border: 1px solid #fff;
}
</style>
