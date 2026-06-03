import { nextTick, ref } from 'vue';
import { CHAT_CONSTANTS } from '@/utils/ChatConstants';

const {
    BOTTOM_GAP_TOLERANCE,
    INITIAL_BOTTOM_LOCK_DURATION,
    MAX_BOTTOM_SETTLE_FRAMES,
    STABLE_FRAME_COUNT,
    NEAR_BOTTOM_THRESHOLD,
    IMAGE_LOADED_BOTTOM_TOLERANCE
} = CHAT_CONSTANTS;

/**
 * 滚动状态机。
 * 将所有散落的序列号、计时器和标志位收敛到一个对象中，统一清理和检查。
 */
const createScrollState = () => {
    return {
        renderSeq: 0,        // 当前面板渲染序列，会话切换时递增
        loadSeq: 0,          // 当前分页加载序列，等于起始时的 renderSeq
        bottomLockSeq: 0,    // 首屏贴底锁序列，0 表示已解锁
        bottomLockTimer: null,  // 锁超时 handle
        bottomSettleFrame: null, // rAF handle，用于延迟贴底
    };
};

export const useMessageScroll = ({ messageListRef } = {}) => {
    const messagePanelPhase = ref('ready');
    const state = createScrollState();

    const getMessageList = () => messageListRef?.value || null;

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
        const panel = getMessagePanel();
        if (!panel) return null;
        return {
            scrollHeight: panel.scrollHeight,
            scrollTop: panel.scrollTop,
            clientHeight: panel.clientHeight,
            bottomGap: Math.max(0, panel.scrollHeight - panel.scrollTop - panel.clientHeight)
        };
    };

    const setMessagePanelToBottom = () => {
        const messageList = getMessageList();
        if (typeof messageList?.scrollToBottom === 'function') {
            messageList.scrollToBottom();
            return;
        }
        const panel = getMessagePanel();
        if (!panel) return;
        const bottom = Math.max(0, panel.scrollHeight - panel.clientHeight);
        const prev = panel.style.scrollBehavior;
        panel.style.scrollBehavior = 'auto';
        panel.scrollTop = bottom;
        if (prev) { panel.style.scrollBehavior = prev; }
        else { panel.style.removeProperty('scroll-behavior'); }
    };

    const getBottomGap = () => {
        const messageList = getMessageList();
        if (typeof messageList?.getBottomGap === 'function') {
            return messageList.getBottomGap();
        }
        const scrollState = getScrollState();
        return scrollState ? scrollState.bottomGap : 0;
    };

    // —— 锁管理 ——

    const cancelSettleFrame = () => {
        if (state.bottomSettleFrame) {
            cancelAnimationFrame(state.bottomSettleFrame);
            state.bottomSettleFrame = null;
        }
    };

    const clearInitialBottomLock = () => {
        state.bottomLockSeq = 0;
        if (state.bottomLockTimer) {
            clearTimeout(state.bottomLockTimer);
            state.bottomLockTimer = null;
        }
        cancelSettleFrame();
    };

    const keepInitialBottomLock = (renderSeq) => {
        clearInitialBottomLock();
        state.bottomLockSeq = renderSeq;
        state.bottomLockTimer = setTimeout(() => {
            if (state.bottomLockSeq === renderSeq) state.bottomLockSeq = 0;
            state.bottomLockTimer = null;
        }, INITIAL_BOTTOM_LOCK_DURATION);
    };

    const isInitialBottomLocked = () =>
        state.bottomLockSeq !== 0 && state.bottomLockSeq === state.renderSeq;

    const scheduleBottomSettle = () => {
        if (state.bottomSettleFrame) return;
        state.bottomSettleFrame = requestAnimationFrame(() => {
            state.bottomSettleFrame = null;
            setMessagePanelToBottom();
        });
    };

    // —— 公开 API ——

    const isNearMessageBottom = (threshold = NEAR_BOTTOM_THRESHOLD) => {
        const scrollState = getScrollState();
        if (!scrollState) return true;
        return scrollState.bottomGap < threshold;
    };

    const scrollMessageToBottom = async ({ force = false } = {}) => {
        if (!force && !isNearMessageBottom()) return;
        await nextTick();
        setMessagePanelToBottom();
    };

    const settleScrollToBottom = () => {
        if (isInitialBottomLocked() || isNearMessageBottom(IMAGE_LOADED_BOTTOM_TOLERANCE)) {
            scheduleBottomSettle();
        }
    };

    const waitNextFrame = () =>
        new Promise((resolve) => requestAnimationFrame(resolve));

    const showMessagePanelAtBottom = async (renderSeq = state.renderSeq) => {
        await nextTick();
        if (renderSeq !== state.renderSeq) return;

        let stableFrames = 0;
        let previousState = null;
        for (let idx = 0; idx < MAX_BOTTOM_SETTLE_FRAMES; idx++) {
            setMessagePanelToBottom();
            await waitNextFrame();
            if (renderSeq !== state.renderSeq) return;

            const scrollState = getScrollState();
            if (!scrollState) break;

            const pinned = getBottomGap() <= BOTTOM_GAP_TOLERANCE;
            const stable = previousState &&
                Math.abs(scrollState.scrollHeight - previousState.scrollHeight) <= 1 &&
                Math.abs(scrollState.scrollTop - previousState.scrollTop) <= 1;
            stableFrames = pinned && stable ? stableFrames + 1 : 0;
            previousState = scrollState;

            if (stableFrames >= STABLE_FRAME_COUNT) break;
        }

        setMessagePanelToBottom();
        if (renderSeq !== state.renderSeq) return;
        messagePanelPhase.value = 'ready';
        keepInitialBottomLock(renderSeq);
    };

    const startMessagePanelRender = () => {
        clearInitialBottomLock();
        cancelSettleFrame();
        state.renderSeq++;
        state.loadSeq = state.renderSeq;
        messagePanelPhase.value = 'preparing';
        return state.renderSeq;
    };

    const markMessagePanelReady = () => { messagePanelPhase.value = 'ready'; };
    const getMessagePanelRenderSeq = () => state.renderSeq;
    const getActiveMessageLoadSeq = () => state.loadSeq;

    const cleanupMessageScroll = () => {
        clearInitialBottomLock();
        cancelSettleFrame();
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
