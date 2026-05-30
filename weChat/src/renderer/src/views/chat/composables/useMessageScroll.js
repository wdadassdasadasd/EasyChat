import { nextTick, ref } from 'vue';

export const useMessageScroll = ({ messageListRef } = {}) => {
    const messagePanelPhase = ref('ready');
    const BOTTOM_GAP_TOLERANCE = 2;
    const INITIAL_BOTTOM_LOCK_DURATION = 800;
    const MAX_BOTTOM_SETTLE_FRAMES = 8;
    const STABLE_FRAME_COUNT = 2;
    let messagePanelRenderSeq = 0;
    let activeMessageLoadSeq = 0;
    let initialBottomLockSeq = 0;
    let initialBottomLockTimer = null;
    let pendingBottomSettleFrame = null;

    const getMessageList = () => {
        return messageListRef?.value || null;
    };

    const getMessagePanel = () => {
        const messageList = getMessageList();
        if (typeof messageList?.getMessagePanelElement === 'function') {
            return messageList.getMessagePanelElement();
        }
        return document.getElementById('message-panel');
    };

    const getScrollState = () => {
        const messageList = getMessageList();
        if (typeof messageList?.getScrollState === 'function') {
            return messageList.getScrollState();
        }

        const messagePanel = getMessagePanel();
        if (!messagePanel) {
            return null;
        }
        return {
            scrollHeight: messagePanel.scrollHeight,
            scrollTop: messagePanel.scrollTop,
            clientHeight: messagePanel.clientHeight,
            bottomGap: Math.max(0, messagePanel.scrollHeight - messagePanel.scrollTop - messagePanel.clientHeight)
        };
    };

    const setMessagePanelToBottom = () => {
        const messageList = getMessageList();
        if (typeof messageList?.scrollToBottom === 'function') {
            messageList.scrollToBottom();
            return;
        }

        const messagePanel = getMessagePanel();
        if (messagePanel) {
            const bottomScrollTop = Math.max(0, messagePanel.scrollHeight - messagePanel.clientHeight);
            const previousScrollBehavior = messagePanel.style.scrollBehavior;
            messagePanel.style.scrollBehavior = 'auto';
            messagePanel.scrollTop = bottomScrollTop;
            if (previousScrollBehavior) {
                messagePanel.style.scrollBehavior = previousScrollBehavior;
            } else {
                messagePanel.style.removeProperty('scroll-behavior');
            }
        }
    };

    const getBottomGap = () => {
        const messageList = getMessageList();
        if (typeof messageList?.getBottomGap === 'function') {
            return messageList.getBottomGap();
        }

        const scrollState = getScrollState();
        return scrollState ? scrollState.bottomGap : 0;
    };

    const clearPendingBottomSettleFrame = () => {
        if (pendingBottomSettleFrame) {
            window.cancelAnimationFrame(pendingBottomSettleFrame);
            pendingBottomSettleFrame = null;
        }
    };

    const clearInitialBottomLock = () => {
        initialBottomLockSeq = 0;
        if (initialBottomLockTimer) {
            window.clearTimeout(initialBottomLockTimer);
            initialBottomLockTimer = null;
        }
        clearPendingBottomSettleFrame();
    };

    const keepInitialBottomLock = (renderSeq) => {
        clearInitialBottomLock();
        initialBottomLockSeq = renderSeq;
        initialBottomLockTimer = window.setTimeout(() => {
            if (initialBottomLockSeq === renderSeq) {
                initialBottomLockSeq = 0;
            }
            initialBottomLockTimer = null;
        }, INITIAL_BOTTOM_LOCK_DURATION);
    };

    const isInitialBottomLocked = () => {
        return initialBottomLockSeq !== 0 && initialBottomLockSeq === messagePanelRenderSeq;
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
        const scrollState = getScrollState();
        if (!scrollState) {
            return true;
        }
        return scrollState.bottomGap < threshold;
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

        let stableFrames = 0;
        let previousState = null;
        for (let index = 0; index < MAX_BOTTOM_SETTLE_FRAMES; index++) {
            setMessagePanelToBottom();
            await waitForNextFrame();
            if (renderSeq !== messagePanelRenderSeq) {
                return;
            }

            const scrollState = getScrollState();
            if (!scrollState) {
                break;
            }

            const isBottomPinned = getBottomGap() <= BOTTOM_GAP_TOLERANCE;
            const isLayoutStable = previousState &&
                Math.abs(scrollState.scrollHeight - previousState.scrollHeight) <= 1 &&
                Math.abs(scrollState.scrollTop - previousState.scrollTop) <= 1;
            stableFrames = isBottomPinned && isLayoutStable ? stableFrames + 1 : 0;
            previousState = scrollState;

            if (stableFrames >= STABLE_FRAME_COUNT) {
                break;
            }
        }

        setMessagePanelToBottom();
        if (renderSeq !== messagePanelRenderSeq) {
            return;
        }
        messagePanelPhase.value = 'ready';
        keepInitialBottomLock(renderSeq);
    };

    const startMessagePanelRender = () => {
        clearInitialBottomLock();
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
        clearPendingBottomSettleFrame();
    };

    return {
        messagePanelPhase,
        clearInitialBottomLock,
        getActiveMessageLoadSeq,
        getMessagePanel,
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
