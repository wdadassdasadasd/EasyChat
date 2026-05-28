import axios from 'axios'
import { ElLoading } from 'element-plus'
import Message from '../utils/Message'
import router from '@/router'
import { useUserInfoStore } from '@/stores/userInfoStore'
const contentTypeForm = 'application/x-www-form-urlencoded;charset=UTF-8'
const contentTypeJson = 'application/json'
const responseTypeJson = 'json'
let loading = null;
const envDomain = import.meta.env.VITE_DOMAIN;
const prodDomain = import.meta.env.VITE_PROD_DOMAIN || 'http://localhost:5050';
const baseDomain = import.meta.env.PROD ? (envDomain || prodDomain) : '';
const instance = axios.create({
    withCredentials: true,  //携带cookie
    baseURL: `${baseDomain}/api`,  //统一前缀
    timeout: 10 * 1000,
});

const resetLoginState = async () => {
    try {
        useUserInfoStore().clearUserInfo();
    } catch (e) {
        localStorage.removeItem('userInfo');
    }

    if (window.electron?.ipcRenderer?.invoke) {
        await window.electron.ipcRenderer.invoke('logout').catch(() => false);
    } else {
        window.ipcRenderer?.send('reLogin');
    }

    router.push('/login');
};

const isFileLike = (value) => {
    return value instanceof Blob || value instanceof File;
}

//请求前拦截器
instance.interceptors.request.use(
    (config) => {
        if (config.showLoading) {
            loading = ElLoading.service({
                lock: true,
                text: '加载中......',
                background: 'rgba(0, 0, 0, 0.7)',
            });
        }
        return config;
    },
    (error) => {
        if (error.config.showLoading && loading) {
            loading.close();
        }
        Message.error("请求发送失败");
        return Promise.reject("请求发送失败");
    }
);
//请求后拦截器
instance.interceptors.response.use(
    async (response) => {
        console.log('[Request调试] 响应URL:', response.config.url, '状态码:', response.status, '数据:', JSON.stringify(response.data));
        const { showLoading, errorCallback, showError = true, responseType } = response.config;
        if (showLoading && loading) {
            loading.close()
        }
        const responseData = response.data;
        if (responseType == "arraybuffer" || responseType == "blob") {
            return responseData;
        }
        //正常请求
        if (responseData.code == 200) {
            return responseData;
        } else if (responseData.code == 901) {
            await resetLoginState()
            return Promise.reject({ showError: false });
        } else {
            //其他错误
            if (errorCallback) {
                errorCallback(responseData);
            }
            return Promise.reject({ showError: showError, msg: responseData.info });
        }
    },
    (error) => {
        console.error('[Request调试] 网络错误:', error.message, 'URL:', error.config?.url);
        if (error.config.showLoading && loading) {
            loading.close();
        }
        return Promise.reject({ showError: true, msg: "网络异常" })
    }
);

//封装请求方法
const request = (config) => {
    const { url, params, dataType, showLoading = true, responseType = responseTypeJson, showError = true } = config;
    let contentType = contentTypeForm;
    let requestData = new URLSearchParams();
    const shouldUseFormData = Object.values(params || {}).some((value) => isFileLike(value));
    if (shouldUseFormData) {
        contentType = 'multipart/form-data';
        requestData = new FormData();
    }
    for (let key in params) {
        requestData.append(key, params[key] == undefined ? "" : params[key]);
    }
    if (dataType != null && dataType == 'json') {
        contentType = contentTypeJson;
    }
    let userInfoJson = localStorage.getItem('userInfo');
    let token = userInfoJson ? JSON.parse(userInfoJson).token : "";
    console.log('[Request调试] 请求URL:', url, 'Token:', token ? token.substring(0, 20) + '...' : '空');
    // 登录/注册/验证码接口不需要鉴权，避免携带脏 token 触发后端异常
    if (url && url.startsWith('/account/')) {
        token = "";
    }
    let headers = {
        'X-Requested-With': 'XMLHttpRequest',
        "token": token
    }
    if (!shouldUseFormData) {
        headers['Content-Type'] = contentType;
    }
    return instance.post(url, requestData, {
        onUploadProgress: (event) => {
            if (config.uploadProgressCallback) {
                config.uploadProgressCallback(event);
            }
        },
        responseType: responseType,
        headers: headers,
        showLoading: showLoading,
        errorCallback: config.errorCallback,
        showError: showError,
    }).catch(error => {
        if (error.showError) {
            Message.error(error.msg);
        }
        return null;
    });
};

export default request;
