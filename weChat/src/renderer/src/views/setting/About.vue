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
import { ref, computed, getCurrentInstance } from 'vue';
import { useContactStateStore } from '../../stores/ContactStateStore';
import { useRoute ,useRouter} from 'vue-router';
import { useUserInfoStore } from '../../stores/userInfoStore';


const {proxy}=getCurrentInstance();
const userInfoStore=useUserInfoStore();
const route=useRoute();
const router=useRouter();

const changeUpdate=()=>{

}

</script>

<style lang="scss" scoped>





</style>