<template>
    <aside v-if="visible" class="group-chat-drawer">
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
                <button class="member-add" type="button" @click="showComingSoon">
                    <span></span>
                    <div>添加</div>
                </button>
            </div>

            <div class="drawer-section group-profile">
                <div class="section-title">群聊名称</div>
                <div class="section-value group-name">
                    <span>{{ displayGroupName }}</span>
                    <el-icon class="edit-icon">
                        <EditPen />
                    </el-icon>
                </div>
            </div>

            <div class="drawer-section">
                <div class="section-title">群公告</div>
                <div class="section-muted">{{ displayGroupNotice }}</div>
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
                <button class="menu-row" type="button" @click="showComingSoon">
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
</template>

<script setup>
import { computed, getCurrentInstance, toRef, watch } from 'vue';
import AvatarBase from '@/components/AvatarBase.vue';
import { useUserInfoStore } from '@/stores/userInfoStore';
import { useGroupChatDrawer } from '@/views/chat/composables/useGroupChatDrawer';

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

const emit = defineEmits(['clearMessages', 'toggleTop', 'update:modelValue', 'update:showGroupMemberNick']);
const { proxy } = getCurrentInstance();
const userInfoStore = useUserInfoStore();

const {
    filteredMemberList,
    getMemberId,
    getMemberName,
    groupInfo,
    loading,
    searchKey,
    syncVisible,
    visible
} = useGroupChatDrawer({
    currentChatSession: toRef(props, 'currentChatSession'),
    proxy
});

const visibleMemberList = computed(() => {
    return filteredMemberList.value.slice(0, 6);
});

const displayGroupName = computed(() => {
    return groupInfo.value.groupName || props.currentChatSession.contactName || '群聊';
});

const displayGroupNotice = computed(() => {
    return groupInfo.value.groupNotice || '群主未设置';
});

const myGroupNickName = computed(() => {
    const userId = userInfoStore.getInfo()?.userId;
    const selfMember = filteredMemberList.value.find((member) => getMemberId(member) === userId);
    return selfMember ? getMemberName(selfMember) : '未设置';
});

const isTopChat = computed(() => {
    return Number(props.currentChatSession.topType) === 1;
});

const showComingSoon = () => {
    proxy.Message.warning('功能暂未开放');
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

    span {
        position: relative;
        width: 42px;
        height: 42px;
        border: 1px dashed #b8b8b8;
        border-radius: 4px;
        box-sizing: border-box;
    }

    span::before,
    span::after {
        content: '';
        position: absolute;
        left: 50%;
        top: 50%;
        width: 18px;
        height: 1px;
        background: #9b9b9b;
        transform: translate(-50%, -50%);
    }

    span::after {
        transform: translate(-50%, -50%) rotate(90deg);
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

.group-name {
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
</style>
