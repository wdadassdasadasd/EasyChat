<template>
    <ContactPanel class="user-detail-panel">
        <div class="user-card">
            <div class="profile-header">
                <AvatarBase :userId="userInfo.userId || userInfo.contactId" :width="64" :borderRadius="4"></AvatarBase>
                <div class="profile-main">
                    <div class="nick-name">
                        {{ userInfo.nickName || userInfo.contactName || '好友' }}
                        <el-icon v-if="userInfo.sex==0" class="sex-icon woman-icon">
                            <Female />
                        </el-icon>
                        <el-icon v-if="userInfo.sex==1" class="sex-icon man-icon">
                            <Male />
                        </el-icon>
                    </div>
                    <div class="user-id">账号：{{ userInfo.userId || userInfo.contactId }}</div>
                </div>

                <el-dropdown placement="bottom-end" trigger="click">
                    <span class="more-action">
                        <el-icon class="more-icon">
                            <MoreFilled />
                        </el-icon>
                    </span>
                    <template #dropdown>
                        <el-dropdown-menu>
                            <el-dropdown-item @click="addContact2BlackList">加入黑名单</el-dropdown-item>
                            <el-dropdown-item @click="delContact">删除联系人</el-dropdown-item>
                        </el-dropdown-menu>
                    </template>
                </el-dropdown>
            </div>

            <div class="info-section">
                <div class="info-row">
                    <div class="info-label">昵称</div>
                    <div class="info-value">{{ userInfo.nickName || userInfo.contactName || '-' }}</div>
                </div>
                <div class="info-row" v-if="userInfo.areaName">
                    <div class="info-label">地区</div>
                    <div class="info-value">{{ proxy.Utils.getAreaInfo(userInfo.areaName) }}</div>
                </div>
                <div class="info-row signature-row">
                    <div class="info-label">个性签名</div>
                    <div class="info-value">{{ userInfo.personalSignature || '暂无个性签名' }}</div>
                </div>
            </div>

            <div class="action-area">
                <el-button type="primary" class="send-button" @click="sendMessage">
                    <el-icon class="send-message-icon">
                        <ChatDotRound />
                    </el-icon>
                    发消息
                </el-button>
            </div>
        </div>
    </ContactPanel>
</template>

<script setup>
import { ref, getCurrentInstance, watch } from 'vue';
import ContactPanel from '../../components/ContactPanel.vue';
import AvatarBase from '../../components/AvatarBase.vue';
import { useContactStateStore } from '../../stores/ContactStateStore';
import { useRoute ,useRouter} from 'vue-router';
const route = useRoute();
const router=useRouter();
const { proxy } = getCurrentInstance();
const userInfo = ref({})
const contactStateStore = useContactStateStore();
const loadUserDetail=async(contactId)=>{
   let result=await proxy.Request({
    url:proxy.Api.getContactUserInfo,
    params: {
      contactId:contactId
    }
   })
   if(!result){
    return;
   }
   userInfo.value=result.data;
  
}

//加入黑名单
const addContact2BlackList=()=>{
    proxy.Confirm({
        message: '确定要将此联系人加入黑名单吗？',
        okfun: async () => {
            let result = await proxy.Request({
                url:proxy.Api.addContact2BlackList,
                params:{
                    contactId:userInfo.value.userId || userInfo.value.contactId
                }
            })
            if(!result){
                proxy.Message.error("操作失败");
                return;
            }
            delContactData();
        }  })
}

//删除联系人
const delContact=()=>{
    proxy.Confirm({
        message: '确定要删除此联系人吗？',
        okfun: async () => {
            let result = await proxy.Request({
                url:proxy.Api.delContact,
                params:{
                    contactId:userInfo.value.userId || userInfo.value.contactId
                }
            })
            if(!result){
                proxy.Message.error("操作失败");
                return;
            }
            delContactData();
        }  })
}

const delContactData=()=>{
    const contactId = userInfo.value.userId || userInfo.value.contactId;
    contactStateStore.setContactReload('REMOVE_USER');
    contactStateStore.setDelContactId(contactId);
}

const sendMessage=()=>{
    router.push({
        path:'/chat',
        query:{
            type:'USER',
            chatId:userInfo.value.userId || userInfo.value.contactId
        }
    })
}

watch(()=>route.query.contactId, (newVal) => {
    if (newVal) {
        loadUserDetail(newVal);
    }
}, { immediate: true,deep: true });
</script>

<style lang="scss" scoped>
.user-detail-panel {
    :deep(.content-inner) {
        width: min(420px, calc(100% - 48px));
        padding-top: 54px;
    }
}

.user-card {
    color: #1f2329;
}

.profile-header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 0 28px;
    border-bottom: 1px solid #dedede;
}

.profile-main {
    flex: 1;
    min-width: 0;
}

.nick-name {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 22px;
    line-height: 30px;
    font-weight: 500;
    color: #111;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.user-id {
    margin-top: 8px;
    font-size: 13px;
    line-height: 18px;
    color: #8c8c8c;
}

.sex-icon {
    flex-shrink: 0;
    font-size: 16px;

    &.woman-icon {
        color: #f4719e;
    }

    &.man-icon {
        color: #5097f5;
    }
}

.more-action {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    cursor: pointer;

    &:hover {
        background: #e2e2e2;
    }
}

.more-icon {
    font-size: 20px;
    color: #666;
}

.info-section {
    padding: 24px 0 6px;
    border-bottom: 1px solid #dedede;
}

.info-row {
    display: flex;
    gap: 24px;
    min-height: 32px;
    line-height: 22px;
    font-size: 14px;
}

.info-label {
    width: 72px;
    flex-shrink: 0;
    color: #8c8c8c;
}

.info-value {
    flex: 1;
    color: #333;
    word-break: break-word;
}

.signature-row {
    align-items: flex-start;
}

.action-area {
    padding-top: 34px;
    text-align: center;
}

.send-button {
    min-width: 150px;
    height: 36px;
    border: none;
    border-radius: 4px;
    background: #07c160;

    &:hover,
    &:focus {
        background: #06ad56;
    }
}

.send-message-icon {
    font-size: 16px;
}
</style>
