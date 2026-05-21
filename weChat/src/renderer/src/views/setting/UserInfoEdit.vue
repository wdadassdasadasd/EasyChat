<template>
    <div >
        <el-form :model="formData" @submit.prevent ref="formDataRef" label-width="80px" :rules="rules">
            <el-form-item label="头像" prop="avatarFile">
                <AvatarUpload v-model="formData.avatarFile" @coverfile="saveCover"></AvatarUpload>
            </el-form-item>
            <el-form-item label="昵称" prop="nickName">
                <el-input v-model.trim="formData.nickName" maxlength="150" clearable placeholder="请输入昵称"></el-input>
                
            </el-form-item>
            <el-form-item label="性别" prop="nickName">
                <el-radio-group v-model="formData.sex">
                    <el-radio :label="1">男</el-radio>
                    <el-radio :label="0">女</el-radio>

                </el-radio-group>
                
            </el-form-item>
            <el-form-item label="朋友权限" prop="joinType">
                <el-switch v-model="formData.joinType" :active-value="1" inactive-value="0"></el-switch>
                <div class="info">加我时需要好友验证</div>
                
            </el-form-item>
            <el-form-item label="地区" prop="area">
                <AreaSelect v-model="formData.area"></AreaSelect>
            </el-form-item>
            <el-form-item label="个性签名" prop="personalSignature">
                <el-input v-model.trim="formData.personalSignature" maxlength="30" clearable placeholder="请输入个性签名" type="textarea" rows="5" :show-word-limit="true" resize="none"></el-input>
            </el-form-item>
            <el-form-item>
                <el-button @click="saveUserInfo" type="primary">保存个人信息</el-button>
                <el-button @click="cancel" link>取消</el-button>
            </el-form-item>
        </el-form>
    </div>





</template>
<script setup>
import { ref, computed, getCurrentInstance } from 'vue';
import { useContactStateStore } from '../../stores/ContactStateStore';
import { useRoute ,useRouter} from 'vue-router';
import { useUserInfoStore } from '../../stores/userInfoStore';
import AreaSelect from '../../components/AreaSelect.vue';

const {proxy}=getCurrentInstance();
const userInfoStore=useUserInfoStore();
const route=useRoute();
const router=useRouter();

const formDataRef=ref()
const props=defineProps({
      data:{
        type:Object
    }

})
//需要格式转换，保持数据更新
const formData=computed(()=>{
    //不违背数据单向流，只是改变了属性没有改变值
    //props.data 父组件传来的
    const userInfo=props.data
    userInfo.avatarFile=userInfo.userId
    userInfo.area={
        areaCode:userInfo.areaCode?userInfo.areaCode.split(','):[],  //字符串->数组
        areaName:userInfo.areaName?userInfo.areaName.split(','):[]   //字符串->数组
    }
    return userInfo;

})
const rules={
    avatarFile:[{
        required:true,
        messge:'请选择头像'
    }],
    nickName:[{
        required:true,
        messge:'请输入昵称'
    }]  

}

const saveCover=({avatarFile,coverFile})=>{
    formData.value.avatarFile=avatarFile;
    formData.value.coverFile=coverFile;

}

const emit=defineEmits('editBack')
const saveUserInfo=()=>{
    formDataRef.value.validate(async(valid)=>{
        if(!valid){
            return
        }
        let params={};

        //拷贝表单数据
        Object.assign(params,formData.value)
        params.areaCode='';
        params.areaName='';
        //数组 → 字符串
        if(params.area){
            params.areaCode=params.area.areaCode.join(',');  
            params.areaName=params.area.areaName.join(',');
        }

        //TODO 强制刷新头像

        let result=await proxy.Request({
            url:proxy.Api.saveUserInfo,
            params
            })
        if(!result){
            return;

        }
        proxy.Message.success('保存成功');
        userInfoStore.setUserInfo(result.data);
        //TODO 强制刷新头像

    })
}

const cancel=()=>{
    emit('editBack')
}
</script>

<style lang="scss" scoped>
</style>