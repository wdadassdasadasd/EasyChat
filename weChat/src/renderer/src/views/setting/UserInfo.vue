<template>
    <ContactPanel class="account-panel">
        <div class="account-center">
            <aside class="account-summary">
                <div class="summary-avatar">
                    <ShowLocalImage :fileId="userInfo.userId" partType="avatar" :width="92"></ShowLocalImage>
                </div>
                <div class="summary-name" :title="userInfo.nickName">{{ userInfo.nickName || '-' }}</div>
                <div class="summary-email" :title="userInfo.email">{{ userInfo.email || '-' }}</div>
                <div class="summary-badges">
                    <span>{{ sexText }}</span>
                    <span>{{ joinTypeText }}</span>
                </div>

                <div class="summary-list">
                    <div class="summary-row">
                        <span>账号 ID</span>
                        <strong :title="userInfo.userId">{{ userInfo.userId || '-' }}</strong>
                    </div>
                    <div class="summary-row">
                        <span>地区</span>
                        <strong :title="areaText">{{ areaText }}</strong>
                    </div>
                    <div class="summary-row">
                        <span>个性签名</span>
                        <strong class="summary-signature" :title="signatureText">{{ signatureText }}</strong>
                    </div>
                </div>
            </aside>

            <main class="account-content">
                <section class="setting-card">
                    <div class="card-header">
                        <div>
                            <h3>个人资料</h3>
                            <p>头像、昵称和资料会同步到聊天与联系人信息中。</p>
                        </div>
                        <el-button text @click="resetProfileForm">重置</el-button>
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
                        <div>
                            <h3>账号安全</h3>
                            <p>修改密码后会退出当前登录，需要重新登录。</p>
                        </div>
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
            </main>
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

const sexText = computed(() => {
    if (userInfo.value.sex === 1) {
        return '男';
    }
    if (userInfo.value.sex === 0) {
        return '女';
    }
    return '未设置';
});

const joinTypeText = computed(() => userInfo.value.joinType === 1 ? '需要验证' : '直接添加');
const areaText = computed(() => userInfo.value.areaName || '未设置');
const signatureText = computed(() => userInfo.value.personalSignature || '暂无个性签名');

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
    max-width: 980px;
}

.account-center {
    display: grid;
    grid-template-columns: 250px minmax(0, 1fr);
    gap: 18px;
    padding: 22px;
    box-sizing: border-box;
}

.account-summary,
.setting-card {
    background: #fff;
    border: 1px solid #e7e8eb;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04);
}

.account-summary {
    align-self: start;
    padding: 24px 18px;
    text-align: center;
}

.summary-avatar {
    width: 92px;
    height: 92px;
    margin: 0 auto 14px;
    overflow: hidden;
    border-radius: 10px;
    background: #eceff3;
}

.summary-name {
    font-size: 20px;
    font-weight: 600;
    color: #1f2937;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.summary-email {
    margin-top: 6px;
    color: #8a9099;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.summary-badges {
    display: flex;
    justify-content: center;
    gap: 8px;
    margin: 16px 0 18px;

    span {
        padding: 3px 9px;
        border-radius: 999px;
        background: #eef5ff;
        color: #4378c7;
        font-size: 12px;
    }
}

.summary-list {
    border-top: 1px solid #eef0f3;
    padding-top: 14px;
}

.summary-row {
    text-align: left;
    margin-top: 12px;

    span {
        display: block;
        margin-bottom: 5px;
        color: #9aa0a8;
        font-size: 12px;
    }

    strong {
        display: block;
        color: #3f4650;
        font-size: 14px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
}

.summary-signature {
    white-space: normal !important;
    display: -webkit-box !important;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
}

.account-content {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.setting-card {
    padding: 20px 22px 18px;
}

.card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 18px;

    h3 {
        margin: 0;
        color: #1f2937;
        font-size: 17px;
        font-weight: 600;
    }

    p {
        margin: 6px 0 0;
        color: #8a9099;
        font-size: 13px;
        line-height: 1.5;
    }
}

.profile-form,
.password-form {
    max-width: 560px;
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

.danger-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;

    h3 {
        margin: 0;
        color: #1f2937;
        font-size: 17px;
    }

    p {
        margin: 6px 0 0;
        color: #8a9099;
        font-size: 13px;
    }
}

@media (max-width: 980px) {
    .account-center {
        grid-template-columns: 220px minmax(0, 1fr);
        padding: 16px;
    }
}
</style>
