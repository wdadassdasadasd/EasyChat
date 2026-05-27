import { ref } from 'vue';
import { useChatMessageSender } from './useMessageSender';
import { useMessageScroll } from './useMessageScroll';

export const useChatMessages = ({ currentChatSession, loadChatSession, proxy }) => {
    const messageCountInfo = {
        totalPage: 0,
        pageNo: 0,
        maxMessageId: 0,
        noData: false
    };
    const messageList = ref([]);
    let shouldScrollToBottomAfterLoad = false;

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
        onSendImageMessage
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
        messageList.value = [];
        resetMessageCountInfo();
        messageCountInfo.noData = true;
        markMessagePanelReady();
    };

    const loadChatMessage = () => {
        if (!currentChatSession.value.sessionId) {
            messageCountInfo.noData = true;
            markMessagePanelReady();
            return;
        }
        if (messageCountInfo.noData) {
            return;
        }
        messageCountInfo.pageNo++;
        window.ipcRenderer.send('loadChatMessage', {
            sessionId: currentChatSession.value.sessionId,
            pageNo: messageCountInfo.pageNo,
            maxMessageId: messageCountInfo.maxMessageId,
            loadSeq: getActiveMessageLoadSeq()
        });
    };

    const chatSessionClickHandler = (item) => {
        if (currentChatSession.value.contactId == item.contactId) {
            const shouldLoadMessages = !currentChatSession.value.sessionId && item.sessionId;
            currentChatSession.value = Object.assign({}, currentChatSession.value, item);
            if (shouldLoadMessages) {
                messageList.value = [];
                resetMessageCountInfo();
                shouldScrollToBottomAfterLoad = true;
                loadChatMessage();
            }
            return;
        }

        startMessagePanelRender();
        currentChatSession.value = Object.assign({}, item);
        messageList.value = [];
        resetMessageCountInfo();
        shouldScrollToBottomAfterLoad = true;
        loadChatMessage();
    };

    const onLoadChatMessage = () => {
        window.ipcRenderer.on('loadChatMessageCallback', (e, { dataList, pageTotal, pageNo, sessionId, loadSeq }) => {
            const isExpiredLoad = loadSeq != null && loadSeq !== getActiveMessageLoadSeq();
            const isWrongSession = sessionId != null && sessionId !== currentChatSession.value.sessionId;
            if (isExpiredLoad || isWrongSession) {
                return;
            }
            if (pageNo == pageTotal) {
                messageCountInfo.noData = true;
            }
            dataList.sort((a, b) => {
                return a.messageId - b.messageId;
            });
            messageList.value = dataList.concat(messageList.value);
            messageCountInfo.pageNo = pageNo;
            messageCountInfo.totalPage = pageTotal;
            if (pageNo == 1) {
                messageCountInfo.maxMessageId = dataList.length > 0 ? dataList[dataList.length - 1].maxMessageId : null;
            }
            if (shouldScrollToBottomAfterLoad && pageNo == 1) {
                shouldScrollToBottomAfterLoad = false;
                showMessagePanelAtBottom(getMessagePanelRenderSeq());
            }
        });
    };

    const onReceiveMessage = () => {
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
            if (message.sessionId == currentChatSession.value.sessionId) {
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
        window.ipcRenderer.removeAllListeners('loadChatMessageCallback');
    };

    const cleanupChatMessages = () => {
        removeMessageListeners();
        cleanupMessageScroll();
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
        messageList,
        messagePanelPhase,
        onSendChatMessage,
        onSendFileMessage,
        onSendImageMessage,
        registerMessageListeners,
        settleScrollToBottom
    };
};
