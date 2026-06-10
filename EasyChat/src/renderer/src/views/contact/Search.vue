<template>
    <ContactPanel>
        <div class="search-title">搜索好友</div>
        <div class="search-panel">
            <el-input placeholder="请输入用户ID或群组ID" clearable size="large" @keydown.enter="search" v-model="contactId">
            </el-input>
            <el-button type="primary" @click="search">搜索</el-button>
        </div>
        <div class="my-id-tip">
            我的用户ID：<span class="my-id">{{ myUserId }}</span>
        </div>

        <div v-if="searchResult != null" class="search-result-panel">
            <div class="search-result">
                <span class="contact-type">{{ contactTypeName }}</span>
                <UserBaseInfo :userInfo="searchResult" :showArea="searchResult.contactType === 'USER'"></UserBaseInfo>
            </div>
            <div class="op-btn" v-if="searchResult.contactId != userInfoStore.getInfo().userId">
                
                <el-button type="primary"
                    v-if="searchResult.status == null || searchResult.status == 0 || searchResult.status == 2 || searchResult.status == 3 || searchResult.status == 4"
                    @click="applyContact">{{ searchResult.contactType == 'USER' ? '申请到联系人' : '申请加入群组' }}</el-button>
                <el-button type="primary" v-if="searchResult.status==1" @click="sendMessage">发消息</el-button>
                <span v-if="searchResult.status==5||searchResult.status==6">对方拉黑了你</span>                
            </div>
        </div>
        <div v-if="searchResult == null" class="no-data">没有搜索到任何结果</div>
    </ContactPanel>
    <SearchAdd ref="searchAddRef" @reload="resetForm"></SearchAdd>
</template>

<script setup>
import { ref, computed, getCurrentInstance } from 'vue';
import { useRouter } from 'vue-router';
import { useUserInfoStore } from '@/stores/UserInfoStore';
import SearchAdd from './SearchAdd.vue';

const router = useRouter();
const { proxy } = getCurrentInstance();
const userInfoStore = useUserInfoStore();
const contactId = ref('');
const searchResult = ref(null);

const myUserId = userInfoStore.getInfo()?.userId ?? '未登录';

//联系人类型名称
const contactTypeName = computed(() => {
    if (!searchResult.value) return '';
    if (userInfoStore.getInfo()?.userId == searchResult.value.contactId) {
        return '自己';
    } else if (searchResult.value.contactType == 'USER') {
        return '用户';
    } else if (searchResult.value.contactType == 'GROUP') {
        return '群组';
    }
    return '';
});

//搜索联系人
const search = async () => {
    //检验输入是否为空
    if (!contactId.value) {
        proxy.Message.warning("请输入用户ID或群组ID");
        return;
    }
    //调用搜索接口
    let result = await proxy.Request({
        url: proxy.Api.search,
        params: {
            contactId: contactId.value
        }
    })
    //处理返回结果
    if (!result || result.data == null) {
        searchResult.value = null;
        return;
    }
    searchResult.value = result.data;
}

const sendMessage = () => {
  if (!searchResult.value) return

  const contact = searchResult.value
  const contactId = contact.contactId
  const contactType = contact.contactType === 'USER' ? 'USER' : 'GROUP'

  router.push({
    path: '/chat',
    query: {
      chatId: contactId,
      type: contactType,
      contactName: contact.contactName || contact.nickName || contact.groupName || contactId
    }
  })
}

const searchAddRef = ref();
const applyContact=()=>{
    searchAddRef.value.show(searchResult.value);

}

const resetForm=()=>{
    searchResult.value={};
    contactId.value=undefined;
}

</script>

<style lang="scss" scoped>
.search-title {
    font-size: 18px;
    font-weight: bold;
    color: #333;
    padding: 30px 0 20px;
    text-align: left;
}

.search-panel {
    display: flex;
    align-items: center;
    gap: 10px;
}

.my-id-tip {
    margin-top: 10px;
    font-size: 12px;
    color: #999;

    .my-id {
        color: #07c160;
        font-weight: bold;
        user-select: all;
    }
}

.no-data {
    text-align: center;
    color: #bbb;
    font-size: 13px;
    margin-top: 40px;
}

.search-result-panel {
    margin-top: 20px;
    border-top: 1px solid #eee;
    padding-top: 16px;

    .search-result {
        padding: 10px 0;

        .contact-type {
            font-size: 13px;
            color: #999;
            margin-bottom: 10px;
            display: block;
        }
    }

    .op-btn {
        margin-top: 16px;
    }
}
</style>