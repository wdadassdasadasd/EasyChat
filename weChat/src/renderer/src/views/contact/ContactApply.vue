<template>
    <ContactPanel :showTopBorder="true" :infinite-scroll-immediate="false" v-infinite-scroll="loadApply">
        <div>
            <div class="apply-item" v-for="item in applyList" :key="item.applyId">
                <div :class="['contactType',item.contactType==0?'user-contact':'']">
                    {{ item.contactType==0?'好友':'群' }}
                </div>
                <Avatar :width="50" :userId="item.userId"></Avatar>
                <div class="contact-info">
                    <div class="nick-name">{{ item.contactName }}</div>
                    <div class="apply-info">{{ item.applyInfo }}</div>
                 </div>
                <div class="op-btn">
                    <div v-if="item.status==0">
                        <el-dropdown placement="bottom" trigger="hover">
                        <span class="el-dropdown-link">
                            <el-button type="primary" size="small">接受</el-button>
                        </span>
                        <template #dropdown>
                            <el-dropdown-menu>
                                <el-dropdown-item @click="dealWithApply(item.applyId,item.contactType,1)">同意</el-dropdown-item>
                                <el-dropdown-item @click="dealWithApply(item.applyId,item.contactType,2)">拒绝</el-dropdown-item>
                                <el-dropdown-item @click="dealWithApply(item.applyId,item.contactType,3)">拉黑</el-dropdown-item>
                            </el-dropdown-menu>
                        </template>
                        </el-dropdown>
                    </div>
                    <div v-else class="result-name">
                        {{ item.statusName }}
                    </div>
                </div>
            </div>
        </div>
        <div v-if="applyList.length==0" class="no-data">暂无申请</div>
    </ContactPanel>
</template>

<script setup>

import { ref, getCurrentInstance } from 'vue';
import {useContactStateStore} from '../../stores/ContactStateStore';

const { proxy } = getCurrentInstance();
const contactStateStore = useContactStateStore();
const applyList = ref([]);
const friendContactIds = ref(new Set());
let pageNo=0;
let pageTotal=1;

const loadFriendContactIds = async () => {
    const result = await proxy.Request({
        url: proxy.Api.loadContact,
        params: {
            contactType: 'USER'
        }
    });
    if (!result) {
        return;
    }
    friendContactIds.value = new Set((result.data || []).map((item) => item.contactId));
}

const getApplyUserId = (item) => item.applyUserId || item.userId || item.contactId;

const filterHandledFriendApply = (list = []) => {
    return list.filter((item) => {
        const isPendingFriendApply = item.contactType == 0 && item.status == 0;
        return !(isPendingFriendApply && friendContactIds.value.has(getApplyUserId(item)));
    });
}

// 加载申请列表
const loadApply = async () => {
    pageNo++;
    if(pageNo>pageTotal){
        return;
    }
    let result = await proxy.Request({
        url: proxy.Api.loadApply,
        params: {
            
        }
    })
    if (!result) {
        return;
    }
    pageTotal = result.data.totalPage;
    if(result.data.pageNo==1){
        applyList.value=[];
    }
    const list = filterHandledFriendApply(result.data.list);
    applyList.value = result.data.pageNo == 1 ? list : applyList.value.concat(list);
    pageNo = result.data.pageNo;
  
}

const init = async () => {
    await loadFriendContactIds();
    loadApply();
}
init();

// 处理申请
const dealWithApply = async (applyId,contactType,status) => {
    proxy.Confirm({
        message: '确定要执行此操作吗？',
        okfun: async () => {
            let result = await proxy.Request({
                url: proxy.Api.dealWithApply,
                params: {
                    applyId,
                    contactType,
                    status
                }
            })
            if (!result) {
                return;
            }
            //重置分页，再刷新
            pageNo=0;
            if(contactType==0&&status==1){
                await loadFriendContactIds();
            }
            loadApply();
            //同意好友申请，刷新好友列表
            if(contactType==0&&status==1){
                contactStateStore.setContactReload('USER');
            }
            //同意群聊申请，刷新群聊列表
            else if(contactType==1&&status==1){
                contactStateStore.setContactReload('GROUP');
            }
        }
    })
}
//todo 监听新朋友数量改变
</script>

<style lang="scss" scoped>
</style>
