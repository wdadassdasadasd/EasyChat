<template>
    <ContactPanel class="apply-panel" :showTopBorder="true" :infinite-scroll-immediate="false" v-infinite-scroll="loadApply">
        <div class="apply-list" v-if="applyList.length > 0">
            <div class="apply-item" v-for="item in applyList" :key="item.applyId">
                <Avatar :width="48" :borderRadius="4" :userId="getApplyAvatarId(item)"></Avatar>
                <div class="contact-info">
                    <div class="name-row">
                        <span class="nick-name">{{ item.contactName }}</span>
                        <span :class="['contact-type', item.contactType==0?'user-contact':'group-contact']">
                            {{ item.contactType==0?'好友':'群聊' }}
                        </span>
                    </div>
                    <div class="apply-info">{{ item.applyInfo || '请求添加你为好友' }}</div>
                </div>
                <div class="op-btn">
                    <template v-if="item.status==0">
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
                    </template>
                    <template v-else>
                        <span class="result-name">{{ item.statusName }}</span>
                    </template>
                </div>
            </div>
        </div>
        <Blank v-else text="暂无申请"></Blank>
    </ContactPanel>
</template>

<script setup>

import { ref, getCurrentInstance } from 'vue';
import {useContactStateStore} from '../../stores/ContactStateStore';
import Blank from '../../components/Blank.vue';

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
const getApplyAvatarId = (item) => item.contactType == 0 ? getApplyUserId(item) : item.contactId;

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
</script>

<style lang="scss" scoped>
.apply-panel {
    :deep(.content-inner) {
        width: min(680px, calc(100% - 48px));
        padding-top: 18px;
    }

    :deep(.blank-page) {
        height: calc(100vh - 130px);
    }
}

.apply-list {
    color: #1f2329;
}

.apply-item {
    display: flex;
    align-items: center;
    min-height: 78px;
    gap: 14px;
    border-bottom: 1px solid #dedede;
}

.contact-info {
    flex: 1;
    min-width: 0;
}

.name-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
}

.nick-name {
    font-size: 16px;
    line-height: 22px;
    color: #111;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.contact-type {
    flex-shrink: 0;
    height: 18px;
    line-height: 18px;
    padding: 0 6px;
    border-radius: 3px;
    font-size: 12px;
    color: #fff;
    background: #4c9aff;

    &.user-contact {
        background: #07c160;
    }

    &.group-contact {
        background: #4c9aff;
    }
}

.apply-info {
    margin-top: 5px;
    font-size: 13px;
    line-height: 18px;
    color: #8c8c8c;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.op-btn {
    flex-shrink: 0;
    min-width: 86px;
    text-align: right;
}

.result-name {
    font-size: 14px;
    color: #8c8c8c;
}
</style>
