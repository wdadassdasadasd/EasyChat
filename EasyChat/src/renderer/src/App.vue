<template>
  <el-config-provider :locale="locale">
    <router-view></router-view>
  </el-config-provider>




  
</template>

<script setup>
import { onErrorCaptured } from 'vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'

const locale = zhCn

// 全局错误边界，防止未捕获的组件异常导致白屏。
onErrorCaptured((err, instance, info) => {
  console.error('[App ErrorBoundary]', err, 'component:', instance?.$.type?.name || '<anonymous>', 'info:', info)
  // 返回 false 阻止错误继续向上传播
  return false
})
</script>

<style lang="scss">
</style>
