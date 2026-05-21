<template>
    <div class="user-panel">
        <AvatarBase :userId="userInfo.userId||userInfo.contactId" :width="60" :borderRadius="5" :showDetails="true">

        </AvatarBase>
        <div class="userInfo">
            <div class="nickName">
                {{userInfo.nickName}}
                <span v-if="userInfo.sex==0" class="iconfont icon-woman"></span>
                <span v-if="userInfo.sex==1" class="iconfont icon-man"></span>
            </div>
            <div class="info">ID：{{userInfo.userId||userInfo.contactId}}</div>
            <div class="info" v-if="showArea">地区：{{proxy.Utils.getAreaInfo(userInfo.areaName)}}</div>
        </div>
    


    </div>
</template>

<script setup>
import AvatarBase from './AvatarBase.vue';
import { getCurrentInstance } from 'vue';
const { proxy } = getCurrentInstance();

const props = defineProps({
    userInfo: {
        type: Object,
        default: () => ({})
    },
    showArea: {
        type: Boolean,
        default: false
    }
});
</script>

<style lang="scss" scoped>
.user-panel {
    display: flex;
    align-items: center;
    gap: 14px;

    .userInfo {
        display: flex;
        flex-direction: column;
        gap: 4px;

        .nickName {
            font-size: 16px;
            font-weight: bold;
            color: #333;
            display: flex;
            align-items: center;
            gap: 6px;

            .iconfont {
                font-size: 15px;
                &.icon-woman {
                    color: #f4719e;
                }
                &.icon-man {
                    color: #5097f5;
                }
            }
        }
    }

    .info {
        font-size: 13px;
        color: #999;
        margin-top: 2px;
    }
}
</style>