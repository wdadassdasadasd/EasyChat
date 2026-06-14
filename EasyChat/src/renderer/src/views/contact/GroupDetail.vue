<template>
    <ContactPanel class="group-detail-panel">
        <div class="group-card">
            <div class="profile-header">
                <Avatar :userId="groupInfo.groupId" :width="64" :borderRadius="4"></Avatar>
                <div class="profile-main">
                    <div class="group-name">{{ groupInfo.groupName || '群聊' }}</div>
                    <div class="group-id">群ID：{{ groupInfo.groupId }}</div>
                </div>

                <el-dropdown placement="bottom-end" trigger="click">
                    <span class="more-action">
                        <el-icon class="more-icon">
                            <MoreFilled />
                        </el-icon>
                    </span>

                    <template #dropdown>
                        <el-dropdown-menu v-if="groupInfo.groupOwnerId==userInfoStore.getInfo().userId">
                            <el-dropdown-item @click="editGroupInfo">修改群信息</el-dropdown-item>
                            <el-dropdown-item @click="dissolutionGroup">解散该群</el-dropdown-item>
                        </el-dropdown-menu>
                        <el-dropdown-menu v-else>
                            <el-dropdown-item @click="leaveGroup">退出该群</el-dropdown-item>
                        </el-dropdown-menu>
                    </template>
                </el-dropdown>
            </div>

            <div class="info-section">
                <div class="info-row">
                    <div class="info-label">群成员</div>
                    <div class="info-value">{{ groupInfo.memberCount || 0 }}</div>
                </div>
                <div class="info-row">
                    <div class="info-label">加入权限</div>
                    <div class="info-value">{{ groupInfo.joinType==0?'直接加入':'管理员验证后加入' }}</div>
                </div>
                <div class="info-row notice-row">
                    <div class="info-label">群公告</div>
                    <div class="info-value">{{ groupInfo.groupNotice||'暂无公告' }}</div>
                </div>
            </div>

            <div class="action-area">
                <el-button type="primary" class="send-button" @click="sendMessage">
                    发送群消息
                </el-button>
            </div>
        </div>
    </ContactPanel>
    <GroupEditDialag ref="groupEditDialogRef" @reloadGroupInfo="getGroupInfo"></GroupEditDialag>
</template>

<script setup>
import { ref, getCurrentInstance ,watch} from 'vue';
import { MoreFilled } from '@element-plus/icons-vue';
import { useContactStateStore } from '../../stores/ContactStateStore';
import { useRoute ,useRouter} from 'vue-router';
import { useUserInfoStore } from '../../stores/UserInfoStore';
import GroupEditDialag from './GroupEditDialag.vue';

const contactStateStore = useContactStateStore();
const userInfoStore=useUserInfoStore();
const {proxy} = getCurrentInstance();
const route = useRoute();
const router = useRouter();
const groupInfo = ref({});
const groupId=ref()
const groupEditDialogRef=ref();

const getGroupInfo=async() =>{
    let result=await proxy.Request({
        url:proxy.Api.getGroupInfo,
        params:{
            groupId:groupId.value
        }
    })
    if(!result){
        return;
    }
    groupInfo.value=result.data;
}

const editGroupInfo=()=>{
    groupEditDialogRef.value.show(groupInfo.value);
    }

    //解散群
const dissolutionGroup=()=>{
    proxy.Confirm({
        message:'确定要解散该群吗？',
        okfun:async()=>{
            let result=await proxy.Request({
                url:proxy.Api.dissolutionGroup,
                params:{
                    groupId:groupId.value
                }
              
            })
            if(!result){
                return;
            }
            if(result){
                proxy.Message.success('解散成功');
               
            }
            contactStateStore.setContactReload('DISSOLUTION_GROUP');
        }
    })
}
//退出群
const leaveGroup=()=>{
    proxy.Confirm({
        message:'确定要退出该群吗？',
        okfun:async()=>{
            let result=await proxy.Request({
                url:proxy.Api.leaveGroup,
                params:{
                    groupId:groupId.value
                }
              
            })
            if(!result){
                return;
            }
            if(result){
                proxy.Message.success('退出成功');
               
            }
            contactStateStore.setContactReload('LEAVE_GROUP');
        }
    })
}

const sendMessage=()=>{
    router.push({
        path:'/chat',
        query:{
            type:'GROUP',
            chatId:groupInfo.value.groupId,
            contactName:groupInfo.value.groupName,
            memberCount:groupInfo.value.memberCount
        }
    })
}
//监听路由变化
watch(()=>route.query.contactId,(newVal)=>{
    if(newVal){
        groupId.value=newVal;
        //加载群信息
        getGroupInfo();
    }
},{
    immediate:true
})
 







</script>

<style lang="scss" scoped>
.group-detail-panel {
    :deep(.content-inner) {
        width: min(420px, calc(100% - 48px));
        padding-top: 54px;
    }
}

.group-card {
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

.group-name {
    font-size: 22px;
    line-height: 30px;
    font-weight: 500;
    color: #111;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.group-id {
    margin-top: 8px;
    font-size: 13px;
    line-height: 18px;
    color: #8c8c8c;
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

.notice-row {
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
</style>
