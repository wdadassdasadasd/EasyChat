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
                        <span>{{ currentChatSession.contactName }}</span>
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
                    <div class="message-panel" id="message-panel" v-if="messageList.length > 0">
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
                                <div :class="['message-item', isSelfMessage(data) ? 'message-item-self' : '', isImageMessage(data) ? 'message-item-image' : '']">
                                    <template v-if="isImageMessage(data)">
                                        <el-image
                                            v-if="data.localPreviewUrl"
                                            :src="data.localPreviewUrl"
                                            class="message-image"
                                            fit="scale-down"
                                            :preview-src-list="[data.localPreviewUrl]"
                                            :preview-teleported="true"
                                            :hide-on-click-modal="true"
                                        />
                                        <ShowLocalImage
                                            v-else
                                            :fileId="data.messageId"
                                            :width="220"
                                            partType="chat"
                                            :fileType="data.fileType"
                                            :preview="true"
                                        />
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
                    </div>
                    <div class="chat-empty" v-else>
                        <div class="empty-tip">{{ welcomeText }}</div>
                    </div>
                </div>
                <!-- MessageSend 只负责输入；真正调发送接口的是父组件Chat.vue 。 -->
                <MessageSend
                    :currentChatSession="currentChatSession"
                    @sendMessage="onSendChatMessage"
                    @sendImageMessage="onSendImageMessage"
                />
            </template>
            <!-- 没有选中会话时，右侧显示默认空状态。 --> 
            <div class="chat-empty chat-empty-default" v-else>
                <el-icon class="wechat-empty-icon">
                    <ChatDotRound />
                </el-icon>
            </div>
            <WinOp :showSetTop="true" :showMin="true" :showMax="true" :closeType="1" showSetTop="1" />
        </template>
    </Layout>
</template>

<script setup>
import { computed, getCurrentInstance, onMounted, onUnmounted, ref ,nextTick, toRaw} from 'vue';
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
const hasCurrentChat = computed(() => Object.keys(currentChatSession.value).length > 0);

// 判断消息是否由当前登录用户发送，用于控制左右对齐和气泡颜色。
const isSelfMessage = (message) => {
    return message?.sendUserId == userInfoStore.getInfo()?.userId;
};

// 没有消息时显示的欢迎文案，群聊和单聊文案不同。
const welcomeText = computed(() => {
    if (currentChatSession.value.contactType == 1) {
        return `${currentChatSession.value.contactName} 已创建好，快来开始群聊吧`;
    }
    return `欢迎和 ${currentChatSession.value.contactName || ''} 开始聊天`;
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
    // 点击左侧会话后，切换当前会话，并重置消息分页状态。
    currentChatSession.value = Object.assign({}, item);
    messageList.value = [];

    messageCountInfo.totalPage = 1;
    messageCountInfo.pageNo = 0;
    messageCountInfo.maxMessageId = 0;
    messageCountInfo.noData = false;
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
    if (messageCountInfo.noData) {
        return;
    }
    messageCountInfo.pageNo++;
    // 通过 IPC 让主进程从本地 chat_message 表中按 sessionId 分页查询消息。
    window.ipcRenderer.send('loadChatMessage', {
        sessionId: currentChatSession.value.sessionId,
        pageNo: messageCountInfo.pageNo,
        maxMessageId: messageCountInfo.maxMessageId
    });
};

/**
 * 滚动消息列表到底部。
 *
 * 为什么需要 nextTick：
 * messageList.push 后，DOM 不是立刻更新的。
 * 需要等 Vue 完成渲染后，再读取 scrollHeight 才准确。
 */
const scrollMessageToBottom = async () => {
    // 等 Vue 把新消息渲染到 DOM 后，再把滚动条拉到底部。
    await nextTick();

    const messagePanel = document.getElementById('message-panel');
    if (messagePanel) {
        messagePanel.scrollTop = messagePanel.scrollHeight;
    }
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
            messageList.value.push(message);
            scrollMessageToBottom();
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

    messageList.value.push(message);
    scrollMessageToBottom();

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
    window.ipcRenderer.on('loadChatMessageCallback', (e, { dataList, pageTotal, pageNo }) => {
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
        if(message.sessionId==currentChatSession.value.sessionId){
            // 如果推送消息属于当前打开的会话，直接追加到右侧聊天窗口。
            const exists = messageList.value.some((item) => item.messageId == message.messageId);
            if (!exists) {
                messageList.value.push(message);
                scrollMessageToBottom();
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
    window.ipcRenderer.on('loadSessionDataCallback', (e, dataList) => {
        sortChatSessionList(dataList);
        chatSessionList.value = dataList || [];
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
});

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
    messageList.value.forEach((message) => {
    if (message.localPreviewUrl) {
        URL.revokeObjectURL(message.localPreviewUrl);
    }
});
});



</script>

<style lang="scss" scoped>
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
    padding: 0 72px 0 24px;
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
    overflow-y: auto;
    padding: 20px 24px;
}

.message-row {
    display: flex;
    margin-bottom: 16px;
    align-items: flex-start;
}

.message-row-self {
    justify-content: flex-end;
}

.message-avatar {
    flex-shrink: 0;
}

.message-body {
    max-width: min(72%, 560px);
    margin: 0 10px;
}

.message-body-self {
    text-align: right;
}

.message-nick {
    font-size: 12px;
    color: #999;
    margin-bottom: 4px;
    padding-left: 2px;
    line-height: 1.4;
}

.message-item {
    display: inline-block;
    padding: 10px 14px;
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
    height: 220px;
    min-height: 220px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    padding: 10px 18px 14px;
    box-sizing: border-box;
    overflow: hidden;
    background: #fff;
    border-top: 1px solid #e7e7e7;
}

:deep(.toolbar) {
    display: flex;
    align-items: center;
    gap: 16px;
    height: 30px;
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
    padding-top: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

:deep(.input-area .el-textarea) {
    flex: 1;
    height: auto;
    min-height: 44px;
}

:deep(.input-area .el-textarea__inner) {
    height: 100%;
    min-height: 44px;
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
    padding-top: 8px;
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
    padding: 4px;
    background: transparent;
    box-shadow: none;
}

.message-image {
    display: block;
    max-width: 220px;
    max-height: 260px;
    border-radius: 4px;
    object-fit: contain;
}
</style>
