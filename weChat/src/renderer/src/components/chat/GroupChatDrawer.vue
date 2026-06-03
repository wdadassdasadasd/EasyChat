<template>
    <aside v-if="visible" class="group-chat-drawer">
        <!-- 群聊详情抽屉：成员搜索、群资料编辑、置顶、清空记录和聊天记录搜索都从这里进入。 -->
        <div class="drawer-search">
            <el-input
                v-model="searchKey"
                size="small"
                placeholder="搜索群成员"
                clearable
            >
                <template #prefix>
                    <el-icon>
                        <Search />
                    </el-icon>
                </template>
            </el-input>
        </div>

        <div v-loading="loading" class="drawer-scroll">
            <div class="member-grid">
                <div
                    v-for="(member, index) in visibleMemberList"
                    :key="`${getMemberId(member)}_${index}`"
                    class="member-item"
                >
                    <AvatarBase :userId="getMemberId(member)" :width="42" :borderRadius="4" />
                    <div class="member-name">{{ getMemberName(member) }}</div>
                </div>
                <button v-if="canManageGroup" class="member-add" type="button" @click="openAddMemberDialog">
                    <span class="member-add-icon">
                        <el-icon>
                            <Plus />
                        </el-icon>
                    </span>
                    <div>添加</div>
                </button>
            </div>

            <div class="drawer-section group-profile">
                <div class="section-title">群聊名称</div>
                <button
                    :class="['section-value', 'group-name', canManageGroup ? 'editable-row' : '']"
                    type="button"
                    @click="openEditGroupDialog"
                >
                    <span>{{ displayGroupName }}</span>
                    <el-icon v-if="canManageGroup" class="edit-icon">
                        <EditPen />
                    </el-icon>
                </button>
            </div>

            <div class="drawer-section">
                <div class="section-title">群公告</div>
                <button
                    :class="['section-muted', 'notice-value', canManageGroup ? 'editable-row' : '']"
                    type="button"
                    @click="openEditGroupDialog"
                >
                    <span>{{ displayGroupNotice }}</span>
                    <el-icon v-if="canManageGroup" class="edit-icon">
                        <EditPen />
                    </el-icon>
                </button>
            </div>

            <div class="drawer-section">
                <div class="section-title">备注</div>
                <div class="section-muted">群聊的备注仅自己可见</div>
            </div>

            <div class="drawer-section">
                <div class="section-title">我在本群的昵称</div>
                <div class="section-muted">{{ myGroupNickName }}</div>
            </div>

            <div class="drawer-menu">
                <button class="menu-row" type="button" @click="openSearchDialog">
                    <span>查找聊天内容</span>
                    <el-icon>
                        <ArrowRight />
                    </el-icon>
                </button>
            </div>

            <div class="drawer-menu settings-menu">
                <div class="setting-row">
                    <span>置顶聊天</span>
                    <el-switch :model-value="isTopChat" @change="$emit('toggleTop', $event)" />
                </div>
                <div class="setting-row">
                    <span>显示群成员昵称</span>
                    <el-switch
                        :model-value="showGroupMemberNick"
                        @change="$emit('update:showGroupMemberNick', $event)"
                    />
                </div>
            </div>

            <div class="drawer-clear">
                <button type="button" @click="$emit('clearMessages')">清空聊天记录</button>
            </div>
        </div>
    </aside>

    <AppDialog
        :show="editDialogVisible"
        title="编辑群资料"
        width="420px"
        :buttons="editDialogButtons"
        @close="closeEditGroupDialog"
    >
        <el-form ref="editFormRef" :model="editForm" :rules="editRules" label-width="72px" @submit.prevent>
            <el-form-item label="群名称" prop="groupName">
                <el-input v-model.trim="editForm.groupName" maxlength="150" clearable />
            </el-form-item>
            <el-form-item label="群公告" prop="groupNotice">
                <el-input
                    v-model.trim="editForm.groupNotice"
                    maxlength="300"
                    show-word-limit
                    resize="none"
                    type="textarea"
                    :rows="5"
                />
            </el-form-item>
        </el-form>
    </AppDialog>

    <AppDialog
        :show="addMemberDialogVisible"
        title="添加群成员"
        width="430px"
        :buttons="addMemberDialogButtons"
        @close="closeAddMemberDialog"
    >
        <div v-loading="friendLoading" class="member-select-panel">
            <el-input
                v-model="friendSearchKey"
                size="small"
                placeholder="搜索好友"
                clearable
                class="friend-search"
            />
            <el-checkbox-group v-model="selectedContactIds" class="friend-list">
                <el-checkbox
                    v-for="friend in filteredFriendList"
                    :key="getContactId(friend)"
                    :label="getContactId(friend)"
                    class="friend-row"
                >
                    <AvatarBase :userId="getContactId(friend)" :width="32" :borderRadius="4" />
                    <span>{{ getContactName(friend) }}</span>
                </el-checkbox>
            </el-checkbox-group>
            <div v-if="!friendLoading && filteredFriendList.length === 0" class="empty-tip">
                暂无可添加好友
            </div>
        </div>
    </AppDialog>

    <ChatMessageSearchDialog
        v-model="searchDialogVisible"
        :currentChatSession="currentChatSession"
        @locateMessage="$emit('locateMessage', $event)"
    />
</template>

<script setup>
import { computed, getCurrentInstance, nextTick, ref, toRef, watch } from 'vue';
import { ArrowRight, EditPen, Plus, Search } from '@element-plus/icons-vue';
import AvatarBase from '@/components/AvatarBase.vue';
import ChatMessageSearchDialog from '@/components/chat/ChatMessageSearchDialog.vue';
import { useContactStateStore } from '@/stores/ContactStateStore';
import { useUserInfoStore } from '@/stores/UserInfoStore';
import { useGroupChatDrawer } from '@/views/chat/composables/useGroupChatDrawer';

const GROUP_MEMBER_OP_ADD = 1;

const props = defineProps({
    currentChatSession: {
        type: Object,
        default: () => ({})
    },
    modelValue: {
        type: Boolean,
        default: false
    },
    showGroupMemberNick: {
        type: Boolean,
        default: true
    }
});

const emit = defineEmits([
    'clearMessages',
    'groupUpdated',
    'locateMessage',
    'toggleTop',
    'update:modelValue',
    'update:showGroupMemberNick'
]);
const { proxy } = getCurrentInstance();
const userInfoStore = useUserInfoStore();
const contactStateStore = useContactStateStore();

const {
    filteredMemberList,
    getMemberId,
    getMemberName,
    groupInfo,
    loading,
    memberList,
    searchKey,
    syncVisible,
    visible
} = useGroupChatDrawer({
    currentChatSession: toRef(props, 'currentChatSession'),
    proxy
});

const editFormRef = ref();
const editDialogVisible = ref(false);
const editSaving = ref(false);
const editForm = ref({
    groupName: '',
    groupNotice: ''
});
const editRules = {
    groupName: [{ required: true, message: '请输入群名称', trigger: 'blur' }]
};

const addMemberDialogVisible = ref(false);
const friendLoading = ref(false);
const friendSearchKey = ref('');
const friendList = ref([]);
const selectedContactIds = ref([]);
const addingMembers = ref(false);

const searchDialogVisible = ref(false);

const visibleMemberList = computed(() => {
    return filteredMemberList.value.slice(0, 6);
});

const currentUserId = computed(() => {
    return String(userInfoStore.getInfo()?.userId || '');
});

const groupOwnerId = computed(() => {
    return String(
        groupInfo.value.groupOwnerId ||
        groupInfo.value.group_owner_id ||
        props.currentChatSession.groupOwnerId ||
        props.currentChatSession.group_owner_id ||
        ''
    );
});

const canManageGroup = computed(() => {
    return groupOwnerId.value && groupOwnerId.value === currentUserId.value;
});

const displayGroupName = computed(() => {
    return groupInfo.value.groupName || props.currentChatSession.contactName || '群聊';
});

const displayGroupNotice = computed(() => {
    return groupInfo.value.groupNotice || '群主未设置';
});

const myGroupNickName = computed(() => {
    const userId = currentUserId.value;
    const selfMember = filteredMemberList.value.find((member) => getMemberId(member) === userId);
    return selfMember ? getMemberName(selfMember) : '未设置';
});

const isTopChat = computed(() => {
    return Number(props.currentChatSession.topType) === 1;
});

const editDialogButtons = computed(() => [
    {
        text: editSaving.value ? '保存中...' : '确定',
        type: 'primary',
        click: submitGroupProfile
    }
]);

const addMemberDialogButtons = computed(() => [
    {
        text: addingMembers.value ? '添加中...' : '确定',
        type: 'primary',
        click: submitAddMembers
    }
]);

const memberIdSet = computed(() => {
    return new Set(memberList.value.map((member) => getMemberId(member)));
});

const getContactId = (contact = {}) => {
    return String(contact.contactId || contact.userId || contact.id || '');
};

const getContactName = (contact = {}) => {
    return String(contact.contactName || contact.nickName || contact.userName || contact.name || getContactId(contact));
};

const availableFriendList = computed(() => {
    return friendList.value.filter((friend) => {
        const contactId = getContactId(friend);
        return contactId && !memberIdSet.value.has(contactId);
    });
});

const filteredFriendList = computed(() => {
    const keyword = friendSearchKey.value.trim().toLowerCase();
    if (!keyword) {
        return availableFriendList.value;
    }
    return availableFriendList.value.filter((friend) => {
        return getContactId(friend).toLowerCase().includes(keyword) || getContactName(friend).toLowerCase().includes(keyword);
    });
});

const emitGroupUpdated = () => {
    emit('groupUpdated', {
        contactId: props.currentChatSession.contactId,
        contactName: groupInfo.value.groupName || props.currentChatSession.contactName,
        groupName: groupInfo.value.groupName || props.currentChatSession.groupName,
        memberCount: groupInfo.value.memberCount ?? props.currentChatSession.memberCount
    });
};

const reloadGroupInfo = async () => {
    await syncVisible(true);
    emitGroupUpdated();
};

const openEditGroupDialog = () => {
    if (!canManageGroup.value) {
        return;
    }
    editForm.value = {
        groupName: displayGroupName.value,
        groupNotice: groupInfo.value.groupNotice || ''
    };
    editDialogVisible.value = true;
    nextTick(() => {
        editFormRef.value?.clearValidate();
    });
};

const closeEditGroupDialog = () => {
    if (editSaving.value) {
        return;
    }
    editDialogVisible.value = false;
};

const submitGroupProfile = async () => {
    if (editSaving.value) {
        return;
    }
    const valid = await editFormRef.value?.validate().catch(() => false);
    if (!valid) {
        return;
    }

    editSaving.value = true;
    try {
        const result = await proxy.Request({
            url: proxy.Api.saveGroup,
            params: {
                groupId: props.currentChatSession.contactId,
                groupName: editForm.value.groupName,
                groupNotice: editForm.value.groupNotice,
                joinType: groupInfo.value.joinType ?? 1
            }
        });
        if (!result) {
            return;
        }
        proxy.Message.success('群资料已更新');
        editDialogVisible.value = false;
        contactStateStore.setContactReload('MY_GROUP');
        await reloadGroupInfo();
    } finally {
        editSaving.value = false;
    }
};

const openAddMemberDialog = async () => {
    if (!canManageGroup.value) {
        return;
    }
    addMemberDialogVisible.value = true;
    friendSearchKey.value = '';
    selectedContactIds.value = [];
    await loadFriendList();
};

const closeAddMemberDialog = () => {
    if (addingMembers.value) {
        return;
    }
    addMemberDialogVisible.value = false;
};

const loadFriendList = async () => {
    friendLoading.value = true;
    try {
        const result = await proxy.Request({
            url: proxy.Api.loadContact,
            params: {
                contactType: 'USER'
            },
            showLoading: false
        });
        friendList.value = result?.data || [];
    } finally {
        friendLoading.value = false;
    }
};

const submitAddMembers = async () => {
    if (addingMembers.value) {
        return;
    }
    if (selectedContactIds.value.length === 0) {
        proxy.Message.warning('请选择要添加的好友');
        return;
    }

    addingMembers.value = true;
    try {
        const result = await proxy.Request({
            url: proxy.Api.addOrRemoveGroupUser,
            params: {
                groupId: props.currentChatSession.contactId,
                selectContacts: selectedContactIds.value.join(','),
                opType: GROUP_MEMBER_OP_ADD
            }
        });
        if (!result) {
            return;
        }
        proxy.Message.success('群成员已添加');
        addMemberDialogVisible.value = false;
        contactStateStore.setContactReload('GROUP');
        await reloadGroupInfo();
    } finally {
        addingMembers.value = false;
    }
};

const openSearchDialog = () => {
    // 聊天记录搜索依赖本地 sessionId；没有落库会话时不能发起 IPC 查询。
    if (!props.currentChatSession.sessionId) {
        proxy.Message.warning('暂无可搜索的聊天记录');
        return;
    }
    searchDialogVisible.value = true;
};

watch(
    () => props.modelValue,
    async (nextVisible) => {
        await syncVisible(nextVisible);
        if (visible.value !== nextVisible) {
            emit('update:modelValue', visible.value);
        }
    },
    { immediate: true }
);

watch(
    () => props.currentChatSession.contactId,
    async () => {
        // 会话切换时关闭所有群详情子弹窗，防止编辑/搜索状态泄露到新群。
        editDialogVisible.value = false;
        addMemberDialogVisible.value = false;
        searchDialogVisible.value = false;
        if (props.modelValue) {
            await syncVisible(props.currentChatSession.contactType == 1);
            emit('update:modelValue', visible.value);
        }
    }
);
</script>

<style lang="scss" scoped>
.group-chat-drawer {
    width: 300px;
    height: 100%;
    flex: 0 0 300px;
    display: flex;
    flex-direction: column;
    background: #fff;
    border-left: 1px solid #e4e4e4;
    box-sizing: border-box;
    -webkit-app-region: no-drag;
}

.drawer-search {
    padding: 12px 20px 10px;
    flex-shrink: 0;

    :deep(.el-input__wrapper) {
        border-radius: 4px;
        background: #f3f3f3;
        box-shadow: none;
    }
}

.drawer-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 20px 18px;
}

.member-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px 10px;
    padding: 12px 0 16px;
    border-bottom: 1px solid #ededed;
}

.member-item,
.member-add {
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    color: #777;
    font-size: 12px;
}

.member-name {
    width: 54px;
    overflow: hidden;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.member-add {
    border: none;
    background: transparent;
    cursor: pointer;

    .member-add-icon {
        width: 42px;
        height: 42px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px dashed #b8b8b8;
        border-radius: 4px;
        box-sizing: border-box;
        color: #9b9b9b;
        font-size: 20px;
    }
}

.drawer-section {
    padding: 16px 0 0;
}

.group-profile {
    padding-top: 18px;
}

.section-title {
    color: #111;
    font-size: 14px;
    line-height: 20px;
}

.section-value,
.section-muted {
    margin-top: 8px;
    color: #8b8b8b;
    font-size: 14px;
    line-height: 20px;
    word-break: break-word;
}

button.section-value,
button.section-muted {
    width: 100%;
    padding: 0;
    border: none;
    background: transparent;
    text-align: left;
}

.group-name,
.notice-value {
    display: flex;
    align-items: center;
    gap: 6px;

    span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
}

.notice-value span {
    white-space: normal;
}

.editable-row {
    cursor: pointer;
}

.edit-icon {
    flex-shrink: 0;
    color: #a0a0a0;
    font-size: 14px;
}

.drawer-menu {
    margin-top: 20px;
    padding: 12px 0;
    border-top: 1px solid #ededed;
    border-bottom: 1px solid #ededed;
}

.settings-menu {
    margin-top: 0;
    border-top: none;
}

.menu-row,
.setting-row {
    width: 100%;
    min-height: 36px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border: none;
    background: transparent;
    color: #111;
    font-size: 14px;
    line-height: 20px;
    text-align: left;
}

.menu-row {
    padding: 0;
    cursor: pointer;

    .el-icon {
        color: #bbb;
        font-size: 16px;
    }
}

.setting-row {
    padding: 8px 0;
}

.drawer-clear {
    padding: 20px 0 0;
    text-align: center;

    button {
        border: none;
        background: transparent;
        color: #ff3b30;
        font-size: 14px;
        cursor: pointer;
    }
}

.member-select-panel,
.message-search-panel {
    min-height: 180px;
}

.friend-search {
    margin-bottom: 10px;
}

.friend-list,
.search-result-list {
    max-height: 320px;
    overflow-y: auto;
}

.friend-row {
    width: 100%;
    height: 44px;
    margin-right: 0;
    display: flex;
    align-items: center;

    :deep(.el-checkbox__label) {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 10px;
        color: #333;
    }
}

.search-result-list {
    margin-top: 12px;
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
