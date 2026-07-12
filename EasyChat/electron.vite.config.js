import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

const createRendererChunks = (id) => {
  const normalizedId = id.replace(/\\/g, '/')
  if (!normalizedId.includes('/node_modules/')) {
    return
  }

  // Element Plus 的登录核心和主应用组件通过动态 import 分开加载。
  // 不在这里强制合并，否则 Rollup 会把延迟组件重新并入首屏 vendor chunk。
  if (
    normalizedId.includes('/node_modules/element-plus/') ||
    normalizedId.includes('/node_modules/@element-plus/icons-vue/') ||
    normalizedId.includes('/node_modules/@imengyu/vue3-context-menu/')
  ) {
    return
  }

  if (
    normalizedId.includes('/node_modules/vue/') ||
    normalizedId.includes('/node_modules/@vue/') ||
    normalizedId.includes('/node_modules/pinia/') ||
    normalizedId.includes('/node_modules/vue-router/')
  ) {
    return 'vue-vendor'
  }

  return 'vendor'
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    build: {
      rollupOptions: {
        output: {
          manualChunks: createRendererChunks
        }
      }
    },
    css: {
      preprocessorOptions: {
        scss: {
          silenceDeprecations: ['legacy-js-api']
        }
      }
    },
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [vue()],
    server: {
      hmr: true,
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:5050',
          changeOrigin: true
        }
      }
    }
  }
})
