import { nextTick, ref } from 'vue';
import { useChatMessageSender } from './useMessageSender';
import { useMessageScroll } from './useMessageScroll';

export const useChatMessages = ({
    currentChatSession,
    currentUserId,
    loadChatSession,
    markSessionRead,
    messageListRef,
    patchChatSessions,
    proxy
}) => {
    const messageCountInfo = {
        totalPage: 0,
        pageNo: 0,
        maxMessageId: 0,
        noData: false
    };
    const messageList = ref([]);
    const messageLoadingMore = ref(false);
    const messageIdSet = new Set();
    // 首屏加载需要自动贴底；向上翻页则要保持用户当前阅读位置。
    let shouldScrollToBottomAfterLoad = false;
    let pendingPrependScrollState = null;

    const {
        cleanupMessageScroll,
        clearInitialBottomLock,
        getActiveMessageLoadSeq,
        getMessagePanel,
        getMessagePanelRenderSeq,
        isNearMessageBottom,
        markMessagePanelReady,
        messagePanelPhase,
        scrollMessageToBottom,
        settleScrollToBottom,
        showMessagePanelAtBottom,
        startMessagePanelRender
    } = useMessageScroll({ messageListRef });

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

    const getReceiveContactId = (message = {}) => {
        if (message.contactType == 1) {
            return message.contactId;
        }
        return message.sendUserId == currentUserId?.value
            ? message.contactId
            : message.sendUserId;
    };

    const rebuildMessageIdSet = () => {
        messageIdSet.clear();
        messageList.value.forEach((message) => {
            if (message.messageId != null) {
                messageIdSet.add(String(message.messageId));
            }
        });
    };

    const appendMessageIfMissing = (message) => {
        if (!message) {
            return false;
        }
        const messageId = message.messageId != null ? String(message.messageId) : '';
        if (messageId && messageIdSet.has(messageId)) {
            return false;
        }
        messageList.value.push(message);
        if (messageId) {
            messageIdSet.add(messageId);
        }
        return true;
    };

    const clearCurrentMessages = () => {
        // 清空当前会话后主动标记无更多数据，避免滚动到顶部又触发旧消息分页加载。
        startMessagePanelRender();
        messageList.value = [];
        messageIdSet.clear();
        messageLoadingMore.value = false;
        pendingPrependScrollState = null;
        resetMessageCountInfo();
        messageCountInfo.noData = true;
        markMessagePanelReady();
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

        // 历史消息 prepend 后 scrollHeight 会变大，用高度差把视口还原到用户原来的阅读位置。
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
        // loadSeq 用来识别过期分页回包，防止快速切换会话时旧回包写入新会话。
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
            // 同一会话从路由补齐 sessionId 后，需要补拉一次历史消息。
            const shouldLoadMessages = !currentChatSession.value.sessionId && item.sessionId;
            currentChatSession.value = Object.assign({}, currentChatSession.value, item);
            if (shouldLoadMessages) {
                messageList.value = [];
                messageIdSet.clear();
                messageLoadingMore.value = false;
                pendingPrependScrollState = null;
                resetMessageCountInfo();
                shouldScrollToBottomAfterLoad = true;
                loadChatMessage();
            }
            return;
        }

        // 切换会话时重置分页游标和渲染序列，旧会话的滚动/分页状态不带入新会话。
        startMessagePanelRender();
        currentChatSession.value = Object.assign({}, item);
        messageList.value = [];
        messageIdSet.clear();
        messageLoadingMore.value = false;
        pendingPrependScrollState = null;
        resetMessageCountInfo();
        shouldScrollToBottomAfterLoad = true;
        loadChatMessage();
    };

    const onLoadChatMessage = () => {
        window.ipcRenderer.on('loadChatMessageCallback', async (e, { dataList, pageTotal, pageNo, sessionId, loadSeq }) => {
            // 主进程分页回调必须同时校验会话和渲染序列，避免异步回包串会话。
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
                messageCountInfo.maxMessageId = loadedMessages.length > 0 ? loadedMessages[loadedMessages.length - 1].maxMessageId : null;
            }
            if (shouldScrollToBottomAfterLoad && pageNo == 1) {
                shouldScrollToBottomAfterLoad = false;
                // 首屏消息和图片封面可能异步撑高布局，交给滚动模块多帧贴底。
                showMessagePanelAtBottom(getMessagePanelRenderSeq());
            } else if (messageLoadingMore.value) {
                await restorePrependScrollPosition();
            }
            messageLoadingMore.value = false;
        });
    };

    const handleReceiveMessages = (messages = [], sessions = []) => {
        const readContactIds = new Set();
        let appended = false;
        const shouldStickToBottom = isNearMessageBottom();

        messages.forEach((message) => {
            if (message.messageType == 6) {
                handleFileUploadDone(message);
                return;
            }

            const receiveContactId = getReceiveContactId(message);
            const isCurrentSession = message.sessionId == currentChatSession.value.sessionId ||
                receiveContactId == currentChatSession.value.contactId;
            if (!isCurrentSession) {
                return;
            }

            readContactIds.add(receiveContactId);
            appended = appendMessageIfMissing(message) || appended;
        });

        readContactIds.forEach((contactId) => {
            markSessionRead?.(contactId);
        });

        if (typeof patchChatSessions === 'function') {
            patchChatSessions(sessions, {
                readContactIds: Array.from(readContactIds)
            });
        } else {
            loadChatSession();
        }

        if (appended) {
            scrollMessageToBottom({ force: shouldStickToBottom });
        }
    };

    const onReceiveMessage = () => {
        window.ipcRenderer.on('receiveMessage', (e, message) => {
            console.log('收到消息', message);
            if (typeof message === 'string') {
                message = JSON.parse(message);
            }
            if (message.messageType == 0) {
                // 初始化消息只提示 renderer 重新拉会话列表，消息明细已经由主进程落库。
                loadChatSession();
                return;
            }
            if (message.messageType == 6) {
                // 文件上传完成回执只更新本地消息状态，不重复插入一条消息。
                handleFileUploadDone(message);
                return;
            }
            const receiveContactId = getReceiveContactId(message);
            const isCurrentSession = message.sessionId == currentChatSession.value.sessionId ||
                receiveContactId == currentChatSession.value.contactId;
            if (isCurrentSession) {
                // 当前会话收到消息时直接追加到内存列表，并按用户是否靠近底部决定是否自动滚动。
                markSessionRead?.(receiveContactId);
                const exists = message.messageId != null && messageIdSet.has(String(message.messageId));
                if (!exists) {
                    const shouldStickToBottom = isNearMessageBottom();
                    appendMessageIfMissing(message);
                    scrollMessageToBottom({ force: shouldStickToBottom });
                }
            }
            loadChatSession();
        });
    };

    const onReceiveMessageBatch = () => {
        window.ipcRenderer.on('receiveMessageBatch', (e, payload = {}) => {
            const messages = Array.isArray(payload.messages) ? payload.messages : [];
            const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
            handleReceiveMessages(messages, sessions);
        });
    };

    const registerMessageListeners = () => {
        onReceiveMessage();
        onReceiveMessageBatch();
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
        messageIdSet.clear();
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
