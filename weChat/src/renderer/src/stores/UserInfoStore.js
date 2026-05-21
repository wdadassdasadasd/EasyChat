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