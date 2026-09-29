<template>
    <ContactPanel>

        <el-form :model="formData" @submit.prevent ref="formDataRef" label-width="80px" :rules="rules">
            <el-form-item label="版本信息">
                <div class="version-info">
                    <div>EasyChat 1.0.0</div>
                    <div>
                        <el-button type="primary" @click="checkUpdate" :loading="updateLoading">检查更新</el-button>
                        <el-button @click="loadDiagnostics" :loading="diagnosticsLoading">刷新诊断</el-button>
                    </div>
                 
                </div>
            </el-form-item>
            <el-form-item v-if="diagnostics" label="运行诊断">
                <div class="diagnostics">
                    <div>数据库：{{ diagnostics.database.ready ? '已就绪' : '未就绪' }}，写队列 {{ diagnostics.database.writeQueueSize }}</div>
                    <div>WebSocket：{{ diagnostics.websocket.status }}，重连 {{ diagnostics.websocket.reconnectCount }} 次</div>
                    <div>上传：活动 {{ diagnostics.uploads.activeUploadCount }}，等待确认 {{ diagnostics.uploads.pendingAckCount }}</div>
                    <template v-if="diagnostics.synchronization">
                        <div>
                            事件同步：{{ diagnostics.synchronization.eventSync.state }}，失败 {{ diagnostics.synchronization.eventSync.failureCount }} 次，错误 {{ diagnostics.synchronization.eventSync.lastErrorKind }}
                        </div>
                        <div>
                            读取回执：{{ diagnostics.synchronization.readReceipt.state }}，待处理 {{ diagnostics.synchronization.readReceipt.pendingCount }}，失败 {{ diagnostics.synchronization.readReceipt.failureCount }} 次，错误 {{ diagnostics.synchronization.readReceipt.lastErrorKind }}
                        </div>
                    </template>
                    <div>安全会话：{{ diagnostics.secureSession.available ? '可用' : '不可用' }}</div>
                </div>
            </el-form-item>
        </el-form>
        
    </ContactPanel>
    
</template>


<script setup>
import { ref, getCurrentInstance, onMounted } from 'vue';
import { useUserInfoStore } from '../../stores/UserInfoStore';
import { checkAvailableVersion } from './aboutVersion';

const {proxy}=getCurrentInstance();
const userInfoStore=useUserInfoStore();
const formDataRef=ref();
const formData=ref({});
const rules={};
const diagnostics=ref(null);
const diagnosticsLoading=ref(false);
const updateLoading=ref(false);

const checkUpdate=async()=>{
    updateLoading.value=true;
    try {
        const state=await checkAvailableVersion({
            request:proxy.Request,
            url:proxy.Api.checkVersion,
            appVersion:'1.0.0',
            userId:userInfoStore.getInfo()?.userId
        });
        if (state.kind==='latest') {
            proxy.Message.success('当前已是最新版本');
        } else if (state.kind==='available') {
            proxy.Message.warning(`发现新版本 ${state.update.version || ''}，请联系管理员获取安装包`);
        } else {
            proxy.Message.warning('检查更新失败，请确认服务连接后重试');
        }
    } finally {
        updateLoading.value=false;
    }
}

const loadDiagnostics=async()=>{
    diagnosticsLoading.value=true;
    try {
        const result=await window.api?.invokeGetRuntimeDiagnostics?.();
        if (!result?.success) {
            proxy.Message.warning(result?.error||'诊断信息暂不可用');
            return;
        }
        diagnostics.value=result;
    } catch (error) {
        proxy.Message.warning('诊断信息加载失败');
    } finally {
        diagnosticsLoading.value=false;
    }
}

onMounted(loadDiagnostics);

</script>

<style lang="scss" scoped>
.diagnostics {
    line-height: 1.8;
    color: #606266;
}


</style>
