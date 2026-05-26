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
                accept="image/*"
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
            <div v-if="pendingImageList.length" class="pending-image-list">
                <div
                    v-for="image in pendingImageList"
                    :key="image.id"
                    class="pending-image-item"
                >
                    <img :src="image.previewUrl" :alt="image.name" />
                    <button
                        class="pending-image-remove"
                        type="button"
                        @click="removePendingImage(image.id)"
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
import { computed, onBeforeUnmount, ref } from 'vue';
import { ElMessage } from 'element-plus';
import emojiList from '../../utils/Emoji';

const props = defineProps({
    currentChatSession: {
        type: Object,
        default: () => ({})
    }
});

const emit = defineEmits(['sendMessage', 'sendImageMessage']);

const activeEmoji = ref(emojiList[0]?.name || '');
const msgContent = ref('');
const showEmojiPopover = ref(false);
const showSendMessagePopover = ref(false);
const uploadRef = ref();
const fileLimit = 9;
const pendingImageList = ref([]);

const canSend = computed(() => {
    return Boolean((msgContent.value || '').trim()) || pendingImageList.value.length > 0;
});

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

const isImageFile = (file) => {
    return file?.type?.startsWith('image/');
};

const createImageCover = (file) => {
    return new Promise((resolve) => {
        const image = new Image();
        const objectUrl = URL.createObjectURL(file);

        image.onload = () => {
            const maxSize = 240;
            const ratio = Math.min(maxSize / image.width, maxSize / image.height, 1);
            const canvas = document.createElement('canvas');

            canvas.width = Math.round(image.width * ratio);
            canvas.height = Math.round(image.height * ratio);

            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0, canvas.width, canvas.height);

            canvas.toBlob((blob) => {
                URL.revokeObjectURL(objectUrl);
                resolve(blob || file);
            }, 'image/jpeg', 0.8);
        };

        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(file);
        };

        image.src = objectUrl;
    });
};

const addPendingImage = async (file) => {
    if (!isImageFile(file)) {
        ElMessage.warning('请选择图片文件');
        return;
    }

    if (pendingImageList.value.length >= fileLimit) {
        ElMessage.warning(`一次最多选择 ${fileLimit} 张图片`);
        return;
    }

    const previewUrl = URL.createObjectURL(file);
    const cover = await createImageCover(file);

    pendingImageList.value.push({
        id: `${Date.now()}_${Math.random()}`,
        file,
        cover,
        previewUrl,
        name: file.name,
        size: file.size
    });
};

const removePendingImage = (id) => {
    const image = pendingImageList.value.find((item) => item.id === id);
    if (image?.previewUrl) {
        URL.revokeObjectURL(image.previewUrl);
    }

    pendingImageList.value = pendingImageList.value.filter((item) => item.id !== id);
};

const clearPendingImages = () => {
    pendingImageList.value.forEach((image) => {
        if (image.previewUrl) {
            URL.revokeObjectURL(image.previewUrl);
        }
    });
    pendingImageList.value = [];
};

const uploadFile = async (uploadRequest) => {
    await addPendingImage(uploadRequest.file);
    uploadRequest.onSuccess?.();
    uploadRef.value?.clearFiles();
};

const uploadExceed = () => {
    ElMessage.warning(`一次最多选择 ${fileLimit} 张图片`);
};

const dropHandler = async (event) => {
    event.preventDefault();

    const files = Array.from(event.dataTransfer?.files || []);
    for (const file of files) {
        await addPendingImage(file);
    }
};

const dragoverHandler = (event) => {
    event.preventDefault();
};

const pasteHandler = async (event) => {
    const items = Array.from(event.clipboardData?.items || []);
    const imageItems = items.filter((item) => item.type.startsWith('image/'));

    if (!imageItems.length) {
        return;
    }

    event.preventDefault();
    for (const item of imageItems) {
        const file = item.getAsFile();
        if (file) {
            await addPendingImage(file);
        }
    }
};

const sendMessage = () => {
    const messageContent = (msgContent.value || '').trim();

    if (!messageContent && pendingImageList.value.length === 0) {
        showSendMessagePopover.value = true;
        return;
    }

    showSendMessagePopover.value = false;

    pendingImageList.value.forEach((image) => {
        emit('sendImageMessage', {
            contactId: props.currentChatSession.contactId,
            contactType: props.currentChatSession.contactType,
            file: image.file,
            cover: image.cover
        });
    });

    clearPendingImages();

    if (messageContent) {
        emit('sendMessage', {
            contactId: props.currentChatSession.contactId,
            contactType: props.currentChatSession.contactType,
            messageContent
        });

        msgContent.value = '';
    }
};

onBeforeUnmount(() => {
    pendingImageList.value.forEach((image) => {
        if (image.previewUrl) {
            URL.revokeObjectURL(image.previewUrl);
        }
    });
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

.pending-image-list {
    display: flex;
    flex-wrap: nowrap;
    gap: 8px;
    flex-shrink: 0;
    max-width: 100%;
    max-height: 76px;
    padding: 2px 0 8px;
    overflow-x: auto;
    overflow-y: hidden;
}

.pending-image-item {
    position: relative;
    width: 64px;
    height: 64px;
    flex: 0 0 64px;
    border: 1px solid #e5e5e5;
    border-radius: 4px;
    overflow: hidden;
    background: #f7f7f7;

    img {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: cover;
    }
}

.pending-image-remove {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 17px;
    height: 17px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.56);
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
