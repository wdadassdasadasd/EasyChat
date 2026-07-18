//用户信息管理
import { defineStore } from 'pinia'
export const useUserInfoStore = defineStore('userInfo', {
  state: () => {
    return {
      userInfo: null
    }
  },
  actions: {
    setUserInfo(userInfo) {
      // token 仅存在 renderer 内存；跨重启恢复由主进程 safeStorage 负责。
      const token = userInfo?.token || this.userInfo?.token || ''
      this.userInfo = { ...(userInfo || {}), ...(token ? { token } : {}) }
    },
    clearUserInfo() {
      this.userInfo = null
    },
    getInfo() {
      return this.userInfo
    }
  }
})
