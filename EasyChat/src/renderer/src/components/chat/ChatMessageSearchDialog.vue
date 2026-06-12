<template>
    <AppDialog
        :show="modelValue"
        title="查找聊天内容"
        width="460px"
        :buttons="searchDialogButtons"
        @close="closeSearchDialog"
    >
        <div class="message-search-panel">
            <el-input
                v-model.trim="messageSearchKey"
                placeholder="搜索当前会话的聊天记录"
                clearable
                @keyup.enter="searchChatMessages"
            />
            <div v-loading="messageSearching" class="search-result-list">
                <button
                    v-for="message in messageSearchResults"
                    :key="message.messageId"
                    class="search-result-row"
                    type="button"
                    @click="$emit('locateMessage', message)"
                >
                    <div class="search-result-main">
                        <span class="search-sender">{{ getMessageSender(message) }}</span>
                        <span class="search-time">{{ formatMessageTime(message.sendTime) }}</span>
                    </div>
                    <div class="search-content">{{ getMessageContent(message) }}</div>
                </button>
                <div v-if="!messageSearching && searchExecuted && messageSearchResults.length === 0" class="empty-tip">
                    没有找到相关聊天记录
                </div>
            </div>
        </div>
    </AppDialog>
</template>

<script setup>
import { computed, getCurrentInstance, onMounted, onUnmounted, ref, watch } from 'vue';
import { useUserInfoStore } from '@/stores/UserInfoStore';

const props = defineProps({
    currentChatSession: {
        type: Object,
        default: () => ({})
    },
    modelValue: {
        type: Boolean,
        default: false
    }
});

const emit = defineEmits(['locateMessage', 'update:modelValue']);
const { proxy } = getCurrentInstance();
const userInfoStore = useUserInfoStore();
const messageSearchKey = ref('');
const messageSearchResults = ref([]);
const messageSearching = ref(false);
const searchExecuted = ref(false);
let messageSearchSeq = 0;
let unsubscribeSearchCallback = null;

const currentUserId = computed(() => {
    return String(userInfoStore.getInfo()?.userId || '');
});

const searchDialogButtons = computed(() => [
    {
        text: '搜索',
        type: 'primary',
        click: searchChatMessages
    }
]);

const closeSearchDialog = () => {
    emit('update:modelValue', false);
};

const searchChatMessages = () => {
    const keyword = messageSearchKey.value.trim();
    if (!keyword) {
        proxy.Message.warning('请输入搜索内容');
        return;
    }
    const sessionId = props.currentChatSession.sessionId;
    if (!sessionId) {
        proxy.Message.warning('暂无可搜索的聊天记录');
        return;
    }

    const currentSeq = ++messageSearchSeq;
    messageSearching.value = true;
    searchExecuted.value = true;
    window.api.sendSearchChatMessage({
        sessionId,
        keyword,
        searchSeq: currentSeq
    });
};

const handleSearchChatMessageCallback = (data) => {
    if (!props.modelValue || data?.searchSeq !== messageSearchSeq || data?.sessionId !== props.currentChatSession.sessionId) {
        return;
    }
    if (data?.success === false) {
        messageSearchResults.value = [];
        messageSearching.value = false;
        proxy.Message.error('搜索聊天记录失败，请稍后重试。');
        return;
    }
    messageSearchResults.value = data?.dataList || [];
    messageSearching.value = false;
};

const getMessageSender = (message = {}) => {
    if (String(message.sendUserId || '') === currentUserId.value) {
        return '我';
    }
    return message.sendUserNickName || message.sendUserId || '未知成员';
};

const getMessageContent = (message = {}) => {
    return message.fileName || message.messageContent || '[暂不支持预览的消息]';
};

const formatMessageTime = (sendTime) => {
    if (!sendTime) {
        return '';
    }
    const date = new Date(Number(sendTime));
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${month}-${day} ${hour}:${minute}`;
};

watch(
    () => props.modelValue,
    (visible) => {
        if (!visible) {
            messageSearching.value = false;
            return;
        }
        messageSearchKey.value = '';
        messageSearchResults.value = [];
        messageSearching.value = false;
        searchExecuted.value = false;
    }
);

watch(
    () => props.currentChatSession.sessionId,
    () => {
        messageSearchResults.value = [];
        messageSearching.value = false;
        searchExecuted.value = false;
    }
);

onMounted(() => {
    unsubscribeSearchCallback = window.api.onSearchChatMessageCallback(handleSearchChatMessageCallback);
});

onUnmounted(() => {
    unsubscribeSearchCallback?.();
    unsubscribeSearchCallback = null;
});
</script>

<style lang="scss" scoped>
.message-search-panel {
    min-height: 180px;
}

.search-result-list {
    max-height: 320px;
    margin-top: 12px;
    overflow-y: auto;
}

.search-result-row {
    width: 100%;
    padding: 10px 0;
    border: none;
    border-bottom: 1px solid #ededed;
    background: transparent;
    text-align: left;
    cursor: pointer;
}

.search-result-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 12px;
    color: #888;
}

.search-sender {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.search-time {
    flex-shrink: 0;
}

.search-content {
    margin-top: 4px;
    color: #333;
    font-size: 14px;
    line-height: 20px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.empty-tip {
    padding: 24px 0;
    color: #999;
    text-align: center;
    font-size: 13px;
}
</style>
