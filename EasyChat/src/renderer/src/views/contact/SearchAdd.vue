<template>
    <AppDialog
        :show="dialogConfig.show"
        :title="dialogConfig.title"
        :buttons="dialogConfig.buttons"
        :width="dialogConfig.width"
        :showCancel="dialogConfig.showCancel"
        @close="dialogConfig.show = false"
    >
        <el-form ref="formDataRef" :model="formData" :rules="rules" @submit.prevent>
            <el-form-item prop="applyInfo">
                <el-input
                    v-model.trim="formData.applyInfo"
                    placeholder="输入申请信息，更容易通过审核"
                    resize="none"
                    show-word-limit
                    maxlength="100"
                    :rows="5"
                    type="textarea"
                ></el-input>
            </el-form-item>
        </el-form>
    </AppDialog>
</template>

<script setup>
import { ref, getCurrentInstance, nextTick } from 'vue';
import { useUserInfoStore } from '@/stores/UserInfoStore';
import { useContactStateStore} from '../../stores/ContactStateStore';
const { proxy } = getCurrentInstance();
const userInfoStore = useUserInfoStore();
const contactStateStore=useContactStateStore();
const formDataRef = ref();
const formData = ref({
    contactId: '',
    contactType: '',
    applyInfo: '',
});

const rules = {
    applyInfo: [
        {
            required: true,
            message: '请输入申请信息',
            trigger: 'blur',
        },
    ],
};

const dialogConfig = ref({
    show: false,
    title: '提交申请',
    width: 500,
    showCancel: true,
    buttons: [
        {
            text: '确定',
            type: 'primary',
            click: () => {
                submitApply();
            },
        },
    ],
});


const emit = defineEmits(['reload']);

//提交申请
const submitApply = async () => {
    const valid = await formDataRef.value?.validate().catch(() => false);
    if (!valid) return;

    const { contactId, contactType, applyInfo } = formData.value;
    const result = await proxy.Request({
        url: proxy.Api.applyAdd,
        params: {
            contactId,
            contactType,
            applyInfo,
        },
    });

    if (!result) {
        proxy.Message.error('申请失败');
        return;
    }

    if (result.data === '0') {
        proxy.Message.success('申请成功');
    } else {
        proxy.Message.success('申请成功，等待对方同意');
    }

    dialogConfig.value.show = false;
    emit('reload');
    if(result.data==0){
        contactStateStore.setContactReload(contactType);
    }
};

//
const show = (data) => {
    //Pinia Store 获取当前登录用户信息
    const userInfo = userInfoStore.getInfo() || {};
    const name = userInfo.nickName ||  '我';

    dialogConfig.value.show = true;
         // 确保DOM更新完成
        nextTick(() => {
        formDataRef.value?.resetFields();
        //填充新数据
        formData.value = {
            contactId: data?.contactId || '',
            contactType: data?.contactType || '',
            applyInfo: `我是${name}，请求添加你为好友`,
        };
    });
};

defineExpose({
    show,
});
</script>

<style lang="scss" scoped>
</style>
