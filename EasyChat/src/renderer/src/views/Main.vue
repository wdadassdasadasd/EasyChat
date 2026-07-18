<template>
    <div class="main">
        <div class="left-sider">
            <div class="nav-avatar">
                <Avatar
                    v-if="loginUserId"
                    :userId="loginUserId"
                    :width="36"
                    :borderRadius="4"
                />
    </div>
            <div class="menu-list">
                <div v-for="item in menuList.filter(i=>i.position=='top')" :key="item.name"
                     :class="['tab-item',item.path==currentMenu.path?'active':'']"
                     @click="changeMenu(item)">
                    <el-icon>
                        <component :is="item.icon"></component>
                    </el-icon>
                    <span class="menu-badge" v-if="item.name=='chat'&&chatUnreadCount>0">{{ chatUnreadText }}</span>
                </div>
            </div>
            <div class="menu-list menu-bottom">
                <div v-for="item in menuList.filter(i=>i.position=='bottom')" :key="item.name"
                     :class="['tab-item',item.path==currentMenu.path?'active':'']"
                     @click="changeMenu(item)">
                    <el-icon>
                        <component :is="item.icon"></component>
                    </el-icon>
                </div>
            </div>
        </div>
        <div class="right-container">
            <router-view v-slot="{Component}">
                <keep-alive include="Chat,Contact,Setting">
                    <component :is="Component" ref="componentRef"></component>
                </keep-alive>
            </router-view>
        </div>
    </div>
</template>

<script setup>
import{ref,getCurrentInstance, onMounted,onUnmounted,computed,markRaw, nextTick} from 'vue';
import { useRouter } from 'vue-router';
import { ChatDotRound, MoreFilled, User } from '@element-plus/icons-vue';
import {useUserInfoStore} from '@/stores/UserInfoStore';
import { scheduleWhenIdle } from '@/utils/idleTask';
import { markPerformance } from '@/utils/performanceMetrics';
const userInfoStore = useUserInfoStore();
const router=useRouter();
const {proxy}=getCurrentInstance();

const loginUserId=computed(()=>{
    return userInfoStore.getInfo()?.userId||'';
});

const getLoginInfo = async () => {
    let result = await proxy.Request({
        url: proxy.Api.getUserInfo
    })

    if (!result) {
        return
    }

    userInfoStore.setUserInfo(result.data)
}

//菜单列表
const menuList=ref([{
    name:"chat",
    icon:markRaw(ChatDotRound),
    path:"/chat",
    countKey:'chatKey',
    position:"top"
  },
  {
    name:"contact",
    icon:markRaw(User),
    path:"/contact",
    countKey:'contactApplyKey',
    position:"top"
  },
  {
    name:"setting",
    icon:markRaw(MoreFilled),
    path:"/setting",
    position:"bottom"
}])

const currentMenu=ref(menuList.value[0]);
const chatUnreadCount=ref(0);
const chatUnreadText=computed(()=>chatUnreadCount.value>99?'99+':String(chatUnreadCount.value));
const changeMenu=(item)=>{
    markPerformance(`menu-${item.name}-start`);
    currentMenu.value=item;
    router.push(item.path).then(()=>nextTick(()=>markPerformance(`menu-${item.name}-ready`)));
}
const handleChatUnreadCountChange=(event)=>{
    // Chat.vue 根据会话列表聚合未读数后派发该事件，侧边栏只负责展示红点。
    chatUnreadCount.value=Number(event.detail?.count||0);
}

onMounted(()=>{
    scheduleWhenIdle(()=>getLoginInfo());
    window.addEventListener('chatUnreadCountChange',handleChatUnreadCountChange);
})

onUnmounted(()=>{
    window.removeEventListener('chatUnreadCountChange',handleChatUnreadCountChange);
})
</script>

<style lang="scss" scoped>
.main {
    display: flex;
    height: 100vh;
    overflow: hidden;
}

.left-sider {
    width: 56px;
    background: #2d2d2d;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: 58px;
    flex-shrink: 0;
    -webkit-app-region: drag;

    & > div:first-child {
        width: 36px;
        height: 36px;
        border-radius: 4px;
        background: #555;
        margin-bottom: 20px;
        cursor: pointer;
        -webkit-app-region: no-drag;
        overflow: hidden;
    }
}

.menu-list {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    gap: 4px;
    -webkit-app-region: no-drag;
}

.menu-bottom {
    margin-top: auto;
    margin-bottom: 16px;
}

.tab-item {
    position: relative;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    cursor: pointer;
    color: #adadad;
    font-size: 22px;
    transition: color 0.15s, background 0.15s;

    &:hover {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.08);
    }

    &.active {
        color: #ffffff;
    }
}

.menu-badge {
    position: absolute;
    top: 2px;
    right: 0;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: #fa5151;
    color: #fff;
    font-size: 10px;
    line-height: 16px;
    text-align: center;
    box-sizing: border-box;
}

.right-container {


    flex: 1;
    overflow: hidden;
    display: flex;
}

.left-sider {
    width: 56px;
    background: #2d2d2d;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: 58px;
    flex-shrink: 0;
    -webkit-app-region: drag;
}

.nav-avatar {
    width: 36px;
    height: 36px;
    border-radius: 4px;
    margin-bottom: 20px;
    cursor: pointer;
    overflow: hidden;
    background: #555;
    -webkit-app-region: no-drag;
}
</style>
