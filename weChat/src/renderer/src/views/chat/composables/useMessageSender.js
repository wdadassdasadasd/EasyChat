import { computed, onBeforeUnmount, ref, toRaw } from 'vue';
import { ElMessage } from 'element-plus';
import Utils from '@/utils/Utils';

export const useMessageComposer = ({ currentChatSession, emit }) => {
    const msgContent = ref('');
    const showEmojiPopover = ref(false);
    const showSendMessagePopover = ref(false);
    const uploadRef = ref();
    const fileLimit = 9;
    const pendingImageList = ref([]);
    const pendingFileList = ref([]);

    const canSend = computed(() => {
        return Boolean((msgContent.value || '').trim()) || pendingImageList.value.length > 0 || pendingFileList.value.length > 0;
    });

    const openPopover = () => {};

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

    const createFileCover = () => {
        return new Promise((resolve) => {
            const canvas = document.createElement('canvas');
            canvas.width = 1;
            canvas.height = 1;
            const context = canvas.getContext('2d');
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, 1, 1);
            canvas.toBlob((blob) => {
                resolve(blob || new Blob(['cover'], { type: 'text/plain' }));
            }, 'image/png');
        });
    };

    const isOverFileLimit = () => {
        return pendingImageList.value.length + pendingFileList.value.length >= fileLimit;
    };

    const warnFileLimit = () => {
        ElMessage.warning(`一次最多选择 ${fileLimit} 个文件`);
    };

    const addPendingImage = async (file) => {
        if (!isImageFile(file)) {
            ElMessage.warning('请选择图片文件');
            return;
        }

        if (isOverFileLimit()) {
            warnFileLimit();
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

    const addPendingFile = async (file) => {
        if (!file) {
            return;
        }

        if (isOverFileLimit()) {
            warnFileLimit();
            return;
        }

        pendingFileList.value.push({
            id: `${Date.now()}_${Math.random()}`,
            file,
            cover: await createFileCover(),
            name: file.name,
            size: file.size
        });
    };

    const addPendingMedia = async (file) => {
        if (isImageFile(file)) {
            await addPendingImage(file);
            return;
        }

        await addPendingFile(file);
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

    const removePendingFile = (id) => {
        pendingFileList.value = pendingFileList.value.filter((item) => item.id !== id);
    };

    const clearPendingFiles = () => {
        pendingFileList.value = [];
    };

    const uploadFile = async (uploadRequest) => {
        await addPendingMedia(uploadRequest.file);
        uploadRequest.onSuccess?.();
        uploadRef.value?.clearFiles();
    };

    const uploadExceed = () => {
        warnFileLimit();
    };

    const dropHandler = async (event) => {
        event.preventDefault();

        const files = Array.from(event.dataTransfer?.files || []);
        for (const file of files) {
            await addPendingMedia(file);
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

        if (!messageContent && pendingImageList.value.length === 0 && pendingFileList.value.length === 0) {
            showSendMessagePopover.value = true;
            return;
        }

        showSendMessagePopover.value = false;

        pendingImageList.value.forEach((image) => {
            emit('sendImageMessage', {
                contactId: currentChatSession.value.contactId,
                contactType: currentChatSession.value.contactType,
                file: image.file,
                cover: image.cover
            });
        });

        clearPendingImages();

        pendingFileList.value.forEach((fileItem) => {
            emit('sendFileMessage', {
                contactId: currentChatSession.value.contactId,
                contactType: currentChatSession.value.contactType,
                file: fileItem.file,
                cover: fileItem.cover
            });
        });

        clearPendingFiles();

        if (messageContent) {
            emit('sendMessage', {
                contactId: currentChatSession.value.contactId,
                contactType: currentChatSession.value.contactType,
                messageContent
            });

            msgContent.value = '';
        }
    };

    onBeforeUnmount(() => {
        clearPendingImages();
    });

    return {
        canSend,
        closePopover,
        dragoverHandler,
        dropHandler,
        fileLimit,
        formatFileSize: Utils.formatFileSize,
        msgContent,
        openPopover,
        pasteHandler,
        pendingFileList,
        pendingImageList,
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
    };
};

export const useChatMessageSender = ({
    currentChatSession,
    isNearMessageBottom,
    loadChatSession,
    messageList,
    proxy,
    scrollMessageToBottom
}) => {
    let sendTaskQueue = Promise.resolve();

    const enqueueSendTask = (task) => {
        sendTaskQueue = sendTaskQueue
            .catch(() => {})
            .then(task)
            .catch((error) => {
                console.error('send message failed', error);
            });

        return sendTaskQueue;
    };

    const appendMessageIfMissing = (message) => {
        const exists = message.messageId
            ? messageList.value.some((item) => {
                return item.messageId == message.messageId;
            })
            : false;

        if (!exists) {
            const shouldStickToBottom = isNearMessageBottom();
            messageList.value.push(message);
            scrollMessageToBottom({ force: shouldStickToBottom });
        }
    };

    const sendChatMessage = async ({ contactId, contactType, messageContent }) => {
        if (!messageContent) {
            return;
        }

        const result = await proxy.Request({
            url: proxy.Api.sendMessage,
            params: {
                contactId,
                contactType,
                messageType: 2,
                messageContent
            },
            showLoading: false
        });

        if (!result) {
            return;
        }

        const message = result.data;
        if (message?.messageContent) {
            appendMessageIfMissing(message);

            window.ipcRenderer.send('saveSendMessage', {
                message,
                chatSession: { ...toRaw(currentChatSession.value) }
            });
        }

        loadChatSession();
    };

    const uploadMessageFile = async (message, file, cover) => {
        const uploadResult = await proxy.Request({
            url: proxy.Api.uploadFile,
            params: {
                messageId: message.messageId,
                file,
                cover
            },
            showLoading: false
        });

        if (!uploadResult) {
            message.uploading = false;
            message.status = 0;
            return;
        }

        message.uploading = false;
        message.status = 1;

        window.ipcRenderer.send('saveSendMessage', {
            message: {
                ...message,
                localPreviewUrl: undefined,
                uploading: undefined
            },
            chatSession: { ...toRaw(currentChatSession.value) }
        });

        loadChatSession();
    };

    const sendMediaMessage = async ({ contactId, contactType, file, cover }, fileType) => {
        if (!file) {
            return;
        }

        const result = await proxy.Request({
            url: proxy.Api.sendMessage,
            params: {
                contactId,
                contactType,
                messageType: 5,
                messageContent: file.name,
                fileSize: file.size,
                fileName: file.name,
                fileType
            },
            showLoading: false
        });

        if (!result) {
            return;
        }

        const message = result.data;
        if (!message?.messageId) {
            return;
        }

        if (fileType === 0) {
            message.localPreviewUrl = URL.createObjectURL(file);
        }
        message.uploading = true;
        const shouldStickToBottom = isNearMessageBottom();
        messageList.value.push(message);
        scrollMessageToBottom({ force: shouldStickToBottom });

        uploadMessageFile(message, file, cover);
    };

    const sendImageMessage = (payload) => {
        return sendMediaMessage(payload, 0);
    };

    const sendFileMessage = (payload) => {
        return sendMediaMessage(payload, 2);
    };

    const onSendChatMessage = (payload) => {
        enqueueSendTask(() => sendChatMessage(payload));
    };

    const onSendImageMessage = (payload) => {
        enqueueSendTask(() => sendImageMessage(payload));
    };

    const onSendFileMessage = (payload) => {
        enqueueSendTask(() => sendFileMessage(payload));
    };

    const handleFileUploadDone = (message) => {
        const targetMessage = messageList.value.find((item) => {
            return item.messageId == message.messageId;
        });

        if (targetMessage) {
            targetMessage.status = message.status ?? 1;
            targetMessage.forceGet = Date.now();
        }

        loadChatSession();
    };

    return {
        handleFileUploadDone,
        onSendChatMessage,
        onSendFileMessage,
        onSendImageMessage
    };
};
