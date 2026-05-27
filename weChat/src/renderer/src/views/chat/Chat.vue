<template>
    <Layout>
        <!-- 左侧：聊天会话列表。数据来自本地 SQLite，由主进程通过 loadSessionData 返回。 -->
        <template #left-content>
            <div class="chat-list-header">
                <span>聊天</span>
                <div class="top-search">
                    <el-input
                        v-model="searchKey"
                        size="small"
                        placeholder="搜索"
                        clearable
                        @keyup="search"
                    />
                </div>
            </div>
            <div class="chat-list-body">
                <ChatSession
                    v-for="item in chatSessionList"
                    :key="item.contactId"
                    :data="item"
                    :currentSession="currentChatSession.contactId == item.contactId"
                    @contextmenu.prevent.stop="onContextmenu(item, $event)"
                    @click="chatSessionClickHandler(item)"
                />
            </div>
        </template>
        <!-- 右侧：当前聊天窗口。选中会话后展示标题、消息列表和发送框。 -->
        <template #right-content>
            <template v-if="hasCurrentChat">
                <!-- 标题栏-->
                <div class="title-panel drag">
                    <div class="title">
                        <span>{{ currentChatSessionTitle }}</span>
                        <span class="title-count" v-if="currentChatSession.contactType == 1">{{ currentChatSession.memberCount }}</span>
                    </div>
                    <div
                        v-if="currentChatSession.contactType == 1"
                        class="title-more no-drag"
                        @click="shwGroupDetail"
                    >
                        <el-icon>
                            <MoreFilled />
                        </el-icon>
                    </div>
                </div>
                <!-- 消息列表-->
                <div class="chat-panel">
                    <!-- messageList 是当前会话的消息数组；push 新消息后，页面会自动刷新。 -->
                    <div
                        :class="['message-panel', 'message-panel-' + messagePanelPhase]"
                        id="message-panel"
                        ref="messagePanelRef"
                        @wheel.passive="clearInitialBottomLock"
                        @pointerdown="clearInitialBottomLock"
                    >
                        <div class="message-panel-content">
                            <template v-if="messageList.length > 0">
                                <div
                                    v-for="(data, index) in messageList"
                                    :key="data.messageId || index"
                                    :id="'message' + data.messageId"
                                    :class="['message-row', isSelfMessage(data) ? 'message-row-self' : '']"
                                >
                                <!-- 他人消息：头像在左 -->
                                <AvatarBase
                                    v-if="!isSelfMessage(data)"
                                    :userId="data.sendUserId"
                                    :width="36"
                                    :borderRadius="4"
                                    class="message-avatar"
                                />
                                <div :class="['message-body', isSelfMessage(data) ? 'message-body-self' : '']">
                                    <!-- 群聊时显示发送人昵称 -->
                                    <div
                                        v-if="currentChatSession.contactType == 1 && !isSelfMessage(data)"
                                        class="message-nick"
                                    >{{ data.sendUserNickName }}</div>
                                    <div :class="['message-item', isSelfMessage(data) ? 'message-item-self' : '', isImageMessage(data) ? 'message-item-image' : '', isFileMessage(data) ? 'message-item-file' : '']">
                                        <template v-if="isImageMessage(data)">
                                            <div class="message-image-frame">
                                                <el-image
                                                    v-if="data.localPreviewUrl"
                                                    :src="data.localPreviewUrl"
                                                    class="message-image"
                                                    fit="scale-down"
                                                    :preview-src-list="[data.localPreviewUrl]"
                                                    :preview-teleported="true"
                                                    :hide-on-click-modal="true"
                                                    @load="settleScrollToBottom"
                                                />
                                                <ShowLocalImage
                                                    v-else
                                                    :fileId="data.messageId"
                                                    :width="220"
                                                    partType="chat"
                                                    :fileType="data.fileType"
                                                    :forceGet="data.forceGet"
                                                    :preview="true"
                                                    @loaded="settleScrollToBottom"
                                                />
                                            </div>
                                        </template>
                                        <template v-else-if="isFileMessage(data)">
                                            <div
                                                :class="['file-message-card', isSelfMessage(data) ? 'file-message-card-self' : '']"
                                                @click="openFilePreviewDialog(data)"
                                            >
                                                <div class="file-message-main">
                                                    <div class="file-message-info">
                                                        <div class="file-message-name">{{ getFileMessageName(data) }}</div>
                                                    <div class="file-message-meta">
                                                        {{ formatFileSize(data.fileSize) }}
                                                        <span class="file-message-status">{{ getFileMessageStatusText(data) }}</span>
                                                    </div>
                                                </div>
                                                <div class="file-message-icon">
                                                    <span>?</span>
                                                </div>
                                            </div>
                                                <div class="file-message-source">
                                                    <span class="file-message-source-icon"></span>
                                                    <span>&#24494;&#20449;&#30005;&#33041;&#29256;</span>
                                                </div>
                                            </div>
                                        </template>
                                        <template v-else>
                                            {{ data.messageContent }}
                                        </template>
                                    </div>
                                </div>
                                <!-- 自己的消息：头像在右 -->
                                <AvatarBase
                                    v-if="isSelfMessage(data)"
                                    :userId="data.sendUserId"
                                    :width="36"
                                    :borderRadius="4"
                                    class="message-avatar"
                                />
                                </div>
                                <div ref="messageBottomRef" class="message-bottom-anchor"></div>
                            </template>
                            <div class="chat-empty" v-else>
                                <div class="empty-tip">{{ welcomeText }}</div>
                            </div>
                        </div>
                    </div>
                </div>
                <!-- MessageSend 只负责输入；真正调发送接口的是父组件Chat.vue 。 -->
                <MessageSend
                    :currentChatSession="currentChatSession"
                    @sendMessage="onSendChatMessage"
                    @sendImageMessage="onSendImageMessage"
                    @sendFileMessage="onSendFileMessage"
                />
            </template>
            <!-- 没有选中会话时，右侧显示默认空状态。 --> 
            <div class="chat-empty chat-empty-default" v-else>
                <el-icon class="wechat-empty-icon">
                    <ChatDotRound />
                </el-icon>
            </div>
            <WinOp :showSetTop="true" :showMin="true" :showMax="true" :closeType="1" showSetTop="1" />
            <el-dialog
                v-model="showFilePreviewDialog"
                width="690px"
                top="60px"
                class="file-preview-dialog"
                :show-close="true"
                :close-on-click-modal="true"
                :append-to-body="true"
                @closed="closeFilePreviewDialog"
            >
                <div class="file-preview-panel" v-if="selectedFileMessage">
                    <div class="file-preview-icon">
                        <span>?</span>
                    </div>
                    <div class="file-preview-name">{{ getFileMessageName(selectedFileMessage) }}</div>
                    <div class="file-preview-size">&#25991;&#20214;&#22823;&#23567;&#65306;{{ formatFileSize(selectedFileMessage.fileSize) }}</div>
                    <button
                        class="file-preview-action"
                        type="button"
                        :disabled="isFileReceiveDisabled(selectedFileMessage) || isReceivingFile"
                        @click="receiveSelectedFileMessage"
                    >
                        {{ isReceivingFile ? '\u63a5\u6536\u4e2d' : '\u63a5\u6536\u6587\u4ef6' }}
                    </button>
                    <div class="file-preview-expire">&#23558;&#22312;13&#22825;&#21518;&#26080;&#27861;&#19979;&#36733;</div>
                </div>
            </el-dialog>
        </template>
    </Layout>
</template>

<script setup>
import { computed, getCurrentInstance, onMounted, onUnmounted, ref ,nextTick, toRaw, watch} from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUserInfoStore } from '../../stores/userInfoStore';
import ChatSession from './ChatSession.vue';
import ContextMenu from '@imengyu/vue3-context-menu';
import MessageSend from './MessageSend.vue';
import ShowLocalImage from '../../components/ShowLocalImage.vue';

const { proxy } = getCurrentInstance();
const userInfoStore = useUserInfoStore();
const route = useRoute();
const router = useRouter();
const searchKey = ref();

// 左侧会话列表。每一项对应本地 chat_session_user 表中的一条会话。
const chatSessionList = ref([]);

/**
 * 搜索会话。
 *
 * 调用时机：左侧搜索框输入内容时触发。
 * 当前状态：函数还没有实现，后续可以根据 searchKey 过滤 chatSessionList。
 */
const search = () => {
};

/**
 * 加载左侧会话列表。
 *
 * 渲染进程不直接操作 SQLite，所以这里只向主进程发送 IPC 事件。
 * 主进程收到 loadSessionData 后，会查询本地 chat_session_user 表，
 * 再通过 loadSessionDataCallback 把结果回传给 onLoadSessionData。
 */
const loadChatSession = () => {
    // 渲染进程不能直接查 SQLite，这里通过 IPC 通知主进程加载本地会话列表。
    window.ipcRenderer.send('loadSessionData');
};

/**
 * 对会话列表排序。
 *
 * 排序规则：
 * 1. topType 大的排前面，也就是置顶会话优先。
 * 2. topType 相同时，lastReceiveTime 越大越靠前，也就是最近聊天靠前。
 */
const sortChatSessionList = (dataList) => {
    // 排序规则：置顶优先；同样置顶状态下，最近消息时间越新越靠前。
    dataList.sort((a, b) => {
        const topTypeResult = b.topType - a.topType;
        if (topTypeResult == 0) {
            return b.lastReceiveTime - a.lastReceiveTime;
        }
        return topTypeResult;
    });
};

/**
 * 从前端会话列表中移除某个会话。
 *
 * 这里只改页面内存中的 chatSessionList，不负责写数据库。
 * 真正写数据库的是 delChatSession 里的 IPC：delChatSession。
 */
const delChatSessionList = (contactId) => {
    chatSessionList.value = chatSessionList.value.filter((item) => {
        return item.contactId != contactId;
    });
};

const currentChatSession = ref({});

// 当前会话的分页信息。加载历史消息时会用它继续查上一页。
const messageCountInfo = {
    totalPage: 0,
    pageNo: 0,
    maxMessageId: 0,
    noData: false
};

// 当前右侧聊天窗口展示的消息列表。
const messageList = ref([]);
const messagePanelRef = ref(null);
const messageBottomRef = ref(null);
const messagePanelPhase = ref('ready');
const selectedFileMessage = ref(null);
const showFilePreviewDialog = ref(false);
const isReceivingFile = ref(false);
const hasCurrentChat = computed(() => Object.keys(currentChatSession.value).length > 0);
const currentChatSessionTitle = computed(() => {
    return getSessionName(currentChatSession.value);
});
let shouldScrollToBottomAfterLoad = false;
let messagePanelRenderSeq = 0;
let activeMessageLoadSeq = 0;
let initialBottomLockSeq = 0;
let initialBottomLockTimer = null;
let messagePanelEnterTimer = null;
let pendingBottomSettleFrame = null;

// 判断消息是否由当前登录用户发送，用于控制左右对齐和气泡颜色。
const isSelfMessage = (message) => {
    return message?.sendUserId == userInfoStore.getInfo()?.userId;
};

const getSessionName = (session = {}) => {
    return getRealSessionName(session) || session.contactId || '';
};

const getRealSessionName = (session = {}) => {
    const realName = session.contactName || session.groupName || session.nickName || '';
    if (realName && realName != session.contactId) {
        return realName;
    }
    return '';
};

const getContactTypeValue = (type) => {
    if (type === 'GROUP' || type == 1) {
        return 1;
    }
    return 0;
};

const getSessionInfoFromServer = async (contactId, contactType) => {
    if (!contactId) {
        return {};
    }

    if (contactType == 1) {
        const result = await proxy.Request({
            url: proxy.Api.getGroupInfo,
            params: {
                groupId: contactId
            },
            showLoading: false,
            showError: false
        });

        const groupInfo = result?.data?.groupInfo || result?.data?.group || result?.data || {};
        const groupName = groupInfo.groupName || result?.data?.groupName;
        return {
            contactId,
            contactType,
            contactName: groupName,
            memberCount: groupInfo.memberCount,
            groupName
        };
    }

    const result = await proxy.Request({
        url: proxy.Api.getContactUserInfo,
        params: {
            contactId
        },
        showLoading: false,
        showError: false
    });

    const userInfo = result?.data || {};
    return {
        contactId,
        contactType,
        contactName: userInfo.contactName || userInfo.nickName,
        nickName: userInfo.nickName
    };
};

const fillSessionName = async (session) => {
    if (!session?.contactId) {
        return session;
    }
    if (session.contactType != 1 && getRealSessionName(session)) {
        return session;
    }
    const serverInfo = await getSessionInfoFromServer(session.contactId, session.contactType);
    return Object.assign({}, session, serverInfo, {
        contactName: serverInfo.contactName || session.contactName
    });
};

const syncCurrentSession = (session) => {
    if (currentChatSession.value.contactId == session.contactId) {
        currentChatSession.value = Object.assign({}, currentChatSession.value, session);
    }
};

const hydrateSessionList = async (dataList = []) => {
    const hydratedList = await Promise.all(dataList.map(fillSessionName));
    hydratedList.forEach(syncCurrentSession);
    return hydratedList;
};

const openChatFromRoute = async () => {
    const chatId = route.query.chatId;
    if (!chatId) {
        return;
    }

    const contactType = getContactTypeValue(route.query.type);
    let session = chatSessionList.value.find((item) => item.contactId == chatId);
    if (session) {
        if (route.query.contactName && (session.contactType == 1 || !getRealSessionName(session))) {
            session = Object.assign({}, session, {
                contactName: route.query.contactName,
                memberCount: route.query.memberCount || session.memberCount
            });
        }
        session = await fillSessionName(session);
        const index = chatSessionList.value.findIndex((item) => item.contactId == chatId);
        if (index !== -1) {
            chatSessionList.value[index] = session;
        }
        chatSessionClickHandler(session);
        return;
    }

    const serverInfo = await getSessionInfoFromServer(chatId, contactType);
    session = {
        contactId: chatId,
        contactType,
        contactName: serverInfo.contactName || route.query.contactName || chatId,
        memberCount: serverInfo.memberCount,
        status: 1,
        topType: 0,
        noReadCount: 0
    };
    chatSessionList.value.unshift(session);
    chatSessionClickHandler(session);
};

// 没有消息时显示的欢迎文案，群聊和单聊文案不同。
const welcomeText = computed(() => {
    if (currentChatSession.value.contactType == 1) {
        return `${currentChatSessionTitle.value} 已创建好，快来开始群聊吧`;
    }
    return `欢迎和 ${currentChatSessionTitle.value || ''} 开始聊天`;
});

/**
 * 点击左侧会话。
 *
 * 做的事情：
 * 1. 把点击的会话设为 currentChatSession。
 * 2. 清空右侧消息列表，避免显示上一个会话的消息。
 * 3. 重置分页信息。
 * 4. 调 loadChatMessage 加载当前会话第一页消息。
 */
const chatSessionClickHandler = (item) => {
    if (currentChatSession.value.contactId == item.contactId) {
        const shouldLoadMessages = !currentChatSession.value.sessionId && item.sessionId;
        currentChatSession.value = Object.assign({}, currentChatSession.value, item);
        if (shouldLoadMessages) {
            messageList.value = [];
            messageCountInfo.totalPage = 1;
            messageCountInfo.pageNo = 0;
            messageCountInfo.maxMessageId = 0;
            messageCountInfo.noData = false;
            shouldScrollToBottomAfterLoad = true;
            loadChatMessage();
        }
        return;
    }

    // 点击左侧会话后，切换当前会话，并重置消息分页状态。
    clearInitialBottomLock();
    clearMessagePanelEnterTimer();
    clearPendingBottomSettleFrame();
    messagePanelRenderSeq++;
    activeMessageLoadSeq = messagePanelRenderSeq;
    messagePanelPhase.value = 'preparing';
    currentChatSession.value = Object.assign({}, item);
    messageList.value = [];

    messageCountInfo.totalPage = 1;
    messageCountInfo.pageNo = 0;
    messageCountInfo.maxMessageId = 0;
    messageCountInfo.noData = false;
    shouldScrollToBottomAfterLoad = true;
    loadChatMessage();
};

/**
 * 加载当前会话的聊天消息。
 *
 * 数据来源：客户端本地 SQLite 的 chat_message 表。
 * 交互方式：渲染进程发送 loadChatMessage 给主进程。
 * 返回位置：onLoadChatMessage 监听 loadChatMessageCallback。
 */
const loadChatMessage = () => {
    if (!currentChatSession.value.sessionId) {
        messageCountInfo.noData = true;
        messagePanelPhase.value = 'ready';
        return;
    }
    if (messageCountInfo.noData) {
        return;
    }
    messageCountInfo.pageNo++;
    // 通过 IPC 让主进程从本地 chat_message 表中按 sessionId 分页查询消息。
    window.ipcRenderer.send('loadChatMessage', {
        sessionId: currentChatSession.value.sessionId,
        pageNo: messageCountInfo.pageNo,
        maxMessageId: messageCountInfo.maxMessageId,
        loadSeq: activeMessageLoadSeq
    });
};

/**
 * 滚动消息列表到底部。
 *
 * 为什么需要 nextTick：
 * messageList.push 后，DOM 不是立刻更新的。
 * 需要等 Vue 完成渲染后，再读取 scrollHeight 才准确。
 */
const getMessagePanel = () => {
    return messagePanelRef.value || document.getElementById('message-panel');
};

const setMessagePanelToBottom = () => {
    const messagePanel = messagePanelRef.value || document.getElementById('message-panel');
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

const scrollMessageToBottom = async ({ force = false } = {}) => {
    if (!force && !isNearMessageBottom()) {
        return;
    }

    // 等 Vue 把新消息渲染到 DOM 后，再把滚动条拉到底部。
    await nextTick();
    setMessagePanelToBottom();
};

const isNearMessageBottom = (threshold = 120) => {
    const messagePanel = getMessagePanel();
    if (!messagePanel) {
        return true;
    }
    return messagePanel.scrollHeight - messagePanel.scrollTop - messagePanel.clientHeight < threshold;
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

const onSendChatMessage = (payload) => {
    enqueueSendTask(() => sendChatMessage(payload));
};

const onSendImageMessage = (payload) => {
    enqueueSendTask(() => sendImageMessage(payload));
};

const onSendFileMessage = (payload) => {
    enqueueSendTask(() => sendFileMessage(payload));
};

/**
 * 发送聊天消息。
 *
 * 调用来源：MessageSend.vue 通过 emit('sendMessage') 抛给父组件。
 *
 * 发送方链路：
 * MessageSend.vue 输入内容
 * -> Chat.vue sendChatMessage
 * -> HTTP 调后端 /chat/sendMessage
 * -> 后端保存消息并返回完整消息对象
 * -> 当前页面 push 到 messageList，发送方立即看到消息
 *
 * 注意：发送消息走 HTTP 接口，不走 WebSocket。
 * WebSocket 主要负责接收别人发来的消息。
 */
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

        window.ipcRenderer.send('saveSendMessage', {
            message,
            chatSession: { ...toRaw(currentChatSession.value) }
        });
    }

    loadChatSession();
};


const isImageMessage = (message) => {
    return Number(message?.messageType) === 5 && Number(message?.fileType) === 0;
};

const isFileMessage = (message) => {
    return Number(message?.messageType) === 5 && Number(message?.fileType) === 2;
};

const getFileMessageName = (message) => {
    return message?.fileName || message?.messageContent || `file-${message?.messageId || ''}`;
};

const isFileReceiveDisabled = (message) => {
    return !isFileMessage(message) || message?.status == 0 || message?.uploading;
};

const getFileMessageStatusText = (message) => {
    if (message?.uploading || message?.status == 0) {
        return '\u4e0a\u4f20\u4e2d';
    }
    return '\u672a\u4e0b\u8f7d';
};

const formatFileSize = (size = 0) => {
    if (!size) {
        return '';
    }
    if (size < 1024) {
        return `${size} B`;
    }
    if (size < 1024 * 1024) {
        return `${(size / 1024).toFixed(1)} KB`;
    }
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
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

const sendImageMessage = async ({ contactId, contactType, file, cover }) => {
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
            fileType: 0
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

    message.localPreviewUrl = URL.createObjectURL(file);
    message.uploading = true;

    const shouldStickToBottom = isNearMessageBottom();
    messageList.value.push(message);
    scrollMessageToBottom({ force: shouldStickToBottom });

    uploadImageMessageFile(message, file, cover);
};

const sendFileMessage = async ({ contactId, contactType, file, cover }) => {
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
            fileType: 2
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

    message.uploading = true;
    const shouldStickToBottom = isNearMessageBottom();
    messageList.value.push(message);
    scrollMessageToBottom({ force: shouldStickToBottom });

    uploadImageMessageFile(message, file, cover);
};

const uploadImageMessageFile = async (message, file, cover) => {
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

const openFilePreviewDialog = (message) => {
    if (!isFileMessage(message)) {
        return;
    }
    selectedFileMessage.value = message;
    showFilePreviewDialog.value = true;
};

const closeFilePreviewDialog = () => {
    selectedFileMessage.value = null;
    isReceivingFile.value = false;
};

const receiveSelectedFileMessage = async () => {
    if (!selectedFileMessage.value || isFileReceiveDisabled(selectedFileMessage.value)) {
        return;
    }

    isReceivingFile.value = true;
    const isDownloaded = await downloadFileMessage(selectedFileMessage.value);
    isReceivingFile.value = false;
    if (isDownloaded) {
        showFilePreviewDialog.value = false;
    }
};

const downloadFileMessage = async (message) => {
    if (!isFileMessage(message) || message.status == 0) {
        return false;
    }

    const blob = await proxy.Request({
        url: proxy.Api.downloadFile,
        params: {
            fileId: message.messageId,
            showCover: false
        },
        responseType: 'blob',
        showLoading: false
    });

    if (!blob) {
        return false;
    }

    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = message.fileName || message.messageContent || `file-${message.messageId}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
    }, 1000);
    return true;
};

/**
 * 注册“加载聊天消息完成”的 IPC 回调。
 *
 * 主进程查询完本地 chat_message 表后，会回传：
 * - dataList：本页消息
 * - pageTotal：总页数
 * - pageNo：当前页码
 *
 * 这里会把新加载的历史消息拼到 messageList 前面。
 */
const onLoadChatMessage = () => {
    // 主进程查询完本地聊天消息后，会通过 loadChatMessageCallback 回传给渲染进程。
    window.ipcRenderer.on('loadChatMessageCallback', (e, { dataList, pageTotal, pageNo, sessionId, loadSeq }) => {
        const isExpiredLoad = loadSeq != null && loadSeq !== activeMessageLoadSeq;
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
            showMessagePanelAtBottom(messagePanelRenderSeq);
        }
    });
};

/**
 * 注册“收到新消息”的 IPC 回调。
 *
 * 真实来源是后端 WebSocket：
 * 后端 WebSocket 推送
 * -> 主进程 wsClient.js 收到
 * -> 主进程保存到本地 SQLite
 * -> 主进程通过 receiveMessage 通知渲染进程
 * -> Chat.vue 根据 sessionId 判断是否展示到当前聊天窗口
 */
const onReceiveMessage = () => {
    // 主进程 wsClient 收到后端 WebSocket 推送后，会用 receiveMessage 通知当前页面。
    window.ipcRenderer.on('receiveMessage', (e, message) => {
        console.log('收到消息', message);
        if (typeof message === 'string') {
            message = JSON.parse(message);
        }
        if (message.messageType == 0) {
            // messageType=0 是 WebSocket 初始化消息，不是普通聊天内容，只刷新会话列表。
            loadChatSession();
            return;
        }
        if (message.messageType == 6) {
            handleFileUploadDone(message);
            return;
        }
        if(message.sessionId==currentChatSession.value.sessionId){
            // 如果推送消息属于当前打开的会话，直接追加到右侧聊天窗口。
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

/**
 * 注册“加载会话列表完成”的 IPC 回调。
 *
 * loadChatSession 发出 loadSessionData 后，
 * 主进程会查询本地 chat_session_user 表，
 * 再通过 loadSessionDataCallback 把会话列表回传到这里。
 */
const onLoadSessionData = () => {
    // 主进程加载完本地会话列表后，通过 loadSessionDataCallback 回传。
    window.ipcRenderer.on('loadSessionDataCallback', async (e, dataList) => {
        const hydratedList = await hydrateSessionList(dataList || []);
        sortChatSessionList(hydratedList);
        chatSessionList.value = hydratedList;
        openChatFromRoute();
    });
};

/**
 * 置顶或取消置顶一个会话。
 *
 * 做的事情：
 * 1. 先在前端切换 data.topType，让界面立即变化。
 * 2. 重新排序 chatSessionList。
 * 3. 通过 IPC 通知主进程更新本地数据库。
 */
const setTop = (data) => {
    // 先更新前端显示，再通知主进程写入本地数据库。
    data.topType = data.topType == 0 ? 1 : 0;
    sortChatSessionList(chatSessionList.value);
    window.ipcRenderer.send('topChatSession', { contactId: data.contactId, topType: data.topType });
};

/**
 * 删除一个会话。
 *
 * 这里的删除不是物理删除，而是软删除：
 * 主进程会把 chat_session_user.status 改成 0。
 *
 * 前端同时清空 currentChatSession，让右侧回到未选中状态。
 */
const delChatSession = (contactId) => {
    // 删除会话是软删除：本地数据库里把 status 改为 0。
    delChatSessionList(contactId);
    currentChatSession.value = {};
    window.ipcRenderer.send('delChatSession', contactId);
};

/**
 * 打开左侧会话右键菜单。
 *
 * 菜单功能：
 * - 置顶 / 取消置顶：调用 setTop。
 * - 删除聊天：弹确认框，确认后调用 delChatSession。
 */
const onContextmenu = (data, e) => {
    // 左侧会话右键菜单：置顶/取消置顶、删除聊天。
    e.preventDefault();
    ContextMenu.showContextMenu({
        x: e.x,
        y: e.y,
        items: [
            {
                label: data.topType == 0 ? '置顶' : '取消置顶',
                onClick: () => {
                    setTop(data);
                }
            },
            {
                label: '删除聊天',
                onClick: () => {
                    proxy.Confirm({
                        message: '确认删除吗？',
                        okfun: () => {
                            delChatSession(data.contactId);
                        }
                    });
                }
            }
        ]
    });
};

/**
 * 页面挂载时初始化聊天页。
 *
 * 必须先注册 IPC 监听，再主动加载会话列表。
 * 否则可能出现主进程已经返回数据，但页面还没开始监听的情况。
 */
onMounted(() => {
    // 页面进入时注册 IPC 监听，并主动加载左侧会话列表。
    onReceiveMessage();
    onLoadSessionData();
    onLoadChatMessage();
    loadChatSession();
    openChatFromRoute();
});

watch(
    () => [route.query.type, route.query.chatId],
    () => {
        openChatFromRoute();
    }
);

/**
 * 页面卸载时清理 IPC 监听。
 *
 * 如果不清理，反复进入聊天页会重复绑定监听，
 * 导致一条消息被处理多次。
 */
onUnmounted(() => {
    // 页面卸载时移除监听，避免重复进入页面后绑定多次事件。
    window.ipcRenderer.removeAllListeners('loadSessionDataCallback');
    window.ipcRenderer.removeAllListeners('receiveMessage');
    window.ipcRenderer.removeAllListeners('loadChatMessageCallback');
    clearInitialBottomLock();
    clearMessagePanelEnterTimer();
    clearPendingBottomSettleFrame();
    messageList.value.forEach((message) => {
        if (message.localPreviewUrl) {
            URL.revokeObjectURL(message.localPreviewUrl);
        }
    });
});



</script>

<style lang="scss" scoped>
:deep(.right-content) {
    padding-top: 0;
    padding-right: 0;
    background: #f5f5f5;
}

.chat-list-header {
    padding: 16px;
    font-size: 18px;
    font-weight: bold;
    color: #333;
    -webkit-app-region: drag;
    flex-shrink: 0;
}

.chat-list-body {
    flex: 1;
    overflow-y: auto;
}

.title-panel {
    height: 60px;
    padding: 0 58px 0 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    background: #f5f5f5;
    border-bottom: 1px solid #e7e7e7;
    color: #111;
}

.title {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: 16px;
    font-weight: 500;
}

.title-count {
    font-size: 14px;
    color: #7a7a7a;
    font-weight: 400;
}

.chat-panel {
    flex: 1;
    min-height: 0;
    display: flex;
    background: #f5f5f5;
}

.message-panel {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding: 20px 28px 16px;
    scroll-behavior: auto;
    overscroll-behavior: contain;
    overflow-anchor: none;
}

.message-panel-preparing {
    visibility: hidden;
    pointer-events: none;
}

.message-panel-content {
    flex: 0 0 auto;
    min-height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
}

.message-panel-entering .message-panel-content {
    animation: message-panel-enter 100ms cubic-bezier(0.2, 0, 0, 1) both;
    will-change: opacity;
}

@keyframes message-panel-enter {
    from {
        opacity: 0;
    }

    to {
        opacity: 1;
    }
}

.message-row {
    flex-shrink: 0;
    display: flex;
    margin-bottom: 14px;
    align-items: flex-start;
}

.message-bottom-anchor {
    flex-shrink: 0;
    height: 1px;
}

.message-row-self {
    justify-content: flex-end;
}

.message-avatar {
    flex-shrink: 0;
}

.message-body {
    max-width: min(68%, 560px);
    margin: 0 10px;
}

.message-body-self {
    text-align: right;
}

.message-nick {
    font-size: 12px;
    color: #999;
    margin-bottom: 3px;
    padding-left: 2px;
    line-height: 1.4;
}

.message-item {
    display: inline-block;
    padding: 9px 13px;
    border-radius: 4px;
    background: #ffffff;
    color: #333;
    line-height: 1.6;
    word-break: break-word;
    box-shadow: 0 1px 1px rgba(0, 0, 0, 0.04);
    text-align: left;
}

.message-item-self {
    background: #95ec69;
}

.chat-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: #f5f5f5;
}

.empty-tip {
    color: #aaa;
    font-size: 14px;
    line-height: 1.8;
    text-align: center;
}

.chat-empty-default {
    min-height: 0;
}

.wechat-empty-icon {
    font-size: 118px;
    color: #d8d8d8;
}

.top-search {
    padding: 10px;
    padding-left: 0;
}

:deep(.send-panel) {
    height: 180px;
    min-height: 180px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    padding: 10px 18px 10px;
    box-sizing: border-box;
    overflow: hidden;
    background: #fff;
    border-top: 1px solid #e7e7e7;
}

:deep(.toolbar) {
    display: flex;
    align-items: center;
    gap: 16px;
    height: 28px;
    flex-shrink: 0;
    color: #666;
}

:deep(.toolbar .toolbar-icon) {
    font-size: 20px;
    color: #666;
    cursor: pointer;
}

.title-more {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 4px;
    color: #666;
    cursor: pointer;

    &:hover {
        background: #e7e7e7;
        color: #333;
    }
}

:deep(.input-area) {
    flex: 1;
    min-height: 0;
    padding-top: 6px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

:deep(.input-area .el-textarea) {
    flex: 1;
    height: auto;
    min-height: 42px;
}

:deep(.input-area .el-textarea__inner) {
    height: 100%;
    min-height: 42px;
    padding: 0;
    border: none;
    border-radius: 0;
    box-shadow: none;
    background: transparent;
    font-size: 14px;
    line-height: 1.7;
    color: #333;
}

:deep(.send-btn-panel) {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    flex-shrink: 0;
    padding-top: 6px;
}

:deep(.send-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 92px;
    height: 30px;
    padding: 0 18px;
    color: #333;
    border: 1px solid #d9d9d9;
    background: #f5f5f5;
    cursor: pointer;
}

.message-item-image {
    padding: 0;
    background: transparent;
    box-shadow: none;
}

.message-item-file {
    padding: 0;
    background: transparent;
    box-shadow: none;
}

.message-image-frame {
    width: min(520px, 62vw);
    aspect-ratio: 16 / 10;
    min-height: 156px;
    max-height: 260px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-radius: 4px;
    background: transparent;
}

.message-image {
    display: block;
    max-width: 100%;
    max-height: 260px;
    border-radius: 4px;
    object-fit: contain;
}

.message-image-frame :deep(.image-panel) {
    width: 100%;
    height: 100%;
}

.message-image-frame :deep(.el-image) {
    max-width: 100%;
    max-height: 260px;
}

.file-message-card {
    width: 264px;
    min-height: 114px;
    display: flex;
    flex-direction: column;
    border-radius: 4px;
    background: #fff;
    box-shadow: 0 1px 1px rgba(0, 0, 0, 0.03);
    cursor: pointer;
    box-sizing: border-box;
    overflow: hidden;
    text-align: left;
    transition: background 0.12s ease;

    &:hover {
        background: #fbfbfb;
    }
}

.file-message-card-self {
    background: #fff;
}

.file-message-main {
    min-height: 80px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 12px 10px;
}

.file-message-info {
    min-width: 0;
    flex: 1;
    margin-right: 12px;
}

.file-message-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #111;
    font-size: 14px;
    line-height: 22px;
}

.file-message-meta {
    margin-top: 4px;
    color: #999;
    font-size: 12px;
    line-height: 16px;

    span {
        margin-left: 6px;
    }
}

.file-message-icon {
    position: relative;
    width: 40px;
    height: 48px;
    flex: 0 0 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    background: #d9dee8;
    color: #7688aa;
    font-size: 22px;
    font-weight: 700;
}

.file-message-icon::after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    width: 14px;
    height: 14px;
    border-radius: 0 4px 0 3px;
    background: linear-gradient(135deg, #eef2f8 0 50%, #c8cfdb 50% 100%);
}

.file-message-icon span {
    position: relative;
    z-index: 1;
}

.file-message-source {
    height: 34px;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 12px;
    border-top: 1px solid #ededed;
    color: #9a9a9a;
    font-size: 12px;
}

.file-message-source-icon {
    position: relative;
    width: 14px;
    height: 12px;
    border-radius: 7px;
    background: #1aad19;
    flex: 0 0 14px;
}

.file-message-source-icon::after {
    content: '';
    position: absolute;
    right: -3px;
    bottom: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #8bd85f;
    border: 1px solid #fff;
}

:deep(.file-preview-dialog) {
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 18px 56px rgba(0, 0, 0, 0.24);
    -webkit-app-region: no-drag;
}

:deep(.file-preview-dialog .el-dialog__header) {
    height: 44px;
    padding: 0;
    margin: 0;
}

:deep(.file-preview-dialog .el-dialog__headerbtn) {
    top: 12px;
    right: 18px;
    width: 24px;
    height: 24px;
    font-size: 18px;
}

:deep(.file-preview-dialog .el-dialog__body) {
    padding: 0;
}

.file-preview-panel {
    min-height: 455px;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 34px 48px 56px;
    background: #fff;
    color: #111;
    text-align: center;
}

.file-preview-icon {
    position: relative;
    width: 60px;
    height: 74px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    background: #d9dee8;
    color: #7688aa;
    font-size: 28px;
    font-weight: 700;
}

.file-preview-icon::after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    width: 20px;
    height: 20px;
    border-radius: 0 6px 0 4px;
    background: linear-gradient(135deg, #eef2f8 0 50%, #c8cfdb 50% 100%);
}

.file-preview-icon span {
    position: relative;
    z-index: 1;
}

.file-preview-name {
    max-width: 520px;
    margin-top: 28px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 18px;
    line-height: 28px;
    color: #111;
}

.file-preview-size {
    margin-top: 66px;
    font-size: 14px;
    line-height: 20px;
    color: #222;
}

.file-preview-action {
    width: 142px;
    height: 38px;
    margin-top: 40px;
    border: none;
    border-radius: 4px;
    background: #07c160;
    color: #fff;
    font-size: 16px;
    line-height: 38px;
    cursor: pointer;
}

.file-preview-action:hover {
    background: #06ad56;
}

.file-preview-action:disabled {
    background: #b8e8ca;
    cursor: not-allowed;
}

.file-preview-expire {
    margin-top: 12px;
    font-size: 13px;
    line-height: 18px;
    color: #8a8a8a;
}
</style>
