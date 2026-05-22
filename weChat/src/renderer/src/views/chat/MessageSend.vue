<template>
    <div class="send-panel">
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
                    <div class="iconfont icon-emoji" @click.stop="showEmojiPopoverHandler"></div>
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
                <div class="iconfont icon-folder"></div>
            </el-upload>
        </div>

        <div class="input-area" @drop="dropHandler" @dragover="dragoverHandler">
            <el-input
                v-model="msgContent"
                row="5"
                type="textarea"
                resize="none"
                maxlength="500"
                show-word-limit
                spellcheck="false"
                input-style="background:#f5f5f5:border:none"
                @paste="pasteHandler"
                @keydown.enter="sendMessage"
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
                    <span class="send-btn" @click="sendMessage">发送(S)</span>
                </template>
            </el-popover>
        </div>
    </div>
</template>

<script setup>
import { ref } from 'vue';
import emojiList from '../../utils/Emoji';

defineProps({
    currentChatSession: {
        type: Object,
        default: () => ({})
    }
});

const activeEmoji = ref(emojiList[0]?.name || '');
const msgContent = ref('');
const showEmojiPopover = ref(false);
const showSendMessagePopover = ref(false);
const uploadRef = ref();
const fileLimit = 9;

const openPopover = () => {
};

const closePopover = () => {
    showEmojiPopover.value = false;
    showSendMessagePopover.value = false;
};

const showEmojiPopoverHandler = () => {
    showEmojiPopover.value = !showEmojiPopover.value;
};

const sendEmoji = (item) => {
    msgContent.value = `${msgContent.value || ''}${item}`;
};

const uploadFile = () => {
};

const uploadExceed = () => {
};

const dropHandler = (event) => {
    event.preventDefault();
};

const dragoverHandler = (event) => {
    event.preventDefault();
};

const pasteHandler = () => {
};

const sendMessage = () => {
    if (!(msgContent.value || '').trim()) {
        showSendMessagePopover.value = true;
        return;
    }
    showSendMessagePopover.value = false;
    msgContent.value = '';
};
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
</style>
