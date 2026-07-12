import {
  ElButton,
  ElConfigProvider,
  ElForm,
  ElFormItem,
  ElIcon,
  ElInput
} from 'element-plus'

// 登录页和 App 根节点需要同步可用的最小组件集合。
const elementPlusPlugins = [
  ElConfigProvider,
  ElForm,
  ElFormItem,
  ElInput,
  ElButton,
  ElIcon
]

export const installElementPlus = (app) => {
  elementPlusPlugins.forEach((plugin) => app.use(plugin))
  return app
}

let appFeaturesPromise = null

// 仅在离开登录页时加载主应用的组件与样式，避免冷启动加载聊天/设置能力。
export const ensureElementPlusAppFeatures = (app) => {
  if (!appFeaturesPromise) {
    appFeaturesPromise = Promise.all([
      import('./elementPlusAppFeatures'),
      import('./elementPlusAppStyles')
    ])
      .then(([{ installElementPlusAppFeatures }]) => installElementPlusAppFeatures(app))
      .catch((error) => {
        appFeaturesPromise = null
        throw error
      })
  }
  return appFeaturesPromise
}

export { elementPlusPlugins }

export default installElementPlus
