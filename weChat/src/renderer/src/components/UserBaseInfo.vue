<template>
    <div class="user-panel">
        <AvatarBase :userId="userInfo.userId||userInfo.contactId" :width="60" :borderRadius="5" :showDetails="true">

        </AvatarBase>
        <div class="userInfo">
            <div class="nickName">
                {{userInfo.nickName}}
                <el-icon v-if="userInfo.sex==0" class="sex-icon woman-icon">
                    <Female />
                </el-icon>
                <el-icon v-if="userInfo.sex==1" class="sex-icon man-icon">
                    <Male />
                </el-icon>
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

            .sex-icon {
                font-size: 15px;
                &.woman-icon {
                    color: #f4719e;
                }
                &.man-icon {
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
