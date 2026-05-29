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
                        <span>{{ currentChatSessionTitle }}</span>
                        <span class="title-count" v-if="currentChatSession.contactType == 1">{{ currentChatSession.memberCount }}</span>
                    </div>
                    <div class="title-actions no-drag">
                        <WinOp
                            mode="inline"
                            :showSetTop="true"
                            :showMin="true"
                            :showMax="true"
                            :closeType="1"
                        />
                        <div class="chat-header-actions">
                            <div
                                class="title-more"
                                @click="showChatDetail"
                            >
                                <el-icon>
                                    <MoreFilled />
                                </el-icon>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="chat-workspace">
                    <div class="chat-content">
                        <ChatMessageList
                            :messageList="messageList"
                            :currentChatSession="currentChatSession"
                            :currentUserId="currentUserId"
                            :messageLoadingMore="messageLoadingMore"
                            :messagePanelPhase="messagePanelPhase"
                            :showGroupMemberNick="showGroupMemberNick"
                            :welcomeText="welcomeText"
                            @imageLoaded="settleScrollToBottom"
                            @loadMore="loadMoreChatMessage"
                            @openFilePreview="openFilePreviewDialog"
                            @openVideoPreview="openVideoPreviewDialog"
                            @userScroll="clearInitialBottomLock"
                        />

                        <MessageSend
                            :currentChatSession="currentChatSession"
                            @sendMessage="onSendChatMessage"
                            @sendImageMessage="onSendImageMessage"
                            @sendFileMessage="onSendFileMessage"
                            @sendVideoMessage="onSendVideoMessage"
                        />
                    </div>
                    <GroupChatDrawer
                        v-model="groupDetailVisible"
                        :currentChatSession="currentChatSession"
                        v-model:showGroupMemberNick="showGroupMemberNick"
                        @toggleTop="handleToggleTop"
                        @clearMessages="handleClearMessages"
                        @groupUpdated="handleGroupUpdated"
                    />
                    <UserChatDrawer
                        v-model="userDetailVisible"
                        :currentChatSession="currentChatSession"
                        @toggleTop="handleToggleTop"
                        @clearMessages="handleClearMessages"
                    />
                </div>
            </template>

            <template v-else>
                <div class="title-panel title-panel-empty drag">
                    <div class="title"></div>
                    <div class="title-actions no-drag">
                        <WinOp
                            mode="inline"
                            :showSetTop="true"
                            :showMin="true"
                            :showMax="true"
                            :closeType="1"
                        />
                    </div>
                </div>

                <div class="chat-empty chat-empty-default">
                    <el-icon class="wechat-empty-icon">
                        <ChatDotRound />
                    </el-icon>
                </div>
            </template>

            <FilePreviewDialog
                v-model="showFilePreviewDialog"
                :message="selectedFileMessage"
                :receiving="isReceivingFile"
                @closed="closeFilePreviewDialog"
                @receive="receiveSelectedFileMessage"
            />
            <VideoPreviewDialog
                v-model="showVideoPreviewDialog"
                :message="selectedVideoMessage"
                :loading="isLoadingVideo"
                :progress="videoDownloadProgress"
                :errorText="videoPlaybackError"
                :videoUrl="videoPreviewUrl"
                @closed="closeVideoPreviewDialog"
                @download="downloadSelectedVideoMessage"
                @openExternal="openSelectedVideoExternal"
                @videoError="markVideoPlaybackError"
            />
        </template>
    </Layout>
</template>

<script setup>
import { computed, getCurrentInstance, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import ChatMessageList from '@/components/chat/ChatMessageList.vue';
import ChatSession from '@/components/chat/ChatSession.vue';
import FilePreviewDialog from '@/components/chat/FilePreviewDialog.vue';
import GroupChatDrawer from '@/components/chat/GroupChatDrawer.vue';
import MessageSend from '@/components/chat/MessageSend.vue';
import UserChatDrawer from '@/components/chat/UserChatDrawer.vue';
import VideoPreviewDialog from '@/components/chat/VideoPreviewDialog.vue';
import { useUserInfoStore } from '@/stores/UserInfoStore';
import { useChatMessages } from './composables/useChatMessages';
import { useChatSessions } from './composables/useChatSessions';
import { useFileTransfer } from './composables/useFileTransfer';

const { proxy } = getCurrentInstance();
const route = useRoute();
const userInfoStore = useUserInfoStore();
const searchKey = ref();
const groupDetailVisible = ref(false);
const userDetailVisible = ref(false);
const showGroupMemberNick = ref(true);

const search = () => {};

const {
    applySessionPatches,
    chatSessionList,
    currentChatSession,
    currentChatSessionTitle,
    hasCurrentChat,
    loadChatSession,
    markSessionRead,
    onContextmenu,
    openChatFromRoute,
    registerSessionListener,
    removeSessionListener,
    setChatSessionTop,
    setSessionSelector,
    updateCurrentChatSession,
    welcomeText
} = useChatSessions({ proxy, route });

const {
    chatSessionClickHandler,
    cleanupChatMessages,
    clearCurrentMessages,
    clearInitialBottomLock,
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
} = useChatMessages({
    applySessionPatches,
    currentChatSession,
    loadChatSession,
    markSessionRead,
    proxy
});

const {
    closeFilePreviewDialog,
    closeVideoPreviewDialog,
    downloadSelectedVideoMessage,
    isReceivingFile,
    isLoadingVideo,
    markVideoPlaybackError,
    openFilePreviewDialog,
    openSelectedVideoExternal,
    openVideoPreviewDialog,
    receiveSelectedFileMessage,
    selectedFileMessage,
    selectedVideoMessage,
    showFilePreviewDialog,
    showVideoPreviewDialog,
    videoDownloadProgress,
    videoPlaybackError,
    videoPreviewUrl
} = useFileTransfer({ proxy });

const currentUserId = computed(() => {
    return userInfoStore.getInfo()?.userId;
});

const totalUnreadCount = computed(() => {
    return chatSessionList.value.reduce((total, item) => {
        return total + Number(item.noReadCount || 0);
    }, 0);
});

const showChatDetail = () => {
    if (currentChatSession.value.contactType == 1) {
        userDetailVisible.value = false;
        groupDetailVisible.value = !groupDetailVisible.value;
        return;
    }

    if (currentChatSession.value.contactType == 0) {
        groupDetailVisible.value = false;
        userDetailVisible.value = !userDetailVisible.value;
        return;
    }

    groupDetailVisible.value = false;
    userDetailVisible.value = false;
};

const handleToggleTop = (isTop) => {
    if (!currentChatSession.value.contactId) {
        return;
    }
    setChatSessionTop(currentChatSession.value.contactId, isTop ? 1 : 0);
};

const handleGroupUpdated = (sessionInfo) => {
    updateCurrentChatSession(sessionInfo);
};

const handleClearMessages = () => {
    if (!currentChatSession.value.sessionId) {
        clearCurrentMessages();
        return;
    }

    proxy.Confirm({
        message: '确认清空聊天记录吗？',
        okfun: () => {
            const sessionId = currentChatSession.value.sessionId;
            window.ipcRenderer.once('clearChatMessageCallback', (e, data) => {
                if (data?.success && data.sessionId === sessionId) {
                    clearCurrentMessages();
                    proxy.Message.success('聊天记录已清空');
                    return;
                }
                if (data?.sessionId === sessionId) {
                    proxy.Message.error('清空聊天记录失败');
                }
            });
            window.ipcRenderer.send('clearChatMessage', { sessionId });
        }
    });
};

setSessionSelector(chatSessionClickHandler);

onMounted(() => {
    registerMessageListeners();
    registerSessionListener();
    loadChatSession();
    openChatFromRoute();
});

watch(
    () => [route.query.type, route.query.chatId],
    () => {
        openChatFromRoute();
    }
);

watch(
    () => `${currentChatSession.value.contactId || ''}_${currentChatSession.value.contactType || ''}`,
    () => {
        groupDetailVisible.value = false;
        userDetailVisible.value = false;
    }
);

watch(
    totalUnreadCount,
    (count) => {
        window.dispatchEvent(new CustomEvent('chatUnreadCountChange', {
            detail: {
                count
            }
        }));
    },
    {
        immediate: true
    }
);

onUnmounted(() => {
    groupDetailVisible.value = false;
    userDetailVisible.value = false;
    removeSessionListener();
    closeVideoPreviewDialog();
    cleanupChatMessages();
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
    position: relative;
    height: 74px;
    padding: 26px 160px 0 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
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
    flex: 1;
    font-size: 16px;
    font-weight: 500;

    span:first-child {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
}

.title-count {
    font-size: 14px;
    color: #7a7a7a;
    font-weight: 400;
}

.title-actions {
    height: 100%;
    position: absolute;
    top: 0;
    right: 8px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    -webkit-app-region: no-drag;
}

.chat-header-actions {
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    align-self: flex-end;
}

.title-more {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 34px;
    border-radius: 4px;
    color: #666;
    cursor: pointer;
    font-size: 18px;
    -webkit-app-region: no-drag;

    &:hover {
        background: #e7e7e7;
        color: #333;
    }
}

.chat-workspace {
    flex: 1;
    min-height: 0;
    display: flex;
    background: #f5f5f5;
}

.chat-content {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
}

.chat-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: #f5f5f5;
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
</style>
