<template>
    <Layout>
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
        <template #right-content>
            <template v-if="hasCurrentChat">
                <div class="title-panel drag">
                    <div class="title">
                        <span>{{ currentChatSession.contactName }}</span>
                        <span class="title-count" v-if="currentChatSession.contactType == 1">{{ currentChatSession.memberCount }}</span>
                    </div>
                    <div
                        v-if="currentChatSession.contactType == 1"
                        class="iconfont icon-more no-drag"
                        @click="shwGroupDetail"
                    >
                    </div>
                </div>
                <div class="chat-panel">
                    <div class="message-panel" id="message-panel" v-if="messageList.length > 0">
                        <div class="message-item" v-for="(data, index) in messageList" :id="'message' + data.messageId">{{ data.messageContent }}</div>
                    </div>
                    <div class="chat-empty" v-else>
                        <div class="empty-tip">{{ welcomeText }}</div>
                    </div>
                </div>
                <MessageSend :currentChatSession="currentChatSession"></MessageSend>
            </template>
            <div class="chat-empty chat-empty-default" v-else>
                <span class="iconfont icon-chat wechat-empty-icon"></span>
            </div>
            <WinOp :showSetTop="true" :showMin="true" :showMax="true" :closeType="1" showSetTop="1" />
        </template>
    </Layout>
</template>

<script setup>
import { computed, getCurrentInstance, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUserInfoStore } from '../../stores/userInfoStore';
import ChatSession from './ChatSession.vue';
import ContextMenu from '@imengyu/vue3-context-menu';
import MessageSend from './MessageSend.vue';

const { proxy } = getCurrentInstance();
const userInfoStore = useUserInfoStore();
const route = useRoute();
const router = useRouter();
const searchKey = ref();
const chatSessionList = ref([]);

const search = () => {
};

const loadChatSession = () => {
    window.ipcRenderer.send('loadSessionData');
};

const sortChatSessionList = (dataList) => {
    dataList.sort((a, b) => {
        const topTypeResult = b.topType - a.topType;
        if (topTypeResult == 0) {
            return b.lastReceiveTime - a.lastReceiveTime;
        }
        return topTypeResult;
    });
};

const delChatSessionList = (contactId) => {
    chatSessionList.value = chatSessionList.value.filter((item) => {
        return item.contactId != contactId;
    });
};

const currentChatSession = ref({});
const messageCountInfo = {
    totalPage: 0,
    pageNo: 0,
    maxMessageId: 0,
    noData: false
};

const messageList = ref([]);
const hasCurrentChat = computed(() => Object.keys(currentChatSession.value).length > 0);
const welcomeText = computed(() => {
    if (currentChatSession.value.contactType == 1) {
        return `${currentChatSession.value.contactName} 已创建好，快来开始群聊吧`;
    }
    return `欢迎和 ${currentChatSession.value.contactName || ''} 开始聊天`;
});

const chatSessionClickHandler = (item) => {
    currentChatSession.value = Object.assign({}, item);
    messageList.value = [];

    messageCountInfo.totalPage = 1;
    messageCountInfo.pageNo = 0;
    messageCountInfo.maxMessageId = 0;
    messageCountInfo.noData = false;
    loadChatMessage();
};

const loadChatMessage = () => {
    if (messageCountInfo.noData) {
        return;
    }
    messageCountInfo.pageNo++;
    window.ipcRenderer.send('loadChatMessage', {
        sessionId: currentChatSession.value.sessionId,
        pageNo: messageCountInfo.pageNo,
        maxMessageId: messageCountInfo.maxMessageId
    });
};

const onLoadChatMessage = () => {
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

const onReceiveMessage = () => {
    window.ipcRenderer.on('receiveMessage', (e, message) => {
        console.log('收到消息', message);
        if (message.messageType == 0) {
            loadChatSession();
        }
    });
};

const onLoadSessionData = () => {
    window.ipcRenderer.on('loadSessionDataCallback', (e, dataList) => {
        sortChatSessionList(dataList);
        chatSessionList.value = dataList || [];
    });
};

const setTop = (data) => {
    data.topType = data.topType == 0 ? 1 : 0;
    sortChatSessionList(chatSessionList.value);
    window.ipcRenderer.send('topChatSession', { contactId: data.contactId, topType: data.topType });
};

const delChatSession = (contactId) => {
    delChatSessionList(contactId);
    currentChatSession.value = {};
    window.ipcRenderer.send('delChatSession', contactId);
};

const onContextmenu = (data, e) => {
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

onMounted(() => {
    onReceiveMessage();
    onLoadSessionData();
    onLoadChatMessage();
    loadChatSession();
});

onUnmounted(() => {
    window.ipcRenderer.removeAllListeners('loadSessionDataCallback');
    window.ipcRenderer.removeAllListeners('receiveMessage');
    window.ipcRenderer.removeAllListeners('loadChatMessageCallback');
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

.message-item {
    width: fit-content;
    max-width: min(72%, 560px);
    margin-bottom: 14px;
    padding: 10px 14px;
    border-radius: 4px;
    background: #ffffff;
    color: #333;
    line-height: 1.6;
    word-break: break-word;
    box-shadow: 0 1px 1px rgba(0, 0, 0, 0.04);
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
    min-height: 190px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    padding: 10px 18px 14px;
    background: #fff;
    border-top: 1px solid #e7e7e7;
}

:deep(.toolbar) {
    display: flex;
    align-items: center;
    gap: 16px;
    height: 30px;
    color: #666;
}

:deep(.toolbar .iconfont) {
    font-size: 20px;
    color: #666;
    cursor: pointer;
}

:deep(.input-area) {
    flex: 1;
    min-height: 0;
    padding-top: 8px;
}

:deep(.input-area .el-textarea) {
    height: 100%;
}

:deep(.input-area .el-textarea__inner) {
    height: 100%;
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
</style>
