import { nextTick, ref } from 'vue';
import { useChatMessageSender } from './useMessageSender';
import { useMessageScroll } from './useMessageScroll';

export const useChatMessages = ({ applySessionPatches, currentChatSession, loadChatSession, markSessionRead, proxy }) => {
    const messageCountInfo = {
        totalPage: 0,
        pageNo: 0,
        maxMessageId: 0,
        noData: false
    };
    const messageList = ref([]);
    const messageLoadingMore = ref(false);
    let messageIdSet = new Set();
    let shouldScrollToBottomAfterLoad = false;
    let pendingPrependScrollState = null;

    const {
        cleanupMessageScroll,
        clearInitialBottomLock,
        getActiveMessageLoadSeq,
        getMessagePanelRenderSeq,
        isNearMessageBottom,
        markMessagePanelReady,
        messagePanelPhase,
        scrollMessageToBottom,
        settleScrollToBottom,
        showMessagePanelAtBottom,
        startMessagePanelRender
    } = useMessageScroll();

    const {
        handleFileUploadDone,
        onSendChatMessage,
        onSendFileMessage,
        onSendImageMessage,
        onSendVideoMessage
    } = useChatMessageSender({
        currentChatSession,
        isNearMessageBottom,
        loadChatSession,
        messageList,
        proxy,
        scrollMessageToBottom
    });

    const resetMessageCountInfo = () => {
        messageCountInfo.totalPage = 1;
        messageCountInfo.pageNo = 0;
        messageCountInfo.maxMessageId = 0;
        messageCountInfo.noData = false;
    };

    const clearCurrentMessages = () => {
        startMessagePanelRender();
        messageList.value = [];
        messageIdSet = new Set();
        messageLoadingMore.value = false;
        pendingPrependScrollState = null;
        resetMessageCountInfo();
        messageCountInfo.noData = true;
        markMessagePanelReady();
    };

    const rebuildMessageIdSet = () => {
        messageIdSet = new Set(messageList.value.map((item) => item.messageId).filter((messageId) => messageId != null));
    };

    const appendMessagesIfMissing = async (messages = []) => {
        const incomingMessages = Array.isArray(messages) ? messages : [];
        const nextMessages = [];
        incomingMessages.forEach((message) => {
            if (!message) {
                return;
            }
            if (message.messageId != null && messageIdSet.has(message.messageId)) {
                return;
            }
            if (message.messageId != null) {
                messageIdSet.add(message.messageId);
            }
            nextMessages.push(message);
        });

        if (nextMessages.length === 0) {
            return false;
        }

        const shouldStickToBottom = isNearMessageBottom();
        messageList.value = messageList.value.concat(nextMessages);
        await scrollMessageToBottom({ force: shouldStickToBottom });
        return true;
    };

    const handleIncomingMessages = async (messages = []) => {
        const currentMessages = [];
        const readContactIds = new Set();

        messages.forEach((message) => {
            const receiveContactId = message.contactType == 1 ? message.contactId : message.sendUserId;
            const isCurrentSession = message.sessionId == currentChatSession.value.sessionId ||
                receiveContactId == currentChatSession.value.contactId;
            if (isCurrentSession) {
                currentMessages.push(message);
                readContactIds.add(receiveContactId);
            }
        });

        readContactIds.forEach((contactId) => {
            markSessionRead?.(contactId);
        });
        await appendMessagesIfMissing(currentMessages);
    };

    const getMessagePanel = () => {
        return document.getElementById('message-panel');
    };

    const capturePrependScrollState = () => {
        const messagePanel = getMessagePanel();
        if (!messagePanel) {
            return null;
        }
        return {
            scrollHeight: messagePanel.scrollHeight,
            scrollTop: messagePanel.scrollTop
        };
    };

    const restorePrependScrollPosition = async () => {
        const scrollState = pendingPrependScrollState;
        pendingPrependScrollState = null;
        if (!scrollState) {
            return;
        }

        await nextTick();
        await new Promise((resolve) => {
            window.requestAnimationFrame(() => {
                const messagePanel = getMessagePanel();
                if (messagePanel) {
                    const heightDiff = messagePanel.scrollHeight - scrollState.scrollHeight;
                    messagePanel.scrollTop = scrollState.scrollTop + heightDiff;
                }
                resolve();
            });
        });
    };

    const loadChatMessage = ({ keepScrollPosition = false } = {}) => {
        if (!currentChatSession.value.sessionId) {
            messageCountInfo.noData = true;
            markMessagePanelReady();
            return false;
        }
        if (messageCountInfo.noData || (keepScrollPosition && messageLoadingMore.value)) {
            return false;
        }
        if (keepScrollPosition) {
            pendingPrependScrollState = capturePrependScrollState();
            messageLoadingMore.value = true;
        }
        messageCountInfo.pageNo++;
        window.ipcRenderer.send('loadChatMessage', {
            sessionId: currentChatSession.value.sessionId,
            pageNo: messageCountInfo.pageNo,
            maxMessageId: messageCountInfo.maxMessageId,
            loadSeq: getActiveMessageLoadSeq()
        });
        return true;
    };

    const loadMoreChatMessage = () => {
        loadChatMessage({ keepScrollPosition: true });
    };

    const chatSessionClickHandler = (item) => {
        markSessionRead?.(item.contactId);
        if (currentChatSession.value.contactId == item.contactId) {
            const shouldLoadMessages = !currentChatSession.value.sessionId && item.sessionId;
            currentChatSession.value = Object.assign({}, currentChatSession.value, item);
            if (shouldLoadMessages) {
                messageList.value = [];
                messageIdSet = new Set();
                messageLoadingMore.value = false;
                pendingPrependScrollState = null;
                resetMessageCountInfo();
                shouldScrollToBottomAfterLoad = true;
                loadChatMessage();
            }
            return;
        }

        startMessagePanelRender();
        currentChatSession.value = Object.assign({}, item);
        messageList.value = [];
        messageIdSet = new Set();
        messageLoadingMore.value = false;
        pendingPrependScrollState = null;
        resetMessageCountInfo();
        shouldScrollToBottomAfterLoad = true;
        loadChatMessage();
    };

    const onLoadChatMessage = () => {
        window.ipcRenderer.on('loadChatMessageCallback', async (e, { dataList, pageTotal, pageNo, sessionId, loadSeq }) => {
            const isExpiredLoad = loadSeq != null && loadSeq !== getActiveMessageLoadSeq();
            const isWrongSession = sessionId != null && sessionId !== currentChatSession.value.sessionId;
            if (isExpiredLoad || isWrongSession) {
                messageLoadingMore.value = false;
                pendingPrependScrollState = null;
                return;
            }
            const loadedMessages = Array.isArray(dataList) ? dataList : [];
            if (pageNo >= pageTotal || loadedMessages.length === 0) {
                messageCountInfo.noData = true;
            }
            loadedMessages.sort((a, b) => {
                return a.messageId - b.messageId;
            });
            messageList.value = loadedMessages.concat(messageList.value);
            rebuildMessageIdSet();
            messageCountInfo.pageNo = pageNo;
            messageCountInfo.totalPage = pageTotal;
            if (pageNo == 1) {
                messageCountInfo.maxMessageId = loadedMessages.length > 0 ? loadedMessages[0].messageId : null;
            }
            if (shouldScrollToBottomAfterLoad && pageNo == 1) {
                shouldScrollToBottomAfterLoad = false;
                showMessagePanelAtBottom(getMessagePanelRenderSeq());
            } else if (messageLoadingMore.value) {
                await restorePrependScrollPosition();
            }
            messageLoadingMore.value = false;
        });
    };

    const onReceiveMessage = () => {
        window.ipcRenderer.on('receiveMessageBatch', async (e, payload = {}) => {
            const messages = Array.isArray(payload.messages) ? payload.messages : [];
            const sessionPatches = Array.isArray(payload.sessionPatches) ? payload.sessionPatches : [];
            const statusUpdates = Array.isArray(payload.statusUpdates) ? payload.statusUpdates : [];

            applySessionPatches?.(sessionPatches);
            statusUpdates.forEach((message) => {
                handleFileUploadDone(message);
            });
            await handleIncomingMessages(messages);
        });

        window.ipcRenderer.on('receiveMessage', (e, message) => {
            console.log('收到消息', message);
            if (typeof message === 'string') {
                message = JSON.parse(message);
            }
            if (message.messageType == 0) {
                loadChatSession();
                return;
            }
            if (message.messageType == 6) {
                handleFileUploadDone(message);
                return;
            }
            const receiveContactId = message.contactType == 1 ? message.contactId : message.sendUserId;
            const isCurrentSession = message.sessionId == currentChatSession.value.sessionId ||
                receiveContactId == currentChatSession.value.contactId;
            if (isCurrentSession) {
                markSessionRead?.(receiveContactId);
                const exists = messageList.value.some((item) => item.messageId == message.messageId);
                if (!exists) {
                    const shouldStickToBottom = isNearMessageBottom();
                    messageList.value.push(message);
                    scrollMessageToBottom({ force: shouldStickToBottom });
                }
            }
            loadChatSession();
        });
    };

    const registerMessageListeners = () => {
        onReceiveMessage();
        onLoadChatMessage();
    };

    const removeMessageListeners = () => {
        window.ipcRenderer.removeAllListeners('receiveMessage');
        window.ipcRenderer.removeAllListeners('receiveMessageBatch');
        window.ipcRenderer.removeAllListeners('loadChatMessageCallback');
    };

    const cleanupChatMessages = () => {
        removeMessageListeners();
        cleanupMessageScroll();
        messageLoadingMore.value = false;
        pendingPrependScrollState = null;
        messageList.value.forEach((message) => {
            if (message.localPreviewUrl) {
                URL.revokeObjectURL(message.localPreviewUrl);
            }
        });
    };

    return {
        chatSessionClickHandler,
        cleanupChatMessages,
        clearCurrentMessages,
        clearInitialBottomLock,
        loadChatMessage,
        loadMoreChatMessage,
        messageList,
        messageLoadingMore,
        messagePanelPhase,
        onSendChatMessage,
        onSendFileMessage,
        onSendImageMessage,
        onSendVideoMessage,
        registerMessageListeners,
        settleScrollToBottom
    };
};
