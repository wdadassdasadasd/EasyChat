<template>
    <div>
        <AvatarBase :userId="userId" :width="width" :border-radius="borderRadius" :showDetails="false" v-if="userId=='Urobot'"></AvatarBase>
        <el-popover v-else trigger="click" placement="right-start" :width="280" :transition="none" :hide-after="0" ref="popoverRef" @show="getConatactInfo">

            <template #reference>
                <AvatarBase :userId="userId" :width="width" :border-radius="borderRadius" :showDetails="false"></AvatarBase>
            </template>
            <template #default>
                <div class="popover-user-panel">
                    <UserBaseInfo :userInfo="userInfo"></UserBaseInfo>
                    <div class="op-btn" v-if="!isSelf">
                        <el-button v-if="userInfo.contactStatus===1" @click="sendMessage" type="primary">发送消息</el-button>
                        <el-button v-else @click="addContact" type="primary">加为好友</el-button>
                    </div>
                </div>
            </template>

        </el-popover>
    </div>

</template>

<script setup>
import { ref, computed, getCurrentInstance } from 'vue';
import { useRouter } from 'vue-router';
import AvatarBase from './AvatarBase.vue';
import UserBaseInfo from './UserBaseInfo.vue';
import {useUserInfoStore} from '@/stores/UserInfoStore';
const userInfoStore = useUserInfoStore();
const { proxy } = getCurrentInstance();
const router = useRouter();
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

const isSelf = computed(() => userInfoStore.getInfo()?.userId === props.userId);

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
const sendMessage = () => {
    router.push({
        path: '/chat',
        query: {
            type: 'USER',
            chatId: userInfo.value.userId || userInfo.value.contactId
        }
    })
}
const addContact = async () => {
    const result = await proxy.Request({
        url: proxy.Api.applyAdd,
        params: {
            contactId: props.userId,
            contactType: 0,
            applyInfo: '你好，请求添加好友'
        }
    })
    if (!result) {
        proxy.Message.error('添加好友失败')
        return
    }
    if (result.data === '0') {
        proxy.Message.success('申请成功')
    } else {
        proxy.Message.success('申请成功，等待对方同意')
    }
}

</script>


<style lang="scss" scoped>
.op-btn{
    text-align: center;
    border-top: 1px solid #eaeaea;
    padding-top: 10px;
}
</style>