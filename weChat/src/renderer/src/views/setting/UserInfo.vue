<template>
    <ContactPanel class="account-panel">
        <div class="account-center">
            <section class="setting-card profile-card">
                <div class="profile-identity">
                    <div class="identity-avatar">
                        <ShowLocalImage :fileId="userInfo.userId" partType="avatar" :width="64"></ShowLocalImage>
                    </div>
                    <div class="identity-info">
                        <div class="identity-name" :title="userInfo.nickName">{{ userInfo.nickName || '-' }}</div>
                        <div class="identity-meta">
                            <span class="meta-item" :title="userInfo.email">{{ userInfo.email || '-' }}</span>
                            <span class="meta-divider">·</span>
                            <span class="meta-item">ID: {{ userInfo.userId || '-' }}</span>
                        </div>
                    </div>
                    <el-button text size="small" @click="resetProfileForm">重置</el-button>
                </div>

                <el-form
                    ref="profileFormRef"
                    class="profile-form"
                    :model="profileForm"
                    :rules="profileRules"
                    label-width="92px"
                    @submit.prevent="saveUserInfo"
                >
                    <el-form-item label="头像" prop="avatarFile">
                        <AvatarUpload v-model="profileForm.avatarFile" @coverfile="saveCover"></AvatarUpload>
                    </el-form-item>
                    <el-form-item label="昵称" prop="nickName">
                        <el-input
                            v-model.trim="profileForm.nickName"
                            maxlength="150"
                            clearable
                            placeholder="请输入昵称"
                        ></el-input>
                    </el-form-item>
                    <el-form-item label="性别" prop="sex">
                        <el-radio-group v-model="profileForm.sex">
                            <el-radio :label="1">男</el-radio>
                            <el-radio :label="0">女</el-radio>
                        </el-radio-group>
                    </el-form-item>
                    <el-form-item label="好友权限" prop="joinType">
                        <div class="switch-row">
                            <el-switch
                                v-model="profileForm.joinType"
                                :active-value="1"
                                :inactive-value="0"
                            ></el-switch>
                            <span>加我为好友时需要验证</span>
                        </div>
                    </el-form-item>
                    <el-form-item label="地区" prop="area">
                        <AreaSelect v-model="profileForm.area"></AreaSelect>
                    </el-form-item>
                    <el-form-item label="个性签名" prop="personalSignature">
                        <el-input
                            v-model.trim="profileForm.personalSignature"
                            maxlength="30"
                            clearable
                            placeholder="请输入个性签名"
                            type="textarea"
                            rows="3"
                            :show-word-limit="true"
                            resize="none"
                        ></el-input>
                    </el-form-item>
                    <el-form-item class="form-actions">
                        <el-button
                            type="primary"
                            :loading="savingProfile"
                            @click="saveUserInfo"
                        >
                            保存资料
                        </el-button>
                    </el-form-item>
                </el-form>
            </section>

            <section class="setting-card">
                <div class="card-header">
                    <h3>账号安全</h3>
                    <p>修改密码后会退出当前登录，需要重新登录。</p>
                </div>

                <el-form
                    ref="passwordFormRef"
                    class="password-form"
                    :model="passwordForm"
                    :rules="passwordRules"
                    label-width="92px"
                    @submit.prevent="savePassword"
                >
                    <el-form-item label="新密码" prop="password">
                        <el-input
                            v-model.trim="passwordForm.password"
                            clearable
                            placeholder="8-18 位，必须包含字母和数字"
                            type="password"
                            show-password
                        ></el-input>
                    </el-form-item>
                    <el-form-item label="确认密码" prop="rePassword">
                        <el-input
                            v-model.trim="passwordForm.rePassword"
                            clearable
                            placeholder="请再次输入新密码"
                            type="password"
                            show-password
                        ></el-input>
                    </el-form-item>
                    <el-form-item class="form-actions">
                        <el-button
                            type="primary"
                            :loading="savingPassword"
                            @click="savePassword"
                        >
                            修改密码
                        </el-button>
                        <el-button text @click="resetPasswordForm">清空</el-button>
                    </el-form-item>
                </el-form>
            </section>

            <section class="setting-card danger-card">
                <div class="danger-copy">
                    <h3>登录操作</h3>
                    <p>退出后将关闭当前连接，并回到登录页。</p>
                </div>
                <el-button type="danger" plain :loading="loggingOut" @click="logout">退出登录</el-button>
            </section>
        </div>
    </ContactPanel>
</template>

<script setup>
import { computed, getCurrentInstance, ref } from 'vue';
import { useRouter } from 'vue-router';
import md5 from 'js-md5';
import AreaSelect from '../../components/AreaSelect.vue';
import { useUserInfoStore } from '../../stores/UserInfoStore';

const { proxy } = getCurrentInstance();
const router = useRouter();
const userInfoStore = useUserInfoStore();

const userInfo = ref({});
const profileFormRef = ref();
const passwordFormRef = ref();
const savingProfile = ref(false);
const savingPassword = ref(false);
const loggingOut = ref(false);

const profileForm = ref({
    avatarFile: '',
    avatarCover: null,
    nickName: '',
    sex: 1,
    joinType: 0,
    area: {
        areaCode: [],
        areaName: []
    },
    personalSignature: ''
});

const passwordForm = ref({
    password: '',
    rePassword: ''
});



const profileRules = {
    nickName: [{ required: true, message: '请输入昵称' }]
};

const validateRePass = (rule, value, callback) => {
    if (value !== passwordForm.value.password) {
        callback(new Error('两次输入的密码不一致'));
    } else {
        callback();
    }
};

const passwordRules = {
    password: [
        { required: true, message: '请输入密码' },
        {
            pattern: /^(?=.*\d)(?=.*[a-zA-Z])[\da-zA-Z~!@#$%^&*_]{8,18}$/,
            message: '密码需为 8-18 位，且必须包含字母和数字'
        }
    ],
    rePassword: [
        { required: true, message: '请再次确认密码' },
        { validator: validateRePass }
    ]
};

const syncProfileForm = (data = {}) => {
    profileForm.value = {
        ...data,
        avatarFile: data.userId || '',
        avatarCover: null,
        sex: data.sex ?? 1,
        joinType: data.joinType ?? 0,
        area: {
            areaCode: data.areaCode ? data.areaCode.split(',') : [],
            areaName: data.areaName ? data.areaName.split(',') : []
        },
        personalSignature: data.personalSignature || ''
    };
};

const getUserInfo = async () => {
    const result = await proxy.Request({
        url: proxy.Api.getUserInfo
    });
    if (!result) {
        return;
    }
    userInfo.value = result.data || {};
    userInfoStore.setUserInfo(result.data || {});
    syncProfileForm(result.data || {});
};

const resetProfileForm = () => {
    syncProfileForm(userInfo.value);
    profileFormRef.value?.clearValidate();
};

const resetPasswordForm = () => {
    passwordForm.value = {
        password: '',
        rePassword: ''
    };
    passwordFormRef.value?.clearValidate();
};

const saveCover = ({ avatarFile, avatarCover }) => {
    profileForm.value.avatarFile = avatarFile;
    profileForm.value.avatarCover = avatarCover;
};

const resetToLogin = async () => {
    userInfoStore.clearUserInfo();
    if (window.electron?.ipcRenderer?.invoke) {
        await window.electron.ipcRenderer.invoke('logout').catch(() => false);
    } else {
        window.ipcRenderer?.send('reLogin');
    }
    router.push('/login');
};

const saveUserInfo = async () => {
    if (savingProfile.value) {
        return;
    }

    const valid = await profileFormRef.value?.validate().catch(() => false);
    if (!valid) {
        proxy.Message.error('请先完善个人资料');
        return;
    }

    const params = {
        ...profileForm.value,
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

    savingProfile.value = true;
    try {
        const result = await proxy.Request({
            url: proxy.Api.saveUserInfo,
            params
        });
        if (!result) {
            return;
        }

        proxy.Message.success('保存成功');
        userInfo.value = result.data || {};
        userInfoStore.setUserInfo(result.data || {});
        syncProfileForm(result.data || {});
    } finally {
        savingProfile.value = false;
    }
};

const savePassword = async () => {
    if (savingPassword.value) {
        return;
    }

    const valid = await passwordFormRef.value?.validate().catch(() => false);
    if (!valid) {
        return;
    }

    proxy.Confirm({
        message: '修改密码后需要重新登录，确认修改吗？',
        okfun: async () => {
            savingPassword.value = true;
            try {
                const result = await proxy.Request({
                    url: proxy.Api.updatePassword,
                    params: {
                        password: md5(passwordForm.value.password)
                    }
                });
                if (!result) {
                    return;
                }

                proxy.Message.success('修改成功，请重新登录');
                await resetToLogin();
            } finally {
                savingPassword.value = false;
            }
        }
    });
};

const logout = () => {
    if (loggingOut.value) {
        return;
    }

    proxy.Confirm({
        message: '确认退出当前账号吗？',
        okText: '退出登录',
        okfun: async () => {
            loggingOut.value = true;
            try {
                const result = await proxy.Request({
                    url: proxy.Api.logout
                });
                if (!result) {
                    return;
                }

                await resetToLogin();
            } finally {
                loggingOut.value = false;
            }
        }
    });
};

getUserInfo();
</script>

<style lang="scss" scoped>
:deep(.content-panel) {
    height: calc(100vh - 60px);
    background: #f4f5f7;
}

:deep(.content-inner) {
    width: 100%;
    max-width: 680px;
}

.account-center {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 22px;
    box-sizing: border-box;
}

.setting-card {
    background: #fff;
    border: 1px solid #e7e8eb;
    border-radius: 8px;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
    padding: 20px 24px 18px;
}

/* ---- Profile identity bar ---- */
.profile-identity {
    display: flex;
    align-items: center;
    gap: 14px;
    padding-bottom: 18px;
    margin-bottom: 18px;
    border-bottom: 1px solid #eef0f3;
}

.identity-avatar {
    width: 64px;
    height: 64px;
    flex-shrink: 0;
    overflow: hidden;
    border-radius: 8px;
    background: #eceff3;
}

.identity-info {
    flex: 1;
    min-width: 0;
}

.identity-name {
    font-size: 17px;
    font-weight: 600;
    color: #1f2937;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.identity-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
    color: #8a9099;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.meta-divider {
    color: #d0d3d8;
}

.meta-item {
    overflow: hidden;
    text-overflow: ellipsis;
}

/* ---- Card header (password & logout) ---- */
.card-header {
    margin-bottom: 18px;

    h3 {
        margin: 0;
        color: #1f2937;
        font-size: 16px;
        font-weight: 600;
    }

    p {
        margin: 4px 0 0;
        color: #8a9099;
        font-size: 13px;
        line-height: 1.5;
    }
}

/* ---- Form ---- */
.profile-form,
.password-form {
    max-width: 520px;
}

.switch-row {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: #606266;
    font-size: 14px;
}

.form-actions {
    margin-bottom: 0;
}

/* ---- Danger card ---- */
.danger-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;

    h3 {
        margin: 0;
        color: #1f2937;
        font-size: 16px;
        font-weight: 600;
    }

    p {
        margin: 4px 0 0;
        color: #8a9099;
        font-size: 13px;
    }
}

@media (max-width: 720px) {
    .account-center {
        padding: 12px;
    }

    .profile-form,
    .password-form {
        max-width: 100%;
    }
}
</style>
