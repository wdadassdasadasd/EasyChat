<template>
    <Layout>
        <template #left-content>
            <!-- 左侧会话列表：只负责展示本地会话状态，数据由 useChatSessions 通过主进程 IPC 同步。 -->
            <div class="chat-list-header">
                <span>聊天</span>
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
                <!-- 聊天头部：当前会话标题、窗口操作和会话详情抽屉入口集中在这里。 -->
                <div class="title-panel drag">
                    <div class="title">
                        <span>{{ currentChatSessionTitle }}</span>
                        <span class="title-count" v-if="currentChatSession.contactType == 1">{{ currentChatSession.memberCount }}</span>
                        <span class="ws-status" v-if="wsStatusText">{{ wsStatusText }}</span>
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

                <!-- 聊天工作区：消息列表、发送框、群/单聊详情抽屉共享 currentChatSession。 -->
                <div class="chat-workspace">
                    <div class="chat-content">
                        <ChatMessageList
                            ref="messageListRef"
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
                            @cancelUploadMessage="cancelUploadMessage"
                            @toggleUploadPause="toggleUploadPause"
                            @retryMessage="retryFailedMessage"
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
                        @locateMessage="locateChatMessage"
                    />
                    <UserChatDrawer
                        v-model="userDetailVisible"
                        :currentChatSession="currentChatSession"
                        @toggleTop="handleToggleTop"
                        @clearMessages="handleClearMessages"
                        @locateMessage="locateChatMessage"
                    />
                </div>
            </template>

            <template v-else>
                <!-- 没有选中会话时仍保留窗口操作区，避免主窗口控制入口丢失。 -->
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

            <!-- 文件/视频预览弹窗独立挂在右侧容器下，避免随消息列表滚动和复用。 -->
            <FilePreviewDialog
                v-model="showFilePreviewDialog"
                :message="selectedFileMessage"
                :receiving="isReceivingFile"
                :downloadState="selectedFileDownloadState"
                @closed="closeFilePreviewDialog"
                @receive="receiveSelectedFileMessage"
                @cancel="cancelSelectedFileDownload"
                @openFile="openDownloadedFile(selectedFileMessage)"
                @showInFolder="showDownloadedFileInFolder(selectedFileMessage)"
            />
            <VideoPreviewDialog
                v-model="showVideoPreviewDialog"
                :message="selectedVideoMessage"
                :loading="isLoadingVideo"
                :progress="videoDownloadProgress"
                :downloadState="selectedVideoDownloadState"
                :errorText="videoPlaybackError"
                :videoUrl="videoPreviewUrl"
                @closed="closeVideoPreviewDialog"
                @download="downloadSelectedVideoMessage"
                @cancel="cancelSelectedVideoDownload"
                @openFile="openDownloadedFile(selectedVideoMessage)"
                @showInFolder="showDownloadedFileInFolder(selectedVideoMessage)"
                @openExternal="openSelectedVideoExternal"
                @videoError="markVideoPlaybackError"
            />
        </template>
    </Layout>
</template>

<script setup>
import { computed, getCurrentInstance, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ChatDotRound, MoreFilled } from '@element-plus/icons-vue';
import ChatMessageList from '@/components/chat/ChatMessageList.vue';
import ChatSession from '@/components/chat/ChatSession.vue';
import FilePreviewDialog from '@/components/chat/FilePreviewDialog.vue';
import GroupChatDrawer from '@/components/chat/GroupChatDrawer.vue';
import MessageSend from '@/components/chat/MessageSend.vue';
import UserChatDrawer from '@/components/chat/UserChatDrawer.vue';
import VideoPreviewDialog from '@/components/chat/VideoPreviewDialog.vue';
import { useUserInfoStore } from '@/stores/UserInfoStore';
import { useChatPageController } from './composables/useChatPageController';

const { proxy } = getCurrentInstance();
const route = useRoute();
const userInfoStore = useUserInfoStore();
const showGroupMemberNick = ref(true);
const messageListRef = ref(null);

const currentUserId = computed(() => {
    return userInfoStore.getInfo()?.userId;
});

const {
    chatSessionList,
    currentChatSession,
    currentChatSessionTitle,
    hasCurrentChat,
    chatSessionClickHandler,
    onContextmenu,
    openChatFromRoute,
    welcomeText,
    groupDetailVisible,
    userDetailVisible,
    wsStatusText,
    totalUnreadCount,
    mount,
    unmount,
    showChatDetail,
    handleToggleTop,
    handleGroupUpdated,
    handleClearMessages,
    clearInitialBottomLock,
    locateChatMessage,
    loadMoreChatMessage,
    messageList,
    messageLoadingMore,
    messagePanelPhase,
    cancelUploadMessage,
    toggleUploadPause,
    onSendChatMessage,
    onSendFileMessage,
    onSendImageMessage,
    onSendVideoMessage,
    retryFailedMessage,
    settleScrollToBottom,
    cancelSelectedFileDownload,
    cancelSelectedVideoDownload,
    closeFilePreviewDialog,
    closeVideoPreviewDialog,
    downloadSelectedVideoMessage,
    isReceivingFile,
    isLoadingVideo,
    markVideoPlaybackError,
    openDownloadedFile,
    openFilePreviewDialog,
    openSelectedVideoExternal,
    openVideoPreviewDialog,
    receiveSelectedFileMessage,
    selectedFileDownloadState,
    selectedFileMessage,
    selectedVideoDownloadState,
    selectedVideoMessage,
    showDownloadedFileInFolder,
    showFilePreviewDialog,
    showVideoPreviewDialog,
    videoDownloadProgress,
    videoPlaybackError,
    videoPreviewUrl
} = useChatPageController({ currentUserId, messageListRef, proxy, route });


onMounted(() => {
    mount();
});

//处理其它页面跳转聊天
watch(
    () => [route.query.type, route.query.chatId],
    () => {
        // 联系人页“发消息”会改路由 query，这里把路由意图转换成当前聊天会话。
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
        // Main.vue 监听该全局事件，用于侧边栏聊天红点；真实未读数仍以会话列表状态为准。
        // 用 nextTick 推迟 dispatchEvent，避免高频消息推送时 O(n) reduce + 同步 DOM 事件阻塞渲染帧。
        nextTick(() => {
            window.dispatchEvent(new CustomEvent('chatUnreadCountChange', {
                detail: {
                    count
                }
            }));
        });
    },
    {
        immediate: true
    }
);

onUnmounted(() => {
    unmount();
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

.ws-status {
    flex: 0 0 auto;
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #d97706;
    font-size: 12px;
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
