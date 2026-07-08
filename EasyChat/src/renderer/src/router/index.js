import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: '默认路径',
      redirect: '/login'
    },
    {
      path: '/login',
      name: '登录',
      component: () => import('@/views/Login.vue')
    },
    {
      path: '/main',
      redirect: '/chat',
      name: '主页面',
      component: () => import('@/views/Main.vue'),
      children: [
        {
          path: '/chat',
          name: '聊天',
          component: () => import('@/views/chat/Chat.vue')
        },
        {
          path: '/contact',
          redirect: '/contact/Blank',
          name: '联系人',
          component: () => import('@/views/contact/Contact.vue'),
          children: [
            {
              path: '/contact/Blank',
              name: '空白页',
              component: () => import('@/views/contact/BlankPage.vue')
            },
            {
              path: '/contact/search',
              name: '搜好友',
              component: () => import('@/views/contact/Search.vue')
            },
            {
              path: '/contact/contactNotice',
              name: '新的朋友',
              component: () => import('@/views/contact/ContactApply.vue')
            },
            {
              path: '/contact/createGroup',
              name: '新建群聊',
              component: () => import('@/views/contact/GroupEditForm.vue')
            },
            {
              path: '/contact/groupDetail',
              name: '群组详情',
              component: () => import('@/views/contact/GroupDetail.vue')
            },
            {
              path: '/contact/userDetail',
              name: '好友详情',
              component: () => import('@/views/contact/UserDetail.vue')
            }
          ]
        },
        {
          path: '/setting',
          redirect: '/setting/userinfo',
          name: '设置',
          component: () => import('@/views/setting/Setting.vue'),
          children: [
            {
              path: '/setting/userinfo',
              name: '个人信息',
              component: () => import('@/views/setting/UserInfo.vue')
            },
            {
              path: '/setting/fileManage',
              name: '文件管理',
              component: () => import('@/views/setting/FileManage.vue')
            },
            {
              path: '/setting/about',
              name: '关于',
              component: () => import('@/views/setting/About.vue')
            }
          ]
        }
      ]
    }
  ]
})

// 导航守卫：访问需要登录的页面时检查本地 token。
router.beforeEach((to) => {
  if (to.path === '/login' || to.path === '/') {
    return true
  }
  try {
    const stored = localStorage.getItem('userInfo')
    if (!stored) {
      return { path: '/login' }
    }
    const userInfo = JSON.parse(stored)
    if (!userInfo?.token) {
      return { path: '/login' }
    }
  } catch {
    return { path: '/login' }
  }
  return true
})

export default router
