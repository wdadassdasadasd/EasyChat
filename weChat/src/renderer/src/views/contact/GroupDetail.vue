<template>
    <ContactPanel>
        <div class="group-info-item">
            <div class="group-title">群封面</div>
            <div class="group-value">
                <Avatar :userId="groupInfo.groupId"></Avatar>
            </div>
        <el-dropdown placement="bottom-end" trigger="click">
            <span class="el-dropdowm-link">
                <div class="iconfont icon-more"></div>
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

        <div class="group-info-item">
            <div class="group-title">群ID:</div>
            <div class="group-value">{{ groupInfo.groupId }}</div>
        </div>
        <div class="group-info-item">
            <div class="group-title">群名称:</div>
            <div class="group-value">{{ groupInfo.groupName }}</div>
        </div>
        <div class="group-info-item">
            <div class="group-title">群成员:</div>
            <div class="group-value">{{ groupInfo.memberCount }}</div>
        </div>
        <div class="group-info-item">
            <div class="group-title">加入权限:</div>
            <div class="group-value">{{ groupInfo.joinType==0?'直接加入':'管理员验证后加入' }}</div>
        </div>
        <div class="group-info-item notice">
            <div class="group-title">群公告:</div>
            <div class="group-value">{{ groupInfo.groupNotice||'暂无公告' }}</div>
        </div>
        <div class="group-info-item">
            <div class="group-title"></div>
            <div class="group-value">
                <el-button type="primary" @click="sendMessage">
                    发送群消息
                </el-button>
            </div>
        </div>
    </ContactPanel>
    <GroupEditDialag ref="groupEditDialogRef" @reloadGroupInfo="getGroupInfo"></GroupEditDialag>
</template>

<script setup>
import { ref, computed, getCurrentInstance ,watch} from 'vue';
import { useContactStateStore } from '../../stores/ContactStateStore';
import { useRoute ,useRouter} from 'vue-router';
import { useUserInfoStore } from '../../stores/userInfoStore';
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
    let result=await proxy.request({
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
        okfunc:async()=>{
            let result=await proxy.request({
                url:proxy.Api.dissolutionGroup,
                params:{
                    groupId:groupId.value
                }
              
            })
            if(!result){
                return;
            }
            if(result){
                proxy.MessageSuccess('解散成功');
               
            }
            contactStateStore.setContactReload('DISSOLUTION_GROUP');
        }
    })
}
//退出群
const leaveGroup=()=>{
    proxy.Confirm({
        message:'确定要退出该群吗？',
        okfunc:async()=>{
            let result=await proxy.request({
                url:proxy.Api.leaveGroup,
                params:{
                    groupId:groupId.value
                }
              
            })
            if(!result){
                return;
            }
            if(result){
                proxy.MessageSuccess('退出成功');
               
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
            chatId:groupInfo.value.groupId
        }
    })
}
//监听路由变化
watch(()=>route.query.contactId,(newVal,oldVal)=>{
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
</style>
