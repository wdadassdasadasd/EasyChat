import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [vue()],
    server:{
      hmr:true,
      port:5173,
      proxy:{
        "/api":{
          target:"http://localhost:5050",
          changeOrigin:true,
         pathRewrite:{
            "^/api":"/api"
         }
        }
      }
    }
  }
})
