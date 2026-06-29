import { createApp } from 'vue'
import App from './App.vue'

import '@imengyu/vue3-context-menu/lib/vue3-context-menu.css'
import './assets/base.scss'
import '@/utils/elementPlusStyles'
import './assets/cust-elementplus.scss'
import * as Pinia from 'pinia'
import { installElementPlus } from '@/utils/elementPlus'
import router from '@/router'
import Utils from '@/utils/Utils.js'
import Verify from '@/utils/Verify.js'
import Message from '@/utils/Message.js'
import Api from '@/utils/Api.js'
import Request from '@/utils/Request.js'
import Layout from './components/Layout.vue'
import WinOp from './components/WinOp.vue'
import ContactPanel from './components/ContactPanel.vue'
import ShowLocalImage from './components/ShowLocalImage.vue'
import UserBaseInfo from './components/UserBaseInfo.vue'
import Dialog from './components/Dialog.vue'
import Avatar from './components/Avatar.vue'
import AvatarBase from './components/AvatarBase.vue'
import AvatarUpload from './components/AvatarUpload.vue'
import { Confirm } from './utils/Confirm.js'
import { initializeRendererLogger } from './utils/Logger.js'

initializeRendererLogger()
const app = createApp(App)

installElementPlus(app)
app.use(router)
app.use(Pinia.createPinia())
app.component('Layout', Layout)
app.component('WinOp', WinOp)
app.component('ContactPanel', ContactPanel)
app.component('ShowLocalImage', ShowLocalImage)
app.component('UserBaseInfo', UserBaseInfo)
app.component('AppDialog', Dialog)
app.component('Avatar', Avatar)
app.component('AvatarBase', AvatarBase)
app.component('AvatarUpload', AvatarUpload)

app.config.globalProperties.Utils = Utils
app.config.globalProperties.Verify = Verify
app.config.globalProperties.Request = Request
app.config.globalProperties.Api = Api
app.config.globalProperties.Message = Message
app.config.globalProperties.Confirm = Confirm
app.mount('#app')
