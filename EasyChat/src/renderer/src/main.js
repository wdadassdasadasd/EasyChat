import { createApp, defineAsyncComponent } from 'vue'
import App from './App.vue'

import '@imengyu/vue3-context-menu/lib/vue3-context-menu.css'
import './assets/base.scss'
import '@/utils/elementPlusCoreStyles'
import './assets/cust-elementplus.scss'
import * as Pinia from 'pinia'
import { ensureElementPlusAppFeatures, installElementPlus } from '@/utils/elementPlus'
import router from '@/router'
import Utils from '@/utils/Utils.js'
import Verify from '@/utils/Verify.js'
import Message from '@/utils/Message.js'
import Api from '@/utils/Api.js'
import Request from '@/utils/Request.js'
import WinOp from './components/WinOp.vue'
import { Confirm } from './utils/Confirm.js'
import { initializeRendererLogger } from './utils/Logger.js'
import { useUserInfoStore } from '@/stores/UserInfoStore'
import { beginBootstrap, completeBootstrap, failBootstrap } from '@/utils/appBootstrapState'
import { markPerformance } from '@/utils/performanceMetrics'

initializeRendererLogger()
const app = createApp(App)

installElementPlus(app)
const pinia = Pinia.createPinia()
app.use(pinia)
app.use(router)
app.component('Layout', defineAsyncComponent(() => import('./components/Layout.vue')))
app.component('WinOp', WinOp)
app.component('ContactPanel', defineAsyncComponent(() => import('./components/ContactPanel.vue')))
app.component('ShowLocalImage', defineAsyncComponent(() => import('./components/ShowLocalImage.vue')))
app.component('UserBaseInfo', defineAsyncComponent(() => import('./components/UserBaseInfo.vue')))
app.component('AppDialog', defineAsyncComponent(() => import('./components/Dialog.vue')))
app.component('Avatar', defineAsyncComponent(() => import('./components/Avatar.vue')))
app.component('AvatarBase', defineAsyncComponent(() => import('./components/AvatarBase.vue')))
app.component('AvatarUpload', defineAsyncComponent(() => import('./components/AvatarUpload.vue')))

app.config.globalProperties.Utils = Utils
app.config.globalProperties.Verify = Verify
app.config.globalProperties.Request = Request
app.config.globalProperties.Api = Api
app.config.globalProperties.Message = Message
app.config.globalProperties.Confirm = Confirm

router.beforeEach(async (to) => {
  if (to.path === '/' || to.path === '/login') {
    return true
  }
  try {
    await ensureElementPlusAppFeatures(app)
    return true
  } catch (error) {
    console.error('Failed to load application UI features', error)
    Message.error('应用组件加载失败，请重试。')
    return false
  }
})

const bootstrap = async () => {
  beginBootstrap()
  const userInfoStore = useUserInfoStore(pinia)
  // Start the authenticated UI bundle while the secure store is being read.
  // Login routing never waits for this promise, but a restored session can use it immediately.
  const appFeaturesPromise = ensureElementPlusAppFeatures(app)
  void appFeaturesPromise.catch((error) => {
    console.warn('Failed to preload application UI features', error)
  })
  try {
    window.localStorage.removeItem('userInfo')
  } catch {
    // Storage may be disabled; the in-memory store never consumes this legacy value.
  }

  let result
  try {
    result = await window.api?.invokeRestoreAuthenticatedSession?.()
  } catch (error) {
    console.warn('Failed to restore secure session', error)
    userInfoStore.clearUserInfo()
    await router.replace('/login')
    completeBootstrap()
    return
  }

  if (result?.success && result.userInfo?.token) {
    userInfoStore.setUserInfo(result.userInfo)
    markPerformance('authenticated-session-restored')
    try {
      await appFeaturesPromise
      await router.replace('/chat')
      completeBootstrap()
      markPerformance('initial-route-ready')
    } catch (error) {
      console.error('Failed to load application UI features', error)
      userInfoStore.clearUserInfo()
      failBootstrap('应用界面加载失败，请重试。', () => void bootstrap())
    }
  } else {
    userInfoStore.clearUserInfo()
    await router.replace('/login')
    completeBootstrap()
  }
}

app.mount('#app')
markPerformance('renderer-mounted')
void bootstrap()
