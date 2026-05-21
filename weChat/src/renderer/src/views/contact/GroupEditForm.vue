<template>
    <el-form :model="formData" :rules="rules" ref="formDataRef" label-width="80px" @submit.prevent>
        <el-form-item label="群名称" prop="groupName">
            <el-input v-model.trim="formData.groupName" placeholder="请输入群名称" clearable maxlength="150"></el-input>
        </el-form-item>
        <el-form-item label="封面" prop="avatarfile">
            <AvatarUpload v-model="formData.avatarfile" ref="avatarUploadRef" @coverfile="savecover"></AvatarUpload>
        </el-form-item>
         <el-form-item label="加入权限" prop="joinType">
            <el-radio-group v-model="formData.joinType">
                <el-radio :label="1">管理员同意后加入</el-radio>
                <el-radio :label="0">直接加入</el-radio>
            </el-radio-group>
        </el-form-item>
        <el-form-item label="公告" prop="groupNotice">
            <el-input v-model.trim="formData.groupNotice" placeholder="请输入公告内容" clearable maxlength="300" type="textarea" :rows="5" :show-word-limit="true" :resize="'none'"></el-input>
        </el-form-item>
        <el-form-item>
            <el-button type="primary" @click="submit">{{ formData.groupId? '修改群组' : '创建群组' }}</el-button>
        </el-form-item>
        
    </el-form>
    
 
   
</template>

<script setup>

import { ref, computed, getCurrentInstance } from 'vue';
import { useContactStateStore} from '../../stores/ContactStateStore';
import { de } from 'element-plus/es/locales.mjs';
const contactStateStore = useContactStateStore();
const { proxy } = getCurrentInstance();
const formDataRef = ref();
const formData = ref({});
const rules={
    title:[{required:true,message:'请输入群名称'}],
    groupName:[{required:true,message:'请输入群名称'}],

}
const emit=defineEmits(['emitback']);
const submit=async()=>{
    //表单校验
    formDataRef.value.validate(async (valid)=>{
        if(!valid){
            return;
        }
    let params={}
    Object.assign(params,formData.value);
    let result=await proxy.request({
        url:proxy.Api.saveGroup,
        params
    })
    if(!result){
        proxy.Message.error("操作失败");
    }
    //判断修改还是创建
    if(params.groupId){
        proxy.Message.success("群组修改成功");
        emit('emitback');
    }else{
        proxy.Message.success("群组创建成功");
    }
    formDataRef.value.resetFields();
    contactStateStore.setConctReload('MY')//刷新联系人列表
    //Todo 重新加载头像

    })
}
//保存封面图片 todo 可以优化为直接上传图片后返回url地址
const savecover=(file)=>{
    formData.value.avatarfile=file;
}

const show=(data)=>{
    formDataRef.value.resetFields();
    formData.value=Object.assign(formData.value,data);
    formData.value.avatarfile=null;
}
defineExpose({
    show
})
</script>

<style lang="scss" scoped>
</style>