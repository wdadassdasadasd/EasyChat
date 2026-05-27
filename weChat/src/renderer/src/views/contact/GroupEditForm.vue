<template>
    <el-form
        ref="formDataRef"
        :model="formData"
        :rules="rules"
        label-width="80px"
        @submit.prevent
    >
        <el-form-item label="群名称" prop="groupName">
            <el-input
                v-model.trim="formData.groupName"
                placeholder="请输入群名称"
                clearable
                maxlength="150"
            />
        </el-form-item>

        <el-form-item label="封面" prop="avatarFile">
            <AvatarUpload
                v-model="formData.avatarFile"
                ref="avatarUploadRef"
                @coverfile="saveCover"
            />
        </el-form-item>

        <el-form-item label="加入权限" prop="joinType">
            <el-radio-group v-model="formData.joinType">
                <el-radio :label="1">管理员同意后加入</el-radio>
                <el-radio :label="0">直接加入</el-radio>
            </el-radio-group>
        </el-form-item>

        <el-form-item label="公告" prop="groupNotice">
            <el-input
                v-model.trim="formData.groupNotice"
                placeholder="请输入公告内容"
                clearable
                maxlength="300"
                type="textarea"
                :rows="5"
                :show-word-limit="true"
                resize="none"
            />
        </el-form-item>

        <el-form-item>
            <el-button type="primary" :loading="saving" @click="submit">
                {{ formData.groupId ? '修改群组' : '创建群组' }}
            </el-button>
        </el-form-item>
    </el-form>
</template>

<script setup>
import { ref, getCurrentInstance } from 'vue';
import { useContactStateStore } from '../../stores/ContactStateStore';

const contactStateStore = useContactStateStore();
const { proxy } = getCurrentInstance();

const formDataRef = ref();
const avatarUploadRef = ref();
const saving = ref(false);

const formData = ref({
    groupName: '',
    groupNotice: '',
    joinType: 1,
    avatarFile: null,
    avatarCover: null
});

const rules = {
    groupName: [{ required: true, message: '请输入群名称', trigger: 'blur' }],
    joinType: [{ required: true, message: '请选择加入权限', trigger: 'change' }]
};

const emit = defineEmits(['editBack']);

const submit = async () => {
    if (saving.value) {
        return;
    }

    const valid = await formDataRef.value.validate().catch(() => false);
    if (!valid) {
        return;
    }

    const params = { ...formData.value };

    if (!(params.avatarFile instanceof File)) {
        delete params.avatarFile;
    }

    if (!(params.avatarCover instanceof File) && !(params.avatarCover instanceof Blob)) {
        delete params.avatarCover;
    }

    saving.value = true;
    try {
        const result = await proxy.Request({
            url: proxy.Api.saveGroup,
            params
        });

        if (!result) {
            proxy.Message.error('操作失败');
            return;
        }

        if (params.groupId) {
            proxy.Message.success('群组修改成功');
            emit('editBack');
        } else {
            proxy.Message.success('群组创建成功');
            resetForm();
        }

        contactStateStore.setContactReload('MY_GROUP');
    } finally {
        saving.value = false;
    }
};

const resetForm = () => {
    formData.value = {
        groupName: '',
        groupNotice: '',
        joinType: 1,
        avatarFile: null,
        avatarCover: null
    };
    formDataRef.value?.clearValidate();
};

const saveCover = ({ avatarFile, avatarCover }) => {
    formData.value.avatarFile = avatarFile;
    formData.value.avatarCover = avatarCover;
};

const show = (data = {}) => {
    formDataRef.value?.clearValidate();
    formData.value = {
        groupName: data.groupName || '',
        groupNotice: data.groupNotice || '',
        joinType: data.joinType ?? 1,
        groupId: data.groupId,
        avatarFile: data.groupId || null,
        avatarCover: null
    };
};

defineExpose({
    show
});
</script>

<style lang="scss" scoped>
</style>