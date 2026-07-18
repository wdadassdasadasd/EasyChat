<template>
    <div class="login-panel">
        <div class="title drag">EasyChat</div>
        <div v-if="showLoading" class="loading-panel">
          <img src="../assets/img/loading.gif"/>
          加载中...
        </div>
        <div class=login-form >
            <div class="error-msg" v-if="errorMsg">{{ errorMsg }}</div>
            <el-form :model="formData" :rules="rules" ref="formDataRef" label-width="0px" @submit.prevent>
              <el-form-item prop="email">
                <el-input size="large" clearable placeholder="请输入邮箱" v-model.trim="formData.email" maxlength="30" @focus="cleanVerify">
                  <template #prefix>
                     <el-icon><Message /></el-icon>
                  </template>
                </el-input>
              </el-form-item>
              <el-form-item prop="nickName" v-if="!isLogin">
                <el-input size="large" clearable placeholder="请输入昵称" v-model.trim="formData.nickName" maxlength="15" @focus="cleanVerify">
                  <template #prefix>
                     <el-icon><User /></el-icon>
                  </template>
                </el-input>
              </el-form-item>
              <el-form-item prop="password">
                <el-input size="large" show-password clearable placeholder="请输入密码" v-model.trim="formData.password" @focus="cleanVerify">
                  <template #prefix>
                     <el-icon><Lock /></el-icon>
                  </template>
                </el-input>
              </el-form-item>
              <el-form-item prop="rePassword" v-if="!isLogin">
                <el-input size="large" clearable placeholder="请再次输入密码" v-model.trim="formData.rePassword" @focus="cleanVerify">
                  <template #prefix>
                     <el-icon><Lock /></el-icon>
                  </template>
                </el-input>
              </el-form-item>
              <el-form-item prop="checkCode">
                 <el-input size="large" clearable placeholder="请输入验证码" v-model.trim="formData.checkCode" @focus="cleanVerify">
                  <template #prefix>
                     <el-icon><Key /></el-icon>
                  </template>
                  <template #suffix>
                    <img :src="checkCodeUrl" class="check-code" @click="changeCheckCode"/>
                  </template>
                </el-input>
              </el-form-item>
                <el-form-item>
                  <el-button type="primary" class="login-btn" @click="submit">{{isLogin?'登录':'注册'}}</el-button>
              </el-form-item>
              <div class="bottom-link">
                <span class="a-link" @click="changeOpType">{{ isLogin?'没有账号' :'已有账号' }}</span>
              </div>
            </el-form>
        </div>
        <WinOp :showSetTop="false" :showMin="false" :showMax="false" :closeType="0"></WinOp>
    </div>

</template>

<script setup>
import { ref, nextTick, getCurrentInstance, onBeforeUnmount } from 'vue';
import { Key, Lock, Message, User } from '@element-plus/icons-vue';
import {useUserInfoStore} from '@/stores/UserInfoStore.js';
import { useRouter } from 'vue-router';

const router=useRouter();
const userInfoStore=useUserInfoStore();
const {proxy} = getCurrentInstance();

const formData=ref({})
const formDataRef=ref()
const checkCodeUrl=ref()
const rules={
 email:[{required:true,message:'请输入邮箱'}],
 password:[{required:true,message:'请输入密码'}],
 checkCode:[{required:true,message:'请输入验证码'}],
}

const isLogin=ref(true);
const changeOpType=()=>{
  isLogin.value=!isLogin.value;
  window.api.sendLoginOrRegister(isLogin.value);
  nextTick(()=>{
    formDataRef.value.resetFields();
    formData.value={};
    cleanVerify();
    changeCheckCode();
  })
}

// 获取验证码
const checkCodeRetryCount = ref(0)
const MAX_CHECKCODE_RETRY = 3
let checkCodeTimer = null

const changeCheckCode = async () => {
  if (checkCodeRetryCount.value >= MAX_CHECKCODE_RETRY) {
    errorMsg.value = '验证码加载失败，请稍后手动点击刷新'
    checkCodeUrl.value = ''
    return
  }
  checkCodeRetryCount.value += 1

  let result = await proxy.Request({
    url: proxy.Api.checkCode,
    showError: false
  })
  if (!result) {
    showLoading.value = false
    // 延迟 1 秒后再重试，避免瞬间高频请求
    checkCodeTimer = setTimeout(() => {
      checkCodeTimer = null
      changeCheckCode()
    }, 1000)
    return
  }
  checkCodeRetryCount.value = 0
  checkCodeUrl.value = result.data.checkCode
  localStorage.setItem('checkCodeKey', result.data.checkCodeKey)
}
changeCheckCode();

const errorMsg=ref(null);
const showLoading=ref(false);


const checkValue=(type,value,msg)=>{
    if(proxy.Utils.isEmpty(value)){
    errorMsg.value=msg;
    return false; 
  }

  if(type&&!proxy.Verify[type](value)){
    errorMsg.value=msg;
    return false;
  }
    

  return true;
}
const cleanVerify=()=>{
  errorMsg.value=null;

}

const submit=async()=>{
 cleanVerify();
 if(!checkValue('checkEmail',formData.value.email,'请输入正确的邮箱')){
  return;
 }
  if(!isLogin.value&&!checkValue(null,formData.value.nickName,'请输入昵称'))
 {
  return;
 }
 if(!checkValue('checkPassword',formData.value.password,'密码只能是数字，字母或者特殊字符8-18位'))
 {
  return;
 }
 if(!isLogin.value&&!checkValue(null,formData.value.rePassword,'请再次输入密码'))
 {
  return;
 }
 if(!checkValue(null,formData.value.checkCode,'请输入验证码'))
 {
  return;
 }
 if(isLogin.value){
  showLoading.value=true;
 }
 let result=await proxy.Request({
  url:isLogin.value?proxy.Api.Login:proxy.Api.Register,
  showError:false,
  showLoading:isLogin.value?false:true,
  params:{
    email:formData.value.email,
    // 口令只通过 TLS 的受控传输链路发送；后端按版本执行 PBKDF2 校验。
    password:formData.value.password,
    credentialVersion:2,
    checkCode:formData.value.checkCode,
    checkCodeKey:localStorage.getItem('checkCodeKey'),
    nickName:formData.value.nickName,
  },
  //登录错误处理回调
  errorCallback:(response)=>{
    showLoading.value=false;
    changeCheckCode();
    errorMsg.value=response?.info || response?.msg || `登录失败(${response?.code || 'unknown'})`;
  }
})
  if (!result) {
    showLoading.value = false
    changeCheckCode()
    return
  }
  if(isLogin.value){
    const screenWidth=window.screen.width;
    const screenHeight=window.screen.height;

    const runtimeResult = await window.api.invokeStartAuthenticatedSession({
      email:formData.value.email,
      token:result.data.token,
      userId:result.data.userId,
      nickName:result.data.nickName,
      admin:result.data.admin,
      screenWidth:screenWidth,
      screenHeight:screenHeight
    });
    if (!runtimeResult?.success) {
      showLoading.value = false;
      errorMsg.value = runtimeResult?.error || '本地登录状态初始化失败，请重试';
      return;
    }
    userInfoStore.setUserInfo(result.data);
    router.push('/main');
    if (runtimeResult.persistent === false) {
      proxy.Message.warning('当前系统安全存储不可用，本次关闭应用后需要重新登录');
    }

  } else {
    proxy.Message.success('注册成功，请登录');
    changeOpType();
  }
}

onBeforeUnmount(() => {
  if (checkCodeTimer) {
    clearTimeout(checkCodeTimer)
    checkCodeTimer = null
  }
})


</script>

<style lang="scss" scoped>
.login-panel {
  position: relative;
  min-height: 100vh;
  overflow: hidden;
  background: #fff;
}
.email-select {
  width: 250px;
}
.loading-panel {
  height: calc(100vh - 32px);
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: hidden;
  font-size: 14px;
  color: #727272;
  img {
    width: 30px;
    margin-right: 3px;
  }
}
.login-form {
  padding: 0px 15px;
  height: calc(100vh - 32px);
  :deep(.el-input__wrapper) {
    box-shadow: none;
    border-radius: 0;
  }
  .el-form-item {
    border-bottom: 1px solid #ddd;
  }

  .email-panel {
    align-items: center;
    width: 100%;
    display: flex;
    .input {
      flex: 1;
    }
  }
  .error-msg {
    line-height: 30px;
    height: 30px;
    color: #fb7373;
  }
  .check-code-panel {
    display: flex;
    .check-code {
      cursor: pointer;
      width: 120px;
      margin-left: 5px;
    }
  }

  .login-btn {
    margin-top: 20px;
    width: 100%;
  }
  .bottom-link {
    text-align: right; 
    font-size: 13px;
  }
}
</style>
