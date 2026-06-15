<template>
    <ContactPanel>

        <el-form :model="formData" @submit.prevent ref="formDataRef" label-width="80px" :rules="rules">
            <el-form-item label="版本信息">
                <div class="version-info">
                    <div>微信 1.0.0</div>
                    <div>
                        <el-button type="primary" @click="checkUpdate">检查更新</el-button>
                    </div>
                 
                </div>
            </el-form-item>
            <el-form-item>
                <el-button type="primary" @click="changeFolder">更改</el-button>
                <el-button type="primary" @click="openLocalFolder">打开文件夹</el-button>
            </el-form-item>
           
        </el-form>
        
    </ContactPanel>
    
</template>


<script setup>
import { ref, getCurrentInstance } from 'vue';

const {proxy}=getCurrentInstance();
const formDataRef=ref();
const formData=ref({});
const rules={};

const checkUpdate=()=>{
    proxy.Message.warning('当前已是最新版本');
}

const changeFolder=()=>{
    proxy.Message.warning('请在文件管理中修改文件保存位置');
}

const openLocalFolder=()=>{
    proxy.Message.warning('请在文件管理中打开文件夹');
}

</script>

<style lang="scss" scoped>





</style>
