import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolveRuntimeConfig } from './src/shared/runtimeConfig.js'

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

const createCspTransformPlugin = (runtimeConfig) => ({
  name: 'easychat-runtime-csp',
  transformIndexHtml(html) {
    return html
      .replaceAll('__EASYCHAT_API_ORIGIN__', runtimeConfig.apiOrigin)
      .replaceAll('__EASYCHAT_WS_ORIGIN__', runtimeConfig.wsCspOrigin)
  }
})

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const runtimeConfig = resolveRuntimeConfig({
    apiOrigin: env.VITE_API_ORIGIN || env.VITE_PROD_DOMAIN,
    wsOrigin: env.VITE_WS_ORIGIN || env.VITE_PROD_WS_ORIGIN
  })
  const runtimeDefines = {
    __EASYCHAT_API_ORIGIN__: JSON.stringify(runtimeConfig.apiOrigin),
    __EASYCHAT_WS_ORIGIN__: JSON.stringify(runtimeConfig.wsOrigin)
  }

  return {
    main: {
      define: runtimeDefines,
      plugins: [externalizeDepsPlugin()]
    },
    preload: {
      define: runtimeDefines,
      plugins: [externalizeDepsPlugin()]
    },
    renderer: {
      define: runtimeDefines,
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
      plugins: [vue(), createCspTransformPlugin(runtimeConfig)],
      server: {
        hmr: true,
        port: 5173,
        proxy: {
          '/api': {
            target: runtimeConfig.apiOrigin,
            changeOrigin: true
          }
        }
      }
    }
  }
})
