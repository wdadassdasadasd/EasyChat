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
      // 保留已有的token，防止getUserInfo等接口返回的数据不含token导致token丢失
      let localUserInfo = null
      try {
        const json = localStorage.getItem('userInfo')
        localUserInfo = json ? JSON.parse(json) : null
      } catch (e) {
        console.error('Failed to parse userInfo from localStorage', e)
        localStorage.removeItem('userInfo')
      }
      const token = this.userInfo?.token || localUserInfo?.token
      if (!userInfo.token && token) {
        userInfo.token = token
      }
      this.userInfo = userInfo
      localStorage.setItem('userInfo', JSON.stringify(userInfo))
    },
    clearUserInfo() {
      this.userInfo = null
      localStorage.removeItem('userInfo')
    },
    getInfo() {
      if (!this.userInfo) {
        try {
          const json = localStorage.getItem('userInfo')
          this.userInfo = json ? JSON.parse(json) : null
        } catch (e) {
          console.error('Failed to parse userInfo from localStorage', e)
          localStorage.removeItem('userInfo')
          this.userInfo = null
        }
      }
      return this.userInfo
    }
  }
})
