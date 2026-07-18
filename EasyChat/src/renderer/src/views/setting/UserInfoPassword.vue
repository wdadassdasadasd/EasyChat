<template>
    <el-form :model="formData" @submit.prevent ref="formDataRef" label-width="80px" :rules="rules">
            <el-form-item label="密码" prop="password">
                <el-input v-model.trim="formData.password" clearable placeholder="请输入密码" type="password" show-password></el-input>
            </el-form-item>
            <el-form-item label="确认密码" prop="rePassword">
                <el-input v-model.trim="formData.rePassword" clearable placeholder="请再次确认密码" type="password" show-password></el-input>
            </el-form-item>
            <el-form-item>
                <el-button @click="savePassword" type="primary">修改密码</el-button>
                <el-button link @click="cancel">取消</el-button>
            </el-form-item>
    </el-form>
</template>

<script setup>
import { ref, getCurrentInstance } from 'vue';
import { useRouter } from 'vue-router';
import { invalidateRequestScope } from '@/utils/Request';

const { proxy } = getCurrentInstance();
const router = useRouter();

const formDataRef = ref();
const formData = ref({
    password: '',
    rePassword: ''
});

const validateRePass = (rule, value, callback) => {
    if (value !== formData.value.password) {
        callback(new Error('两次输入的密码不一致'));
    } else {
        callback();
    }
};

const rules = {
    password: [
        { message: '请输入密码', required: true },
        { pattern: /^(?=.*\d)(?=.*[a-zA-Z])[\da-zA-Z~!@#$%^&*_]{8,18}$/, message: '密码只能是数字、字母、特殊字符，8-18位' }
    ],
    rePassword: [
        { message: '请再次确认密码', required: true },
        { validator: validateRePass }
    ]
};

const emit = defineEmits(['editBack']);

const savePassword = () => {
    formDataRef.value.validate(async (valid) => {
        if (!valid) return;

        proxy.Confirm({
            message: '修改密码后要重新登录，你确认要修改吗',
            okfun: async () => {
                let result = await proxy.Request({
                    url: proxy.Api.updatePassword,
                    params: {
                        password: formData.value.password,
                        credentialVersion: 2
                    }
                });
                if (!result) return;
                proxy.Message.success('修改成功，请重新登录', async () => {
                    invalidateRequestScope();
                    await window.api.invokeLogout().catch(() => false);
                    router.push('/login');
                });
            }
        });
    });
};

const cancel = () => {
    emit('editBack');
};
</script>

<style lang="scss" scoped>
</style>
