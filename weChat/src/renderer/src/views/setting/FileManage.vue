<template>
    <ContactPanel v-loading="copying">

        <el-form :model="formData" @submit.prevent ref="formDataRef" label-width="80px" :rules="rules">
            <el-form-item label="文件管理" prop="" class="file-manage">
                <div class="file-input" :title="formData.sysSetting">{{formData.sysSetting}}</div>
                <div class="tips">文件的默认保存位置</div>
            </el-form-item>
            <el-form-item>
                <el-button type="primary" @click="changeFolder">更改</el-button>
                <el-button type="primary" @click="openLocalFolder">打开文件夹</el-button>
            </el-form-item>
           
        </el-form>
        
    </ContactPanel>
    
</template>


<script setup>
import { ref, getCurrentInstance, onMounted } from 'vue';

const {proxy}=getCurrentInstance();
const formDataRef=ref();
const formData=ref({});
const rules={
    title:[{
        required:true,
        message:'请输入内容'
    }]
}
const copying=ref(false);


//TODO 获取文件缓存路径

const changeFolder=()=>{

}
const openLocalFolder=()=>{

}

</script>

<style lang="scss" scoped>





</style>