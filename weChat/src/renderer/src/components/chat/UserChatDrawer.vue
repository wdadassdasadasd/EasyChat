<template>
    <aside v-if="visible" class="user-chat-drawer">
        <div v-loading="loading" class="drawer-scroll">
            <div class="user-grid">
                <div class="user-item">
                    <AvatarBase :userId="displayUserId" :width="46" :borderRadius="4" />
                    <div class="user-name">{{ displayUserName }}</div>
                </div>
                <button class="user-add" type="button" @click="showComingSoon">
                    <span></span>
                    <div>添加</div>
                </button>
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
import { useUserChatDrawer } from '@/views/chat/composables/useUserChatDrawer';

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

const emit = defineEmits(['clearMessages', 'toggleTop', 'update:modelValue']);
const { proxy } = getCurrentInstance();

const {
    loading,
    syncVisible,
    userInfo,
    visible
} = useUserChatDrawer({
    currentChatSession: toRef(props, 'currentChatSession'),
    proxy
});

const displayUserId = computed(() => {
    return userInfo.value.userId || userInfo.value.contactId || props.currentChatSession.contactId || '';
});

const displayUserName = computed(() => {
    return userInfo.value.nickName || userInfo.value.contactName || props.currentChatSession.contactName || displayUserId.value || '好友';
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
            await syncVisible(props.currentChatSession.contactType != 1);
            emit('update:modelValue', visible.value);
        }
    }
);
</script>

<style lang="scss" scoped>
.user-chat-drawer {
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

.drawer-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 16px 20px 18px;
}

.user-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px 10px;
    padding: 0 0 20px;
    border-bottom: 1px solid #ededed;
}

.user-item,
.user-add {
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    color: #777;
    font-size: 12px;
}

.user-name {
    width: 54px;
    overflow: hidden;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.user-add {
    border: none;
    background: transparent;
    cursor: pointer;

    span {
        position: relative;
        width: 46px;
        height: 46px;
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

.drawer-menu {
    padding: 12px 0;
    border-bottom: 1px solid #ededed;
}

.settings-menu {
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
