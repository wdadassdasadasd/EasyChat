<template>
    <Layout>
        <template #left-content>
            <div class="drag-panel drag"></div>
            <div class="top-search">
                <el-input clearable placeholder="搜索" size="small" v-model="searchKey" @keyup="search">
                    <template #prefix>
                        <span class="iconfont icon-search"></span>
                    </template>
                </el-input>
            </div>
            <div class="contact-list">
                <template v-for="item in partList" :key="item.partName">
                    <div class="part-title">{{ item.partName }}</div>
                    <div class="part-list">
                        <div
                            v-for="sub in item.children"
                            :key="sub.path"
                            :class="['part-item', sub.path == Route.path ? 'active' : '']"
                            @click="partJump(sub)"
                        >
                            <div class="part-item-icon" :style="{ backgroundColor: sub.iconBgColor }">
                                <span :class="['iconfont', sub.icon]"></span>
                            </div>
                            <div class="text">{{ sub.name }}</div>
                        </div>
                        <template v-for="contact in item.contactData">
                            <div :class="['part-item', contact[item.contactId] == Route.path ? 'active' : '']" @click="contactDetail(contact,item)">
                                <Avatar :userId="contact[item.contactId]" :width="35"></Avatar>
                                <div class="text">{{ contact[item.contactName] }}</div>
                            </div>
                        </template>
                        <template v-if="item.contactData && item.contactData.length == 0">
                            <div class="empty-msg">
                            {{ item.emptyMsg }}
                            </div>
                        </template>
                    </div>
                </template>
            </div>
        </template>
        <template #right-content>
            <div class="title-panel drag">{{ rightTitle }}</div>
            <RouterView v-slot="{Component}">
                <component :is="Component"></component>
            </RouterView>
            <WinOp :showSetTop="true" :showMin="true" :showMax="true" :closeType="1" showSetTop="1"></WinOp>
        </template>
       
    </Layout>
</template>

<script setup>

import { ref, reactive, nextTick, getCurrentInstance,watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import {useContactStateStore} from '@/stores/ContactStateStore';

const contactStateStore = useContactStateStore();
const Route = useRoute();
const Router = useRouter(); 
const { proxy } = getCurrentInstance();

const searchKey = ref();
const search = () => {
    // 搜索逻辑
};


const partList = ref([
    {
        partName: '新朋友',
        children: [
            {
                name: '搜好友',
                icon: 'icon-add',
                iconBgColor: '#fa9d3b',
                path: '/contact/search',
            },
            {
                name: '新的朋友',
                icon: 'icon-plane',
                iconBgColor: '#08bf61',
                path: '/contact/contactNotice',
                showTitle: true,
                countKey: 'contactApplyCount',
            },
        ],
    },
    {
        partName: '我的群聊',
        children: [
            {
                name: '新建群聊',
                icon: 'icon-add',
                iconBgColor: '#1485ee',
                path: '/contact/createGroup',
            },
        ],
        contactId: 'groupId',
        contactName: 'groupName',
        showTitle: true,
        contactData: [],
        path: '/contact/groupDetail',
    },
    {
        partName: '我加入的群聊',
        contactId: 'contactId',
        contactName: 'contactName',
        showTitle: true,
        contactData: [],
        contactPath: '/contact/groupDetail',
        emptyMsg: '暂无群聊',
    },
    {
        partName: '我的好友',
        children: [],
        contactId: 'contactId',
        contactName: 'contactName',
        showTitle: true,
        contactData: [],
        contactPath: '/contact/userDetail',
        emptyMsg: '暂无好友',
    },
]);

const rightTitle = ref();
const partJump = (data) => {
    if (data.showTitle) {
        rightTitle.value = data.name;
    } else {
        rightTitle.value = null;
    }
    Router.push(data.path);
  
};
const loadContact=async(contactType)=>{
    let result=await proxy.Request({
        url:proxy.Api.loadContact,
        params:{
            contactType
        }
    });
    if(!result){
        return;
    }
    if(contactType=='GROUP'){
        partList.value[2].contactData=result.data;
        
    }
    else if(contactType=='USER'){
        partList.value[3].contactData=result.data;
    }
}

loadContact('USER');
loadContact('GROUP');

const loadMyGroup=async()=>{
    let result=await proxy.Request({
        url:proxy.Api.loadMyGroup,
    });
    if(!result){
        return;
    }
    partList.value[1].contactData=result.data;
}
loadMyGroup();

const contactDetail=(contact,part)=>{
    if(part.showTitle){
    rightTitle.value=contact[part.contactName];
    }else{
        rightTitle.value=null;
    }
Router.push({
    path:part.contactPath,
    query:{
        contactId:contact[part.contactId]
    }
});
}

//监听 Pinia Store 的状态变化，自动刷新联系人列表
watch(()=>
    contactStateStore.contactReload,
    (newVal,oldVal)=>{
        if(!newVal) return;
         switch(newVal){
        case 'MY_GROUP':
                loadMyGroup();
                break;
        case 'USER':
            loadContact('USER');
            break;
        case 'GROUP':
            loadContact('GROUP');
            break;
        case 'REMOVE_USER':
            loadContact('USER');
            Route.push('/contact/blank');
            rightTitle.value=null;
            break;
        case 'DISOLUTION_GROUP':
            loadContact('GROUP');
            Route.push('/contact/blank');
            rightTitle.value=null;
            break;
        case 'LEAVE_GROUP':
            loadContact('GROUP');
            Route.push('/contact/blank');
            rightTitle.value=null;
            break;
     }
    },
   
    {immediate:true,deep:true}
)
</script>

<style lang="scss" scoped>
.drag-panel {
    height: 25px;
    background: #f7f7f7;
}

.top-search {
    padding: 0 10px 8px;
    background: #f7f7f7;
    :deep(.el-input__wrapper) {
        background: #eaeaea;
        box-shadow: none;
        border-radius: 4px;
    }
    .iconfont {
        color: #999;
        font-size: 13px;
    }
}

.contact-list {
    flex: 1;
    overflow-y: auto;
    &::-webkit-scrollbar {
        width: 4px;
    }
    &::-webkit-scrollbar-thumb {
        background: #d0d0d0;
        border-radius: 2px;
    }
}

.part-title {
    padding: 10px 16px 4px;
    font-size: 12px;
    color: #999;
    line-height: 1.4;
}

.part-list {
    .part-item {
        display: flex;
        align-items: center;
        padding: 8px 12px;
        cursor: pointer;
        border-radius: 4px;
        margin: 0 4px;
        transition: background 0.15s;

        &:hover {
            background: #ebebeb;
        }

        &.active {
            background: #d9d9d9;
        }

        .part-item-icon {
            width: 36px;
            height: 36px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            .iconfont {
                font-size: 20px;
                color: #fff;
            }
        }

        .contact-avatar {
            width: 36px;
            height: 36px;
            border-radius: 4px;
            background: #c8c8c8;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            .iconfont {
                font-size: 20px;
                color: #fff;
            }
        }

        .text {
            margin-left: 10px;
            font-size: 14px;
            color: #333;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
    }
}

.empty-msg {
    padding: 8px 16px;
    font-size: 12px;
    color: #bbb;
    text-align: center;

}
</style>
