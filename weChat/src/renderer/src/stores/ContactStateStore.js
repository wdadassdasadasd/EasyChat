//联系人列表刷新控制
import {defineStore} from 'pinia';

export const useContactStateStore=defineStore('contactStateInfo',{
    state:()=>{
        return {
            contactReload:null,
            delContactId:null,
        }
    },
    actions:{
        setContactReload(contactReload){
            this.contactReload=contactReload;
        },
       delContactId(contactId){
            this.delContactId=contactId;
        }}

})