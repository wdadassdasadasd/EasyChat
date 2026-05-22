<template>
    <ContactPanel>
        <div class="user-info">
            <UserBaseInfo :user-info="userInfo">
                <div class="more-op">
                    <el-dropdown placement="bottom-end" trigger="click">
                        <span class="el-dropdown-link">
                            <el-icon class="more-icon">
                                <MoreFilled />
                            </el-icon>
                        </span>
                        <template #dropdown>
                            <el-dropdown-menu>
                                <el-dropdown-item @click="addConatct2BlackList">加入黑名单</el-dropdown-item>
                                <el-dropdown-item @click="delContact">删除联系人</el-dropdown-item>
                               
                            </el-dropdown-menu>
                        </template>
                    </el-dropdown>
                </div>

            </UserBaseInfo>
        </div>
        <div class="part-item">
            <div class="part-title">个性签名</div>
            <div class="part-content">
                {{ userInfo.personalSignature || '暂无个性签名' }}
            </div>
            <div class="send-message" @click="sendMessage">
                <el-icon class="send-message-icon">
                    <ChatDotRound />
                </el-icon>
                <div class="text">发消息</div>
            </div>
        </div>
            
    </ContactPanel>
    
</template>

<script setup>
import { ref, reactive, getCurrentInstance } from 'vue';
import ContactPanel from '../../components/ContactPanel.vue';
import UserBaseInfo from '../../components/UserBaseInfo.vue';
import { useContactStateStore } from '../../stores/ContactStateStore';
import { useRoute ,useRouter} from 'vue-router';
const route = useRoute();
const router=useRouter();
const proxy = getCurrentInstance();
const userInfo = ref({})
const contactStateStore = useContactStateStore();
const loadUserDetail=async(contactId)=>{
   let result=await proxy.request({
    url:proxy.Api.getConatctUserInfo,
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
const addConatct2BlackList=()=>{
    proxy.Confirm({
        message: '确定要将此联系人加入黑名单吗？',
        okfun: async () => {
            let result = await proxy.request({
                url:proxy.Api.addConatct2BlackList,
                params:{
                    contactId:userInfo.value.userId
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
            let result = await proxy.request({
                url:proxy.Api.delContact,
                params:{
                    contactId:userInfo.value.userId
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
    contactStateStore.setConctReload('REMOVE_USER');
    contactStateStore.delContact(userInfo.value.userId);
}
watch(()=>route.query.contactId, (newVal,oldVal) => {
    if (newVal) {
        loadUserDetail(newVal);
    }
}, { immediate: true,deep: true });
</script>

<style lang="scss" scoped>
.more-icon,
.send-message-icon {
    font-size: 20px;
    color: #666;
}

</style>
