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
    let pendingMediaSeq = 0;

    // 发送框只维护待发送草稿，真正的网络请求由 useChatMessageSender 接管。
    const canSend = computed(() => {
        return Boolean((msgContent.value || '').trim()) || pendingImageList.value.length > 0 || pendingFileList.value.length > 0;
    });

    const pendingMediaList = computed(() => {
        const images = pendingImageList.value.map((item) => ({
            ...item,
            mediaType: 'image'
        }));
        const files = pendingFileList.value.map((item) => ({
            ...item,
            mediaType: item.fileType === 1 ? 'video' : 'file'
        }));

        return [...images, ...files].sort((a, b) => a.order - b.order);
    });

    const nextPendingMediaOrder = () => {
        pendingMediaSeq += 1;
        return pendingMediaSeq;
    };

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

    const isVideoFile = (file) => {
        if (file?.type?.startsWith('video/')) {
            return true;
        }
        return /\.(mp4|avi|rmvb|mkv|mov)$/i.test(file?.name || '');
    };

    const createImageCover = (file) => {
        // 图片消息先生成轻量封面，发送时和原文件一起上传给后端。
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

    const createVideoCover = (file) => {
        // 视频封面取首段画面；失败时退化为通用文件封面，避免阻塞发送。
        return new Promise((resolve) => {
            const video = document.createElement('video');
            const objectUrl = URL.createObjectURL(file);

            const cleanup = () => {
                video.pause();
                video.removeAttribute('src');
                video.load();
                URL.revokeObjectURL(objectUrl);
            };

            const fallback = async () => {
                cleanup();
                resolve(await createFileCover());
            };

            video.preload = 'metadata';
            video.muted = true;
            video.playsInline = true;
            video.onloadedmetadata = () => {
                const seekTime = Math.min(1, Math.max(0, (video.duration || 0) / 4));
                video.currentTime = seekTime;
            };
            video.onseeked = () => {
                const maxSize = 360;
                const width = video.videoWidth || 16;
                const height = video.videoHeight || 9;
                const ratio = Math.min(maxSize / width, maxSize / height, 1);
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(width * ratio);
                canvas.height = Math.round(height * ratio);
                const context = canvas.getContext('2d');
                context.drawImage(video, 0, 0, canvas.width, canvas.height);
                canvas.toBlob((blob) => {
                    cleanup();
                    resolve(blob || file);
                }, 'image/jpeg', 0.82);
            };
            video.onerror = fallback;
            video.src = objectUrl;
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

        const order = nextPendingMediaOrder();
        const previewUrl = URL.createObjectURL(file);
        const cover = await createImageCover(file);

        pendingImageList.value.push({
            id: `${Date.now()}_${Math.random()}`,
            order,
            file,
            cover,
            previewUrl,
            name: file.name,
            size: file.size
        });
    };

    const addPendingFile = async (file, fileType = 2) => {
        if (!file) {
            return;
        }

        if (isOverFileLimit()) {
            warnFileLimit();
            return;
        }

        const order = nextPendingMediaOrder();
        pendingFileList.value.push({
            id: `${Date.now()}_${Math.random()}`,
            order,
            file,
            cover: fileType === 1 ? await createVideoCover(file) : await createFileCover(),
            fileType,
            name: file.name,
            size: file.size
        });
    };

    const addPendingMedia = async (file) => {
        // 拖拽/选择文件共用这里，根据 MIME 和后缀拆成图片、视频、普通文件三类。
        if (isImageFile(file)) {
            await addPendingImage(file);
            return;
        }
        if (isVideoFile(file)) {
            await addPendingFile(file, 1);
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

        // 先把所有待发送媒体派发给父组件，再清空本地预览，避免同一文件重复发送。
        pendingMediaList.value.forEach((media) => {
            const eventName = media.mediaType === 'image'
                ? 'sendImageMessage'
                : media.fileType === 1
                    ? 'sendVideoMessage'
                    : 'sendFileMessage';

            emit(eventName, {
                contactId: currentChatSession.value.contactId,
                contactType: currentChatSession.value.contactType,
                file: media.file,
                cover: media.cover
            });
        });

        clearPendingImages();

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
    };
};

export const useChatMessageSender = ({
    appendMessageIfMissing,
    currentChatSession,
    isNearMessageBottom,
    loadChatSession,
    messageList,
    proxy,
    scrollMessageToBottom
}) => {
    // 发送任务串行化，避免连续回车或批量媒体上传时服务端消息顺序和本地列表顺序错乱。
    let sendTaskQueue = Promise.resolve();

    const maxUploadConcurrency = 3;
    const uploadTaskQueue = [];
    let activeUploadCount = 0;

    const runNextUploadTask = () => {
        if (activeUploadCount >= maxUploadConcurrency || uploadTaskQueue.length === 0) {
            return;
        }

        const task = uploadTaskQueue.shift();
        activeUploadCount += 1;
        task()
            .catch((error) => {
                console.error('upload message file failed', error);
            })
            .finally(() => {
                activeUploadCount -= 1;
                runNextUploadTask();
            });
    };

    const enqueueUploadTask = (task) => {
        uploadTaskQueue.push(task);
        runNextUploadTask();
    };

    const saveSendMessageToLocal = async (payload) => {
        const ipcRenderer = window.ipcRenderer || window.electron?.ipcRenderer;
        if (ipcRenderer?.invoke) {
            return await ipcRenderer.invoke('saveSendMessage', payload);
        }

        return await new Promise((resolve) => {
            ipcRenderer.once('saveSendMessageCallback', (e, result) => {
                resolve(result);
            });
            ipcRenderer.send('saveSendMessage', payload);
        });
    };

    const enqueueSendTask = (task) => {
        sendTaskQueue = sendTaskQueue
            .catch(() => {})
            .then(task)
            .catch((error) => {
                console.error('send message failed', error);
            });

        return sendTaskQueue;
    };

    const appendSentMessageIfMissing = (message) => {
        const shouldStickToBottom = isNearMessageBottom();
        const appended = typeof appendMessageIfMissing === 'function'
            ? appendMessageIfMissing(message)
            : (() => {
                messageList.value.push(message);
                return true;
            })();

        if (appended) {
            scrollMessageToBottom({ force: shouldStickToBottom });
        }
        return appended;
    };

    const sendChatMessage = async ({ contactId, contactType, messageContent }) => {
        if (!messageContent) {
            return;
        }

        // 文本消息先走 HTTP 拿到服务端 messageId，再通知主进程保存到本地 SQLite。
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
            appendSentMessageIfMissing(message);

            const saveResult = await saveSendMessageToLocal({
                message,
                chatSession: { ...toRaw(currentChatSession.value) }
            });
            if (!saveResult?.success) {
                proxy.Message.error('消息保存失败');
                return;
            }
        }

        loadChatSession();
    };

    const uploadMessageFile = async (message, file, cover) => {
        // 媒体消息先创建消息记录，再异步上传文件；上传失败只改变该消息状态。
        const uploadResult = await proxy.Request({
            url: proxy.Api.uploadFile,
            params: {
                messageId: message.messageId,
                file,
                cover
            },
            showLoading: false,
            timeout: 0
        });

        if (!uploadResult) {
            message.uploading = false;
            message.status = 0;
            await saveSendMessageToLocal({
                message: {
                    ...message,
                    localPreviewUrl: undefined,
                    uploading: undefined
                },
                chatSession: { ...toRaw(currentChatSession.value) }
            });
            loadChatSession();
            return;
        }

        message.uploading = false;
        message.status = 1;

        await saveSendMessageToLocal({
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

        // 图片/视频/文件统一走 messageType=5，fileType 决定展示组件和预览能力。
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

        const filePath = file.path || window.api?.getPathForFile?.(file) || '';
        if (filePath) {
            message.filePath = filePath;
        }

        if (fileType === 0) {
            message.localPreviewUrl = URL.createObjectURL(file);
        } else if (fileType === 1) {
            message.localPreviewUrl = URL.createObjectURL(file);
        }
        message.uploading = true;
        appendSentMessageIfMissing(message);

        enqueueUploadTask(() => uploadMessageFile(message, file, cover));
    };

    const sendImageMessage = (payload) => {
        return sendMediaMessage(payload, 0);
    };

    const sendFileMessage = (payload) => {
        return sendMediaMessage(payload, 2);
    };

    const sendVideoMessage = (payload) => {
        return sendMediaMessage(payload, 1);
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

    const onSendVideoMessage = (payload) => {
        enqueueSendTask(() => sendVideoMessage(payload));
    };

    const handleFileUploadDone = (message) => {
        // WebSocket 文件回执可能晚于本地上传请求结束，用 forceGet 触发封面重新拉取。
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
        onSendImageMessage,
        onSendVideoMessage
    };
};
