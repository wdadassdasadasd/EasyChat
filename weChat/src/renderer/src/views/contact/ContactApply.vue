<template>
    <ContactPanel :showTopBorder="true" :infinite-scroll-immediate="false" v-infinite-scroll="loadApply">
        <div>
            <div class="apply-item" v-for="item in applyList">
                <div :class="['contactType',item.conatactType==0?'user-contact':'']">
                    {{ item.conatactType==0?'好友':'群' }}
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

import { ref, computed, getCurrentInstance } from 'vue';
import { useRouter } from 'vue-router';
import { useRoute } from 'vue-router';
import {useContactStateStore} from '../../stores/ContactStateStore';
import { useUserInfoStore } from '../../stores/userInfoStore';

const router = useRouter();
const route = useRoute();
const { proxy } = getCurrentInstance();
const contactStateStore = useContactStateStore();
const userInfoStore = useUserInfoStore();
const applyList = ref([]);
let pageNo=0;
let pageTotal=1;
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
    applyList.value = result.data.list;
    pageNo = result.data.pageNo;
  
}
loadApply();

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
