<template>
    <ContactPanel class="file-panel">
        <div class="file-manage-page" v-loading="loading">
            <section class="folder-card">
                <div class="folder-main">
                    <div class="folder-icon">
                        <el-icon><FolderOpened /></el-icon>
                    </div>
                    <div class="folder-info">
                        <div class="folder-title">本地文件保存位置</div>
                        <div class="folder-path" :title="folderInfo.localFileFolder">
                            {{ folderInfo.localFileFolder || '-' }}
                        </div>
                    </div>
                </div>
                <div class="folder-actions">
                    <el-button type="primary" @click="changeFolder">更改</el-button>
                    <el-button @click="openLocalFolder">打开文件夹</el-button>
                    <el-button text :disabled="folderInfo.isDefault" @click="resetFolder">恢复默认</el-button>
                </div>
            </section>

            <section class="stats-grid">
                <div class="stat-card">
                    <span>文件数量</span>
                    <strong>{{ folderInfo.fileCount || 0 }}</strong>
                </div>
                <div class="stat-card">
                    <span>占用空间</span>
                    <strong>{{ formatFileSize(folderInfo.totalSize) }}</strong>
                </div>
                <div class="stat-card">
                    <span>目录状态</span>
                    <strong>{{ folderInfo.exists ? '正常' : '未创建' }}</strong>
                </div>
            </section>

            <section class="setting-card">
                <div class="setting-row">
                    <div>
                        <h3>默认目录</h3>
                        <p :title="folderInfo.defaultFolder">{{ folderInfo.defaultFolder || '-' }}</p>
                    </div>
                    <el-tag v-if="folderInfo.isDefault" type="success">当前使用</el-tag>
                    <el-tag v-else>自定义</el-tag>
                </div>
                <div class="setting-row">
                    <div>
                        <h3>文件来源</h3>
                        <p>聊天文件、图片和头像都通过后端文件接口下载，本页管理本机保存目录。</p>
                    </div>
                </div>
            </section>
        </div>
    </ContactPanel>
</template>

<script setup>
import { getCurrentInstance, ref } from 'vue';

const { proxy } = getCurrentInstance();
const loading = ref(false);
const folderInfo = ref({
    localFileFolder: '',
    defaultFolder: '',
    isDefault: false,
    exists: false,
    fileCount: 0,
    totalSize: 0
});

const invokeFolder = async (channel) => {
    if (!window.electron?.ipcRenderer?.invoke) {
        proxy.Message.error('当前环境不支持文件夹操作');
        return null;
    }
    return await window.electron.ipcRenderer.invoke(channel);
};

const loadFolderInfo = async () => {
    loading.value = true;
    try {
        const result = await invokeFolder('getLocalFileFolder');
        if (result) {
            folderInfo.value = result;
        }
    } finally {
        loading.value = false;
    }
};

const changeFolder = async () => {
    const oldPath = folderInfo.value.localFileFolder;
    loading.value = true;
    try {
        const result = await invokeFolder('changeLocalFileFolder');
        if (!result) {
            return;
        }
        folderInfo.value = result;
        if (result.localFileFolder !== oldPath) {
            proxy.Message.success('文件保存位置已更新');
        }
    } finally {
        loading.value = false;
    }
};

const openLocalFolder = async () => {
    loading.value = true;
    try {
        const result = await invokeFolder('openLocalFileFolder');
        if (!result) {
            return;
        }
        folderInfo.value = result;
        if (!result.success) {
            proxy.Message.error(result.error || '打开文件夹失败');
        }
    } finally {
        loading.value = false;
    }
};

const resetFolder = async () => {
    loading.value = true;
    try {
        const result = await invokeFolder('resetLocalFileFolder');
        if (result) {
            folderInfo.value = result;
            proxy.Message.success('已恢复默认位置');
        }
    } finally {
        loading.value = false;
    }
};

const formatFileSize = (size) => {
  return proxy.Utils.formatFileSize(size || 0)
}

loadFolderInfo();
</script>

<style lang="scss" scoped>
:deep(.content-panel) {
    height: calc(100vh - 60px);
    background: #f4f5f7;
}

:deep(.content-inner) {
    width: 100%;
    max-width: 860px;
}

.file-manage-page {
    padding: 22px;
    box-sizing: border-box;
}

.folder-card,
.setting-card,
.stat-card {
    background: #fff;
    border: 1px solid #e7e8eb;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04);
}

.folder-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    padding: 22px;
}

.folder-main {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 16px;
}

.folder-icon {
    width: 56px;
    height: 56px;
    flex: 0 0 56px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    background: #eef5ff;
    color: #4378c7;

    .el-icon {
        font-size: 28px;
    }
}

.folder-info {
    min-width: 0;
}

.folder-title {
    color: #1f2937;
    font-size: 18px;
    font-weight: 600;
}

.folder-path {
    margin-top: 8px;
    max-width: 460px;
    color: #69717d;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.folder-actions {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
}

.stats-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
    margin-top: 14px;
}

.stat-card {
    padding: 18px;

    span {
        display: block;
        color: #8a9099;
        font-size: 13px;
    }

    strong {
        display: block;
        margin-top: 8px;
        color: #1f2937;
        font-size: 22px;
        font-weight: 600;
    }
}

.setting-card {
    margin-top: 14px;
    padding: 6px 22px;
}

.setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    padding: 18px 0;
    border-bottom: 1px solid #eef0f3;

    &:last-child {
        border-bottom: 0;
    }

    h3 {
        margin: 0;
        color: #1f2937;
        font-size: 16px;
        font-weight: 600;
    }

    p {
        margin: 6px 0 0;
        max-width: 600px;
        color: #8a9099;
        font-size: 13px;
        line-height: 1.5;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
}

@media (max-width: 920px) {
    .folder-card {
        align-items: flex-start;
        flex-direction: column;
    }

    .folder-actions {
        width: 100%;
        justify-content: flex-start;
    }
}
</style>
