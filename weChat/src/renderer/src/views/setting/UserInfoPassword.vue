<template>
    <el-form :model="formData" @submit.prevent ref="formDataRef" label-width="80px" :rules="rules">
            <el-form-item label="密码" prop="password">
                <el-input v-model.trim="formData.password" clearable placeholder="请输入密码" type="password" show-password></el-input>
            </el-form-item>
            <el-form-item label="确认密码" prop="rePassword">
                <el-input v-model.trim="formData.rePassword" clearable placeholder="请再次确认密码" type="password" show-password></el-input>
            </el-form-item>
            <el-form-item>
                <el-button @click="saveUserInfo" type="primary">修改密码</el-button>
                <el-button link @click="cancel">取消</el-button>
                
            </el-form-item>

    </el-form>


</template>





<script setup>
import { ref, computed, getCurrentInstance } from 'vue';
import { useContactStateStore } from '../../stores/ContactStateStore';
import { useRoute ,useRouter} from 'vue-router';
import { useUserInfoStore } from '../../stores/userInfoStore';

const {proxy}=getCurrentInstance();

const userInfoStore=useUserInfoStore();
const route=useRoute();
const router=useRouter();

const validateRePass=()=>{
    if(value!=formData.value.rePassword){
        Callback(new Error(rules.message))
    }
    else{
        Callback();
    }

}
const rules=rules[{
    password:[
    {
        message:'请输入密码',
        required:true
    },
    {
        validator:proxy.Varify.password,message:'密码只能是数字，字母，特殊字符，8-18位'
    }
],
    Repassword:[
    {
        message:'请再次确认密码',
        required:true
    },
    {
        validator:proxy.Varify.rePassword,message:'两次输入的密码不一致'
    }
],
}]

const emit=defineEmits('editBack')
const saveUserInfo=()=>{
    formDataRef.value.validate(async(valid)=>{
        if(!valid){
            return
        }
      
        proxy.Confirm({
            message:'修改密码后要重新登录，你确认要修改吗',
            okfun:async()=>{
                let params={};
                Object.assign(params,formData.value);
                let result= await proxy.Request({
                        url:proxy.Api.saveUserInfo,
                        params
                    })
                if(!result){
                    return;
                    }
                proxy.Message.success('修改成功，请重新登录',()=>{
                //TODO 重新登录
                window.ipcRenderer.send('reLogin');
                });
            }
        })
    })

}

const cancel=()=>{
    emit('editBack')
}




</script>



<style lang="scss" scoped>



</style>