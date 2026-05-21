<template>
    <ContactPanel>
        <div class="show-info" v-if="showType==0">
            <div class="userInfo">
                <UserBaseInfo :userInfo="userInfo"></UserBaseInfo>
                <div class="more-op">
                    <el-dropdown placement="bottom-end" trigger="click">
                        <span class="el-dropdown-link">
                            <div class="iconfont  icon-more"></div>
                        </span>
                        <template #dropdown>
                            <el-dropdown-menu>
                                <el-dropdown-item @click="changePart(1)">修改个人信息</el-dropdown-item>
                                <el-dropdown-item @click="changePart(2)">修改密码</el-dropdown-item>
                             
                            </el-dropdown-menu>
                        </template>
                        </el-dropdown>
                </div>

                <div class="part-item">
                    <div class="part-title">朋友权限</div>
                    <div class="part-content">
                        {{ userInfo.joinType==0?'直接加入':'加我为好友时需要验证' }}
                    </div>
                </div>
                 <div class="part-item">
                    <div class="part-title">个性签名</div>
                    <div class="part-content">{{ userInfo.personalSignature||'暂无个性签名' }}</div>
                </div>
                <div class="logout">
                    <el-button size="large" @click="logout">退出登录</el-button>
                </div>
                
            </div>
        </div>
        <div v-if="showType==1">
            <UserInfoEdit :data="userInfo" @editBack="editBack"></UserInfoEdit>
        </div>
            <div v-if="showType==2">
            <UserInfoPassword @editBack="editBack"></UserInfoPassword>
        </div>
    </ContactPanel>







</template>
<script setup>
import { ref, computed, getCurrentInstance } from 'vue';
import { useContactStateStore } from '../../stores/ContactStateStore';
import { useRoute ,useRouter} from 'vue-router';
import { useUserInfoStore } from '../../stores/userInfoStore';
import UserInfoEdit from './UserInfoEdit.vue';
import UserInfoPassword from './UserInfoPassword.vue';


const {proxy}=getCurrentInstance();
const userInfoStore=useUserInfoStore();
const route=useRoute();
const router=useRouter();
const userInfo=ref({});
const getUserInfo=async()=>{
    let result=await proxy.Request({
        url:proxy.Api.getUserInfo
    })
    if(!result){
        return;
    }
    userInfo.value=result.data;
}
getUserInfo();


const showType=ref(0);


const changePart=(part)=>{
    showType.value=part;
 
}
const editBack=()=>{
    showType.value=0;
    getUserInfo();

}

//退出登录
const logout=()=>{

}

</script>
<style lang="scss" scoped>
.el-dropdown-link {
  background-color: #ffffff; /* 默认背景色 */
  transition: background-color 0.3s ease; /* 平滑过渡 */
}

.el-dropdown-link:hover {
  background-color: #f0f0f0 !important; /* 悬停背景色 */
}

</style>