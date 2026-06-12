import axios from 'axios'
import { ElLoading } from 'element-plus'
import Message from '../utils/Message'
import router from '@/router'
import { useUserInfoStore } from '@/stores/UserInfoStore'
const contentTypeForm = 'application/x-www-form-urlencoded;charset=UTF-8'
const contentTypeJson = 'application/json'
const responseTypeJson = 'json'
let loading = null
let loadingCount = 0
// A-4: 请求去重缓存 — 相同 url+params 的并发请求复用 pending Promise，避免重复请求
const inFlightCache = new Map()
// H-7: loading 状态安全操作，确保 close 异常不破坏计数
const showLoadingIfNeeded = () => {
  if (!loading) {
    loading = ElLoading.service({
      lock: true,
      text: '加载中......',
      background: 'rgba(0, 0, 0, 0.7)'
    })
  }
  loadingCount += 1
}
const hideLoadingIfDone = () => {
  loadingCount -= 1
  if (loadingCount <= 0) {
    try {
      loading?.close()
    } catch (e) {
      // Loading cleanup is best effort during navigation and teardown.
    }
    loading = null
    loadingCount = 0
  }
}
const envDomain = import.meta.env.VITE_DOMAIN
const prodDomain = import.meta.env.VITE_PROD_DOMAIN || 'http://localhost:5050'
const baseDomain = import.meta.env.PROD ? envDomain || prodDomain : ''
const instance = axios.create({
  withCredentials: true, //携带cookie
  baseURL: `${baseDomain}/api`, //统一前缀
  timeout: 10 * 1000
})

export const getApiUrl = (url = '') => {
  if (/^https?:\/\//i.test(url)) {
    return url
  }
  return `${baseDomain}/api${url}`
}

const resetLoginState = async () => {
  try {
    useUserInfoStore().clearUserInfo()
  } catch (e) {
    localStorage.removeItem('userInfo')
  }

  await window.api?.invokeLogout().catch(() => false)

  router.push('/login')
}

const isFileLike = (value) => {
  return value instanceof Blob || value instanceof File
}

const getErrorKind = (error = {}) => {
  if (error.kind) {
    return error.kind
  }
  if (error.code === 'ERR_CANCELED' || error.name === 'CanceledError') {
    return 'canceled'
  }
  if (error.code === 'ECONNABORTED' || /timeout/i.test(error.message || '')) {
    return 'timeout'
  }
  if (error.response?.status) {
    return 'http_status'
  }
  return 'network'
}

const normalizeRequestError = (error = {}, fallbackUrl = '') => {
  const kind = getErrorKind(error)
  return {
    success: false,
    kind,
    code: error.code ?? error.response?.data?.code,
    msg:
      error.msg ||
      error.response?.data?.info ||
      error.response?.data?.message ||
      error.message ||
      '网络异常',
    status: error.status ?? error.response?.status,
    url: error.url || error.config?.url || fallbackUrl
  }
}

//请求前拦截器
instance.interceptors.request.use(
  (config) => {
    if (config.showLoading) {
      showLoadingIfNeeded()
    }
    return config
  },
  (error) => {
    if (error.config?.showLoading) {
      hideLoadingIfDone()
    }
    Message.error('请求发送失败')
    return Promise.reject({
      kind: 'network',
      showError: true,
      msg: '请求发送失败',
      config: error.config
    })
  }
)
//请求后拦截器
instance.interceptors.response.use(
  async (response) => {
    if (import.meta.env.DEV) {
      console.log('[Request调试] 响应URL:', response.config.url, '状态码:', response.status)
    }
    const { showLoading, errorCallback, showError = true, responseType } = response.config
    if (showLoading) {
      hideLoadingIfDone()
    }
    const responseData = response.data
    if (responseType == 'arraybuffer' || responseType == 'blob') {
      return responseData
    }
    //正常请求
    if (responseData.code == 200) {
      return responseData
    } else if (responseData.code == 901) {
      await resetLoginState()
      return Promise.reject({
        showError: false,
        kind: 'auth_expired',
        msg: responseData.info || '登录已过期',
        code: responseData.code,
        status: response.status,
        url: response.config?.url
      })
    } else {
      //其他错误
      if (errorCallback) {
        errorCallback(responseData)
      }
      // M-12: errorCallback 已调用时不再重复弹窗
      return Promise.reject({
        kind: 'api_code',
        showError: errorCallback ? false : showError,
        msg: responseData.info,
        code: responseData.code,
        status: response.status,
        url: response.config?.url
      })
    }
  },
  (error) => {
    console.error('[Request调试] 网络错误:', error.message, 'URL:', error.config?.url)
    if (error.config?.showLoading) {
      hideLoadingIfDone()
    }
    const kind = getErrorKind(error)
    const msg =
      kind === 'timeout'
        ? '请求超时'
        : kind === 'canceled'
          ? '请求已取消'
          : error.response?.data?.info || error.response?.data?.message || '网络异常'
    return Promise.reject({
      kind,
      showError: kind === 'canceled' ? false : (error.config?.showError ?? true),
      msg,
      code: error.code || error.response?.data?.code,
      status: error.response?.status,
      url: error.config?.url,
      config: error.config
    })
  }
)

//封装请求方法
const request = (config) => {
  const {
    url,
    params,
    dataType,
    showLoading = true,
    responseType = responseTypeJson,
    showError = true,
    timeout,
    signal,
    returnError = false
  } = config
  let contentType = contentTypeForm
  let requestData = new URLSearchParams()
  const shouldUseFormData = Object.values(params || {}).some((value) => isFileLike(value))
  if (shouldUseFormData) {
    contentType = 'multipart/form-data'
    requestData = new FormData()
  }
  for (let key in params) {
    requestData.append(key, params[key] == undefined ? '' : params[key])
  }
  if (dataType != null && dataType == 'json') {
    contentType = contentTypeJson
  }
  let userInfoJson = localStorage.getItem('userInfo')
  let token = ''
  if (userInfoJson) {
    try {
      token = JSON.parse(userInfoJson).token || ''
    } catch (e) {
      console.error('Failed to parse userInfo from localStorage, clearing corrupted data', e)
      localStorage.removeItem('userInfo')
    }
  }
  if (import.meta.env.DEV) {
    console.log(
      '[Request调试] 请求URL:',
      url,
      'Token:',
      token ? token.substring(0, 8) + '...' : '空'
    )
  }
  // 登录/注册/验证码接口不需要鉴权，避免携带脏 token 触发后端异常
  if (url && url.startsWith('/account/')) {
    token = ''
  }
  let headers = {
    'X-Requested-With': 'XMLHttpRequest',
    token: token
  }
  if (!shouldUseFormData) {
    headers['Content-Type'] = contentType
  }

  // A-4: 请求去重 — FormData/带 signal 的请求不缓存（含文件或需手动取消）
  let dedupKey = null
  if (!shouldUseFormData && !signal) {
    try {
      dedupKey = `${url}::${JSON.stringify(params || {})}`
    } catch (e) {
      // 参数中包含不可序列化的值（循环引用等），跳过缓存
      dedupKey = null
    }
    if (dedupKey) {
      const pending = inFlightCache.get(dedupKey)
      if (pending) {
        return pending
      }
    }
  }

  const clearDedup = () => {
    if (dedupKey) {
      inFlightCache.delete(dedupKey)
    }
  }

  const promise = instance
    .post(url, requestData, {
      onUploadProgress: (event) => {
        if (config.uploadProgressCallback) {
          config.uploadProgressCallback(event)
        }
      },
      onDownloadProgress: (event) => {
        if (config.downloadProgressCallback) {
          config.downloadProgressCallback(event)
        }
      },
      responseType: responseType,
      signal,
      timeout: timeout ?? instance.defaults.timeout,
      headers: headers,
      showLoading: showLoading,
      errorCallback: config.errorCallback,
      showError: showError
    })
    .then((response) => {
      clearDedup()
      return response
    })
    .catch((error) => {
      clearDedup()
      const normalizedError = normalizeRequestError(error, url)
      // M-11: 记录错误码便于调试，保持 null 返回维持向后兼容
      if (normalizedError.code || normalizedError.status || normalizedError.kind) {
        console.error(
          `[Request] ${url} failed kind=${normalizedError.kind}, code=${normalizedError.code || '-'}, status=${normalizedError.status || '-'}, error=${normalizedError.msg || '-'}`
        )
      }
      if (error.showError) {
        Message.error(error.msg)
      }
      return returnError ? normalizedError : null
    })

  if (dedupKey) {
    inFlightCache.set(dedupKey, promise)
  }
  return promise
}

export default request
