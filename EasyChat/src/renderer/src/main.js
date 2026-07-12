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

initializeRendererLogger()
const app = createApp(App)

installElementPlus(app)
app.use(router)
app.use(Pinia.createPinia())
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

app.mount('#app')
