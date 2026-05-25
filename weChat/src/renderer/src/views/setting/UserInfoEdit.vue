<template>
    <div>
        <el-form
            ref="formDataRef"
            :model="formData"
            :rules="rules"
            label-width="80px"
            @submit.prevent="saveUserInfo"
        >
            <el-form-item label="头像" prop="avatarFile">
                <AvatarUpload v-model="formData.avatarFile" @coverfile="saveCover"></AvatarUpload>
            </el-form-item>

            <el-form-item label="昵称" prop="nickName">
                <el-input
                    v-model.trim="formData.nickName"
                    maxlength="150"
                    clearable
                    placeholder="请输入昵称"
                ></el-input>
            </el-form-item>

            <el-form-item label="性别" prop="sex">
                <el-radio-group v-model="formData.sex">
                    <el-radio :label="1">男</el-radio>
                    <el-radio :label="0">女</el-radio>
                </el-radio-group>
            </el-form-item>

            <el-form-item label="朋友权限" prop="joinType">
                <el-switch
                    v-model="formData.joinType"
                    :active-value="1"
                    :inactive-value="0"
                ></el-switch>
                <div class="info">加我时需要好友验证</div>
            </el-form-item>

            <el-form-item label="地区" prop="area">
                <AreaSelect v-model="formData.area"></AreaSelect>
            </el-form-item>

            <el-form-item label="个性签名" prop="personalSignature">
                <el-input
                    v-model.trim="formData.personalSignature"
                    maxlength="30"
                    clearable
                    placeholder="请输入个性签名"
                    type="textarea"
                    rows="5"
                    :show-word-limit="true"
                    resize="none"
                ></el-input>
            </el-form-item>

            <el-form-item>
                <el-button
                    type="primary"
                    native-type="button"
                    :loading="saving"
                    @click="saveUserInfo"
                >
                    保存个人信息
                </el-button>
                <el-button link @click="cancel">取消</el-button>
            </el-form-item>
        </el-form>
    </div>
</template>

<script setup>
import { ref, getCurrentInstance, watch } from 'vue';
import { useUserInfoStore } from '../../stores/userInfoStore';
import AreaSelect from '../../components/AreaSelect.vue';

const { proxy } = getCurrentInstance();
const userInfoStore = useUserInfoStore();

const formDataRef = ref();
const formData = ref({});
const saving = ref(false);

const props = defineProps({
    data: {
        type: Object,
        default: () => ({})
    }
});

const emit = defineEmits(['editBack']);

watch(
    () => props.data,
    (userInfo = {}) => {
        formData.value = {
            ...userInfo,
            avatarFile: userInfo.userId || '',
            avatarCover: null,
            area: {
                areaCode: userInfo.areaCode ? userInfo.areaCode.split(',') : [],
                areaName: userInfo.areaName ? userInfo.areaName.split(',') : []
            }
        };
    },
    {
        immediate: true,
        deep: true
    }
);

const rules = {
    nickName: [{ required: true, message: '请输入昵称' }]
};

const saveCover = ({ avatarFile, avatarCover }) => {
    formData.value.avatarFile = avatarFile;
    formData.value.avatarCover = avatarCover;
};

const saveUserInfo = async () => {
    if (saving.value) {
        return;
    }

    if (!formDataRef.value) {
        proxy.Message.error('表单未初始化');
        return;
    }

    const valid = await formDataRef.value.validate().catch(() => false);
    if (!valid) {
        proxy.Message.error('请先完善个人信息');
        return;
    }

    const params = {
        ...formData.value,
        areaCode: '',
        areaName: ''
    };

    if (params.area) {
        params.areaCode = (params.area.areaCode || []).join(',');
        params.areaName = (params.area.areaName || []).join(',');
    }

    delete params.area;

    if (!(params.avatarFile instanceof File)) {
        delete params.avatarFile;
    }

    if (!(params.avatarCover instanceof File) && !(params.avatarCover instanceof Blob)) {
        delete params.avatarCover;
    }

    saving.value = true;
    try {
        let errorInfo = '';
        let errorResponse = null;
        let isBusinessError = false;
        const result = await proxy.Request({
            url: proxy.Api.saveUserInfo,
            params,
            errorCallback: (response) => {
                isBusinessError = true;
                errorResponse = response;
                errorInfo = response?.info || response?.msg || `保存失败，错误码：${response?.code || 'unknown'}`;
                console.error('保存用户信息接口返回:', JSON.stringify(response, null, 2));
            }
        });

        if (!result) {
            if (isBusinessError) {
                const detail = `code: ${errorResponse.code}, info: ${errorResponse.info || '无'}`;
                console.error('保存失败，接口返回详情:', detail);
                proxy.Message.error(errorInfo);
            } else {
                // 非业务错误：可能是901登录超时（被拦截器处理了），或网络异常
                console.error('保存失败：请求未返回有效结果，可能是登录超时或网络异常');
                proxy.Message.error('保存失败，可能登录已过期，请重新登录后再试');
            }
            return;
        }

        proxy.Message.success('保存成功');
        userInfoStore.setUserInfo(result.data);
        emit('editBack');
    } catch (e) {
        console.error('保存用户信息异常:', e);
        proxy.Message.error('保存失败，发生未知异常');
    } finally {
        saving.value = false;
    }
};

const cancel = () => {
    emit('editBack');
};
</script>

<style lang="scss" scoped>
.info {
    margin-left: 10px;
    color: #606266;
    font-size: 14px;
}
</style>
