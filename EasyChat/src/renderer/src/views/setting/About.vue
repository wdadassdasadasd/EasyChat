<template>
    <ContactPanel>

        <el-form :model="formData" @submit.prevent ref="formDataRef" label-width="80px" :rules="rules">
            <el-form-item label="版本信息">
                <div class="version-info">
                    <div>微信 1.0.0</div>
                    <div>
                        <el-button type="primary" @click="checkUpdate">检查更新</el-button>
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
            <el-form-item>
                <el-button type="primary" @click="changeFolder">更改</el-button>
                <el-button type="primary" @click="openLocalFolder">打开文件夹</el-button>
            </el-form-item>
           
        </el-form>
        
    </ContactPanel>
    
</template>


<script setup>
import { ref, getCurrentInstance, onMounted } from 'vue';

const {proxy}=getCurrentInstance();
const formDataRef=ref();
const formData=ref({});
const rules={};
const diagnostics=ref(null);
const diagnosticsLoading=ref(false);

const checkUpdate=()=>{
    proxy.Message.warning('当前已是最新版本');
}

const changeFolder=()=>{
    proxy.Message.warning('请在文件管理中修改文件保存位置');
}

const openLocalFolder=()=>{
    proxy.Message.warning('请在文件管理中打开文件夹');
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
