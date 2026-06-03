import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

vi.mock('./useMessageSender', () => ({
    useChatMessageSender: () => ({
        handleFileUploadDone: vi.fn(),
        onSendChatMessage: vi.fn(),
        onSendFileMessage: vi.fn(),
        onSendImageMessage: vi.fn(),
        onSendVideoMessage: vi.fn(),
        retryFailedMessage: vi.fn()
    })
}));

vi.mock('./useMessageScroll', () => ({
    useMessageScroll: () => ({
        cleanupMessageScroll: vi.fn(),
        clearInitialBottomLock: vi.fn(),
        getActiveMessageLoadSeq: () => 1,
        getMessagePanel: () => ({ scrollHeight: 100, scrollTop: 0 }),
        getMessagePanelRenderSeq: () => 1,
        isNearMessageBottom: () => true,
        markMessagePanelReady: vi.fn(),
        messagePanelPhase: ref('ready'),
        scrollMessageToBottom: vi.fn(),
        settleScrollToBottom: vi.fn(),
        showMessagePanelAtBottom: vi.fn(),
        startMessagePanelRender: vi.fn()
    })
}));

let useChatMessages;

const createIpcMock = () => {
    const handlers = {};
    return {
        handlers,
        ipcRenderer: {
            on: vi.fn((channel, handler) => {
                handlers[channel] = handler;
            }),
            removeListener: vi.fn((channel) => {
                delete handlers[channel];
            }),
            send: vi.fn()
        }
    };
};

const createHarness = () => {
    const { handlers, ipcRenderer } = createIpcMock();
    global.window = {
        ipcRenderer,
        requestAnimationFrame: (callback) => setTimeout(callback, 0)
    };
    global.document = {
        getElementById: () => null
    };

    const currentChatSession = ref({
        contactId: 'u2',
        contactType: 0,
        sessionId: 's1'
    });
    const markSessionRead = vi.fn();
    const patchChatSessions = vi.fn();
    const proxy = {
        Message: {
            error: vi.fn(),
            warning: vi.fn()
        }
    };
    const chat = useChatMessages({
        currentChatSession,
        currentUserId: ref('u1'),
        loadChatSession: vi.fn(),
        markSessionRead,
        messageListRef: ref(null),
        patchChatSessions,
        proxy
    });
    chat.registerMessageListeners();

    return {
        chat,
        currentChatSession,
        handlers,
        markSessionRead,
        patchChatSessions,
        proxy
    };
};

describe('useChatMessages receive flow', () => {
    beforeAll(async () => {
        ({ useChatMessages } = await import('./useChatMessages'));
    });

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('appends only current-session messages from a batch and patches sessions', () => {
        const { chat, handlers, markSessionRead, patchChatSessions } = createHarness();
        const currentMessage = {
            messageId: 1,
            sessionId: 's1',
            contactId: 'u2',
            contactType: 0,
            messageType: 2,
            messageContent: 'hi',
            sendUserId: 'u2'
        };
        const otherMessage = {
            messageId: 2,
            sessionId: 's2',
            contactId: 'u3',
            contactType: 0,
            messageType: 2,
            messageContent: 'elsewhere',
            sendUserId: 'u3'
        };

        handlers.receiveMessageBatch({}, {
            messages: [currentMessage, otherMessage, currentMessage],
            sessions: [{ contactId: 'u2', sessionId: 's1' }]
        });

        expect(chat.messageList.value).toEqual([currentMessage]);
        expect(markSessionRead).toHaveBeenCalledWith('u2');
        expect(patchChatSessions).toHaveBeenCalledWith(
            [{ contactId: 'u2', sessionId: 's1' }],
            { readContactIds: ['u2'] }
        );
    });

    it('ignores expired or wrong-session message page callbacks', async () => {
        const { chat, currentChatSession, handlers } = createHarness();
        currentChatSession.value = { contactId: 'u2', sessionId: 's1', contactType: 0 };

        await handlers.loadChatMessageCallback({}, {
            dataList: [{ messageId: 9, sessionId: 's2' }],
            hasMore: false,
            sessionId: 's2',
            loadSeq: 1
        });

        expect(chat.messageList.value).toEqual([]);
    });

    it('surfaces batch receive failures without mutating the message list', () => {
        const { chat, handlers, proxy } = createHarness();

        handlers.receiveMessageBatch({}, {
            success: false,
            error: 'db failed'
        });

        expect(chat.messageList.value).toEqual([]);
        expect(proxy.Message.error).toHaveBeenCalledWith('db failed');
    });
});
