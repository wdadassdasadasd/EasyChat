<template>
  <div v-if="bootstrapPhase !== 'ready'" class="bootstrap-screen">
    <div class="bootstrap-card">
      <div class="bootstrap-spinner" aria-hidden="true"></div>
      <template v-if="bootstrapPhase === 'failed'">
        <p>{{ bootstrapError }}</p>
        <button type="button" @click="retryFailedBootstrap">重试</button>
      </template>
      <p v-else>正在恢复会话…</p>
    </div>
  </div>
  <el-config-provider v-else :locale="locale">
    <router-view></router-view>
  </el-config-provider>
  
</template>

<script setup>
import { onErrorCaptured } from 'vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { bootstrapError, bootstrapPhase, retryFailedBootstrap } from '@/utils/appBootstrapState'

const locale = zhCn

// 全局错误边界，防止未捕获的组件异常导致白屏。
onErrorCaptured((err, instance, info) => {
  console.error('[App ErrorBoundary]', err, 'component:', instance?.$.type?.name || '<anonymous>', 'info:', info)
  // 返回 false 阻止错误继续向上传播
  return false
})
</script>

<style lang="scss">
.bootstrap-screen {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f5;
  color: #666;
}

.bootstrap-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  font-size: 14px;
}

.bootstrap-card p {
  margin: 0;
}

.bootstrap-card button {
  min-width: 76px;
  height: 30px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  background: #fff;
  color: #333;
  cursor: pointer;
}

.bootstrap-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid #d9d9d9;
  border-top-color: #07c160;
  border-radius: 50%;
  animation: bootstrap-spin 0.8s linear infinite;
}

@keyframes bootstrap-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
