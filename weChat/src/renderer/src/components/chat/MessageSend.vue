<template>
    <div class="send-panel">
        <!-- 工具栏只收集待发送素材；真正的发送请求由父级 Chat.vue 接住 emit 后处理。 -->
        <div class="toolbar">
            <el-popover
                :visible="showEmojiPopover"
                trigger="click"
                placement="top"
                :teleported="false"
                popper-class="emoji-popover"
                :popper-style="{ padding: '10px 12px 12px', width: '490px' }"
                @show="openPopover"
                @hide="closePopover"
            >
                <template #default>
                    <el-tabs v-model="activeEmoji" class="emoji-tabs" stretch>
                        <el-tab-pane
                            v-for="emoji in emojiList"
                            :key="emoji.name"
                            :label="emoji.name"
                            :name="emoji.name"
                        >
                            <div class="emoji-list">
                                <div
                                    v-for="item in emoji.emojiList"
                                    :key="item"
                                    class="emoji-item"
                                    @click="sendEmoji(item)"
                                >
                                    {{ item }}
                                </div>
                            </div>
                        </el-tab-pane>
                    </el-tabs>
                </template>
                <template #reference>
                    <button
                        class="toolbar-icon emoji-trigger"
                        type="button"
                        title="表情"
                        @click.stop="showEmojiPopoverHandler"
                    >
                        <img src="@/assets/icons/laugh.svg" alt="表情" />
                    </button>
                </template>
            </el-popover>

            <el-upload
                ref="uploadRef"
                name="file"
                :show-file-list="false"
                :multiple="true"
                :limit="fileLimit"
                :http-request="uploadFile"
                :on-exceed="uploadExceed"
            >
                <el-icon class="toolbar-icon">
                    <FolderOpened />
                </el-icon>
            </el-upload>
        </div>

        <div class="input-area" @drop="dropHandler" @dragover="dragoverHandler">
            <!-- 待发送图片/文件先在本地预览，点击发送时再批量转成消息事件。 -->
            <div v-if="pendingMediaList.length" class="pending-media-list">
                <div
                    v-for="media in pendingMediaList"
                    :key="media.id"
                    :class="[
                        'pending-media-item',
                        media.mediaType === 'image' ? 'pending-media-item-image' : 'pending-media-item-file'
                    ]"
                >
                    <template v-if="media.mediaType === 'image'">
                        <img :src="media.previewUrl" :alt="media.name" />
                    </template>
                    <template v-else>
                        <div :class="['pending-file-icon', media.mediaType === 'video' ? 'pending-file-icon-video' : '']">
                            {{ media.mediaType === 'video' ? 'VIDEO' : 'FILE' }}
                        </div>
                        <div class="pending-file-info">
                            <div class="pending-file-name" :title="media.name">{{ media.name }}</div>
                            <div class="pending-file-size">{{ formatFileSize(media.size) }}</div>
                        </div>
                    </template>
                    <button
                        class="pending-media-remove"
                        type="button"
                        @click="media.mediaType === 'image' ? removePendingImage(media.id) : removePendingFile(media.id)"
                    >
                        x
                    </button>
                </div>
            </div>

            <el-input
                v-model="msgContent"
                rows="5"
                type="textarea"
                resize="none"
                maxlength="500"
                show-word-limit
                spellcheck="false"
                input-style="background:#f5f5f5;border:none"
                @paste="pasteHandler"
                @keydown.enter.exact.prevent="sendMessage"
            />
        </div>

        <div class="send-btn-panel">
            <el-popover
                :visible="showSendMessagePopover"
                trigger="click"
                :hide-after="1500"
                placement="top-end"
                :teleported="false"
                :popper-style="{ padding: '5px', 'min-width': '0px', width: '120px' }"
                @show="openPopover"
                @hide="closePopover"
            >
                <template #default>
                    <span class="empty-msg">不能发送空消息</span>
                </template>
                <template #reference>
                    <span
                        class="send-btn"
                        :class="{ 'send-btn-active': canSend }"
                        @click="sendMessage"
                    >发送(S)</span>
                </template>
            </el-popover>
        </div>
    </div>
</template>

<script setup>
import { ref, toRef } from 'vue';
import emojiList from '@/utils/Emoji';
import { useMessageComposer } from '@/views/chat/composables/useMessageSender';

const props = defineProps({
    currentChatSession: {
        type: Object,
        default: () => ({})
    }
});

const emit = defineEmits(['sendMessage', 'sendImageMessage', 'sendFileMessage', 'sendVideoMessage']);

const activeEmoji = ref(emojiList[0]?.name || '');
// useMessageComposer 聚合输入框、表情、粘贴、拖拽、文件选择等“编辑中”状态。
const {
    canSend,
    closePopover,
    dragoverHandler,
    dropHandler,
    fileLimit,
    formatFileSize,
    msgContent,
    openPopover,
    pasteHandler,
    pendingMediaList,
    removePendingFile,
    removePendingImage,
    sendEmoji,
    sendMessage,
    showEmojiPopover,
    showEmojiPopoverHandler,
    showSendMessagePopover,
    uploadExceed,
    uploadFile,
    uploadRef
} = useMessageComposer({
    currentChatSession: toRef(props, 'currentChatSession'),
    emit
});
</script>

<style lang="scss" scoped>
.emoji-tabs {
    :deep(.el-tabs__header) {
        margin: 0 0 10px;
    }

    :deep(.el-tabs__nav-wrap::after) {
        background: #ececec;
    }

    :deep(.el-tabs__item) {
        height: 36px;
        padding: 0 10px;
        font-size: 13px;
        color: #666;
    }

    :deep(.el-tabs__item.is-active) {
        color: #07c160;
        font-weight: 500;
    }

    :deep(.el-tabs__active-bar) {
        background: #07c160;
    }

    :deep(.el-tab-pane) {
        height: 280px;
        overflow-y: auto;
    }
}

.emoji-list {
    display: grid;
    grid-template-columns: repeat(10, minmax(0, 1fr));
    gap: 6px 4px;
}

.emoji-item {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 38px;
    border-radius: 6px;
    font-size: 24px;
    line-height: 1;
    cursor: pointer;
    user-select: none;
    transition: background 0.15s ease;

    &:hover {
        background: #f2f2f2;
    }
}

:deep(.emoji-popover) {
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}

.emoji-trigger {
    width: 20px;
    height: 20px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    cursor: pointer;

    img {
        width: 20px;
        height: 20px;
        display: block;
    }

    &:hover {
        opacity: 0.82;
    }

    &:focus-visible {
        outline: 1px solid #07c160;
        outline-offset: 2px;
    }
}

.pending-media-list {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    width: 100%;
    min-height: 74px;
    max-height: 74px;
    padding: 2px 0 8px;
    overflow-x: auto;
    overflow-y: hidden;
    box-sizing: border-box;
}

.pending-media-item {
    position: relative;
    flex: 0 0 auto;
    border: 1px solid #e5e5e5;
    border-radius: 4px;
    background: #f7f7f7;
    box-sizing: border-box;
}

.pending-media-item-image {
    width: 64px;
    height: 64px;
    overflow: hidden;

    img {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: cover;
    }
}

.pending-media-item-file {
    display: flex;
    align-items: center;
    width: 276px;
    height: 64px;
    padding: 7px 32px 7px 8px;
}

.pending-file-icon {
    width: 34px;
    height: 34px;
    flex: 0 0 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    background: #fff;
    color: #666;
    font-size: 10px;
    border: 1px solid #dedede;
}

.pending-file-icon-video {
    background: #eef5ff;
    color: #4378c7;
}

.pending-file-info {
    min-width: 0;
    margin-left: 8px;
}

.pending-file-name {
    max-width: 198px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #222;
    font-size: 13px;
    line-height: 18px;
}

.pending-file-size {
    margin-top: 2px;
    color: #999;
    font-size: 12px;
    line-height: 16px;
}

.pending-media-remove {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 17px;
    height: 17px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.48);
    color: #fff;
    font-size: 12px;
    line-height: 17px;
    cursor: pointer;
}

.send-btn {
    color: #333;
    background: #e9e9e9;
    cursor: pointer;
}

.send-btn.send-btn-active {
    color: #fff;
    border-color: #07c160;
    background: #07c160;
}
</style>
