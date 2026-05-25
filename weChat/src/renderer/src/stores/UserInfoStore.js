//用户信息管理
import {defineStore} from 'pinia';
export const useUserInfoStore=defineStore('userInfo',{
    state:()=>{
        return {
            userInfo:null,
        }
    },
    actions:{
        setUserInfo(userInfo){
            // 保留已有的token，防止getUserInfo等接口返回的数据不含token导致token丢失
            if (!userInfo.token && this.userInfo?.token) {
                userInfo.token = this.userInfo.token;
            }
            this.userInfo=userInfo;
            localStorage.setItem('userInfo',JSON.stringify(userInfo));
        },
        getInfo(){
            if(!this.userInfo){
                const json = localStorage.getItem('userInfo');
                this.userInfo = json ? JSON.parse(json) : null;
            }
            return this.userInfo;
        }
    }
})