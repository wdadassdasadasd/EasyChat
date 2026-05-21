<template>
    <div>
        <AvatarBase :userId="userId" :width="width" :border-radius="borderRadius" :showDetail="false" v-if="userId=='Urobot'"></AvatarBase>
        <el-popover v-else trigger="click" placement="right-start" :width="280" :transition="none" :hide-after="0" ref="popoverRef" @show="getConatactInfo">
           
            <template #reference>
                <AvatarBase :userId="userId" :width="width" :border-radius="borderRadius" :showDetail="false"></AvatarBase>
            </template>
            <template #default>
                <div class="popover-user-panel">
                    <UserBaseInfo :userInfo="userInfo"></UserBaseInfo>
                    <div class="op-btn" v-if="userId!='userInfoStore.getInfo().userId'">   
                        <el-button v-if="userInfo.contactStatus===1" @click="sendMessage" type="primary">发送消息</el-button>
                        <el-button v-else="userInfo.contactStatus===0" @click="addContact" type="primary">加为好友</el-button>
                    </div>
                </div>
            </template>
            
        </el-popover>
    </div>

</template>

<script setup>
import { ref, computed, getCurrentInstance } from 'vue';
import AvatarBase from './AvatarBase.vue';
import UserBaseInfo from './UserBaseInfo.vue';
import {useUserInfoStore} from '@/stores/UserInfoStore';
const userInfoStore = useUserInfoStore();
const { proxy } = getCurrentInstance();
const props = defineProps({
    userId: {
        type: String,
        default: ''
    },
    width: {
        type: Number,
        default: 40
    },
    borderRadius: {
        type: Number,
        default: 0
    },
    groupId:{
        type:String,
        default:''
    }
 
})

const userInfo=ref({});
const getConatactInfo=async()=>{
   userInfo.value.userId=props.userId;
   if(userInfoStore.getInfo().userId==props.userId){
    userInfo.value=userInfoStore.getInfo();
   }
   else {
    let result=await proxy.Request({
        url:proxy.Api.getContactInfo,
        params:{
            contactId:props.userId
        }
    });
    if(!result){
        return;
    }
    userInfo.value=Object.assign({},result.data);
}
}
const sendMessage=()=>{

}
const addContact=()=>{

}

</script>


<style lang="scss" scoped>
.op-btn{
    text-align: center;
    border-top: 1px solid #eaeaea;
    padding-top: 10px;
}
</style>