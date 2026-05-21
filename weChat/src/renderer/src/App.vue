<template>
  <el-config-provider :locale="locale">
    <router-view></router-view>
  </el-config-provider>




  
</template>

<script setup>
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { reactive } from 'vue'

const locale = zhCn
const config = reactive({
  max: 1
})
</script>

<style lang="less">



</style>