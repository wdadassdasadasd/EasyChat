import { nextTick, ref } from 'vue';

export const useMessageScroll = () => {
    const messagePanelPhase = ref('ready');
    let messagePanelRenderSeq = 0;
    let activeMessageLoadSeq = 0;
    let initialBottomLockSeq = 0;
    let initialBottomLockTimer = null;
    let messagePanelEnterTimer = null;
    let pendingBottomSettleFrame = null;

    const getMessagePanel = () => {
        return document.getElementById('message-panel');
    };

    const setMessagePanelToBottom = () => {
        const messagePanel = getMessagePanel();
        if (messagePanel) {
            const bottomScrollTop = Math.max(0, messagePanel.scrollHeight - messagePanel.clientHeight);
            messagePanel.scrollTo({
                top: bottomScrollTop,
                behavior: 'auto'
            });
        }
    };

    const clearInitialBottomLock = () => {
        initialBottomLockSeq = 0;
        if (initialBottomLockTimer) {
            window.clearTimeout(initialBottomLockTimer);
            initialBottomLockTimer = null;
        }
    };

    const keepInitialBottomLock = (renderSeq) => {
        clearInitialBottomLock();
        initialBottomLockSeq = renderSeq;
        initialBottomLockTimer = window.setTimeout(() => {
            if (initialBottomLockSeq === renderSeq) {
                initialBottomLockSeq = 0;
            }
            initialBottomLockTimer = null;
        }, 5000);
    };

    const isInitialBottomLocked = () => {
        return initialBottomLockSeq !== 0 && initialBottomLockSeq === messagePanelRenderSeq;
    };

    const clearMessagePanelEnterTimer = () => {
        if (messagePanelEnterTimer) {
            window.clearTimeout(messagePanelEnterTimer);
            messagePanelEnterTimer = null;
        }
    };

    const clearPendingBottomSettleFrame = () => {
        if (pendingBottomSettleFrame) {
            window.cancelAnimationFrame(pendingBottomSettleFrame);
            pendingBottomSettleFrame = null;
        }
    };

    const scheduleBottomSettle = () => {
        if (pendingBottomSettleFrame) {
            return;
        }

        pendingBottomSettleFrame = window.requestAnimationFrame(() => {
            pendingBottomSettleFrame = null;
            setMessagePanelToBottom();
        });
    };

    const isNearMessageBottom = (threshold = 120) => {
        const messagePanel = getMessagePanel();
        if (!messagePanel) {
            return true;
        }
        return messagePanel.scrollHeight - messagePanel.scrollTop - messagePanel.clientHeight < threshold;
    };

    const scrollMessageToBottom = async ({ force = false } = {}) => {
        if (!force && !isNearMessageBottom()) {
            return;
        }

        await nextTick();
        setMessagePanelToBottom();
    };

    const settleScrollToBottom = () => {
        if (isInitialBottomLocked() || isNearMessageBottom(360)) {
            scheduleBottomSettle();
        }
    };

    const waitForNextFrame = () => {
        return new Promise((resolve) => {
            window.requestAnimationFrame(resolve);
        });
    };

    const showMessagePanelAtBottom = async (renderSeq = messagePanelRenderSeq) => {
        await nextTick();
        if (renderSeq !== messagePanelRenderSeq) {
            return;
        }
        setMessagePanelToBottom();
        await waitForNextFrame();
        if (renderSeq !== messagePanelRenderSeq) {
            return;
        }
        setMessagePanelToBottom();
        await waitForNextFrame();
        if (renderSeq !== messagePanelRenderSeq) {
            return;
        }
        messagePanelPhase.value = 'entering';
        keepInitialBottomLock(renderSeq);
        clearMessagePanelEnterTimer();
        messagePanelEnterTimer = window.setTimeout(() => {
            if (renderSeq === messagePanelRenderSeq) {
                messagePanelPhase.value = 'ready';
            }
            messagePanelEnterTimer = null;
        }, 120);
    };

    const startMessagePanelRender = () => {
        clearInitialBottomLock();
        clearMessagePanelEnterTimer();
        clearPendingBottomSettleFrame();
        messagePanelRenderSeq++;
        activeMessageLoadSeq = messagePanelRenderSeq;
        messagePanelPhase.value = 'preparing';
        return messagePanelRenderSeq;
    };

    const markMessagePanelReady = () => {
        messagePanelPhase.value = 'ready';
    };

    const getMessagePanelRenderSeq = () => {
        return messagePanelRenderSeq;
    };

    const getActiveMessageLoadSeq = () => {
        return activeMessageLoadSeq;
    };

    const cleanupMessageScroll = () => {
        clearInitialBottomLock();
        clearMessagePanelEnterTimer();
        clearPendingBottomSettleFrame();
    };

    return {
        messagePanelPhase,
        clearInitialBottomLock,
        getActiveMessageLoadSeq,
        getMessagePanelRenderSeq,
        isNearMessageBottom,
        markMessagePanelReady,
        scrollMessageToBottom,
        settleScrollToBottom,
        showMessagePanelAtBottom,
        startMessagePanelRender,
        cleanupMessageScroll
    };
};
