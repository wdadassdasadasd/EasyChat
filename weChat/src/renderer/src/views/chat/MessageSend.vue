<template>
    <div class="send-panel">
        <!-- 工具栏：表情、文件上传等发送辅助功能。 -->
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
                        <img src="../../assets/icons/laugh.svg" alt="表情" />
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

        <!-- 输入区：msgContent 保存当前输入框内容。 -->
        <div class="input-area" @drop="dropHandler" @dragover="dragoverHandler">
            <el-input
                v-model="msgContent"
                rows="5"
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

        <!-- 发送按钮：点击后校验输入内容，并把消息抛给父组件 Chat.vue。 -->
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
                    <span class="send-btn" @click="sendMessage" :class="{ 'send-btn-active': msgContent.trim() }">发送(S)</span>
                </template>
            </el-popover>
        </div>
    </div>
</template>

<script setup>
import { ref } from 'vue';
import emojiList from '../../utils/Emoji';
import { defineProps, defineEmits } from 'vue';

// 父组件 Chat.vue 传入当前会话信息，发送时需要 contactId/contactType。
const props=defineProps({
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
    // 关闭所有浮层，避免表情面板和空消息提示同时残留。
    showEmojiPopover.value = false;
    showSendMessagePopover.value = false;
};

const showEmojiPopoverHandler = () => {
    showEmojiPopover.value = !showEmojiPopover.value;
};

const sendEmoji = (item) => {
    // 选择表情时，把表情追加到当前输入内容末尾。
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

// 子组件不直接调发送接口，只把发送事件抛给父组件 Chat.vue。
const emit = defineEmits(['sendMessage']);

const sendMessage = () => {
    // 发送前先去掉首尾空格，避免发送纯空白消息。
    const messageContent = (msgContent.value || '').trim();

    if (!messageContent) {
        showSendMessagePopover.value = true;
        return;
    }

    showSendMessagePopover.value = false;

    // 把要发送的数据交给父组件，由 Chat.vue 负责调 /chat/sendMessage 接口。
    emit('sendMessage', {
        contactId: props.currentChatSession.contactId,
        contactType: props.currentChatSession.contactType,
        messageContent
    });

    // 清空输入框。后续如果要做“失败后恢复输入”，这里可以改成接口成功后再清空。
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
