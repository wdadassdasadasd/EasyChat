<template>
    <Layout>
        <template #left-content>
            <div class="drag-panel drag"></div>
            <div class="top-search">
                <el-input clearable placeholder="搜索" size="small" v-model="searchKey" @keyup="search">
                    <template #prefix>
                        <el-icon class="search-icon">
                            <Search />
                        </el-icon>
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
                                <el-icon>
                                    <component :is="sub.icon"></component>
                                </el-icon>
                            </div>
                            <div class="text">{{ sub.name }}</div>
                        </div>
                        <template v-for="contact in item.contactData" :key="`${item.partName}-${contact[item.contactId]}`">
                            <div
                                :class="['part-item', isCurrentContact(contact, item) ? 'active' : '']"
                                @click="contactDetail(contact,item)"
                            >
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
                <component :is="Component" :key="Route.fullPath"></component>
            </RouterView>
            <WinOp :showSetTop="true" :showMin="true" :showMax="true" :closeType="1"></WinOp>
        </template>
       
    </Layout>
</template>

<script setup>

import { ref, getCurrentInstance,watch } from 'vue';
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
                icon: 'Plus',
                iconBgColor: '#fa9d3b',
                path: '/contact/search',
            },
            {
                name: '新的朋友',
                icon: 'Promotion',
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
                icon: 'Plus',
                iconBgColor: '#1485ee',
                path: '/contact/createGroup',
            },
        ],
        contactId: 'groupId',
        contactName: 'groupName',
        showTitle: true,
        contactData: [],
        contactPath: '/contact/groupDetail',
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
const isSameRoute = (path, query = {}) => {
    const currentQuery = Route.query || {};
    const queryKeys = Object.keys(query);
    return Route.path === path && queryKeys.every((key) => String(currentQuery[key] || '') === String(query[key] || ''));
};

const partJump = (data) => {
    if (data.showTitle) {
        rightTitle.value = data.name;
    } else {
        rightTitle.value = null;
    }
    if (isSameRoute(data.path)) {
        return;
    }
    Router.push(data.path);
  
};
let contactLoading = false;

const loadContact = async (contactType) => {
  try {
    const result = await proxy.Request({
      url: proxy.Api.loadContact,
      params: {
        contactType
      }
    })
    if (!result) {
      return false
    }
    if (contactType == 'GROUP') {
      partList.value[2].contactData = result.data
    } else if (contactType == 'USER') {
      partList.value[3].contactData = result.data
    }
    return true
  } catch (e) {
    console.error('loadContact failed:', contactType, e)
    return false
  }
}

const loadMyGroup = async () => {
  try {
    const result = await proxy.Request({
      url: proxy.Api.loadMyGroup
    })
    if (!result) {
      return false
    }
    partList.value[1].contactData = result.data
    return true
  } catch (e) {
    console.error('loadMyGroup failed:', e)
    return false
  }
}

const loadAllContacts = async () => {
  if (contactLoading) return
  contactLoading = true
  const results = await Promise.allSettled([
    loadContact('USER'),
    loadContact('GROUP'),
    loadMyGroup()
  ])
  contactLoading = false

  const failed = results.filter((r) => r.status === 'rejected' || r.value === false).length
  if (failed > 0 && failed === results.length) {
    proxy.Message.error('联系人加载失败，请检查网络后刷新')
  }
}
loadAllContacts()

const contactDetail=(contact,part)=>{
    const contactId = contact[part.contactId];
    const contactPath = part.contactPath;
    if(part.showTitle){
    rightTitle.value=contact[part.contactName];
    }else{
        rightTitle.value=null;
    }
    if (isSameRoute(contactPath, { contactId })) {
        return;
    }
Router.push({
    path:contactPath,
    query:{
        contactId
    }
});
}

const isCurrentContact = (contact, part) => {
    return isSameRoute(part.contactPath, { contactId: contact[part.contactId] });
};

watch(
  () => contactStateStore.contactReload,
  (newVal) => {
    if (!newVal) return
    switch (newVal) {
      case 'MY_GROUP':
        loadMyGroup()
        break
      case 'USER':
        loadContact('USER')
        break
      case 'GROUP':
        loadContact('GROUP')
        break
      case 'REMOVE_USER':
        loadContact('USER')
        Router.push('/contact/Blank')
        rightTitle.value = null
        break
      case 'DISSOLUTION_GROUP':
      case 'LEAVE_GROUP':
        loadContact('GROUP')
        Router.push('/contact/Blank')
        rightTitle.value = null
        break
    }
  },
  { immediate: false }
)
</script>

<style lang="scss" scoped>
.drag-panel {
    height: 25px;
    background: #f7f7f7;
}

.title-panel {
    height: 48px;
    line-height: 48px;
    flex-shrink: 0;
    padding: 0 24px;
    border-bottom: 1px solid #d8d8d8;
    color: #111;
    font-size: 16px;
    background: #ededed;
}

.top-search {
    padding: 0 10px 8px;
    background: #f7f7f7;
    :deep(.el-input__wrapper) {
        background: #eaeaea;
        box-shadow: none;
        border-radius: 4px;
    }
    .search-icon {
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
            .el-icon {
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
            .el-icon {
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
