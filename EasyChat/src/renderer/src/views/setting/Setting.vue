<template>
    <Layout>
        <template #left-content>
            <div class="drag-panel drag"></div>
            
            <div class="menu-list">
                <div :class="['menu-item',route.path==item.path?'menu-active':'']" v-for="item in settingMenuList" :key="item.path" @click="jump(item)">
                    <div class="menu-item-icon" :style="{background:item.bgColor}">
                        <el-icon>
                            <component :is="item.icon"></component>
                        </el-icon>
                    </div>
                    <div class="menu-name">{{item.name}}</div>
                </div>
                              
                
               
            </div>
        </template>
        <template #right-content>
            <div class="title-panel drag">{{ rightTitle }}</div>
            <RouterView v-slot="{Component}">
                <component :is="Component"></component>
            </RouterView>
            <WinOp :showSetTop="true" :showMin="true" :showMax="true" :closeType="1"></WinOp>
        </template>
    </Layout>
</template>

<script setup>
import { ref } from 'vue';
import { useRoute ,useRouter} from 'vue-router';

const rightTitle=ref();
const route=useRoute();
const router=useRouter();
const settingMenuList=ref([
    {
        name:'账号设置',
        icon:'User',
        path:'/setting/userinfo',
        bgColor:'white'
    },
    {
        name:'文件管理',
        icon:'FolderOpened',
        path:'/setting/fileManage',
        bgColor:'white'
    },
    {
        name:'关于我们',
        icon:'Setting',
        path:'/setting/about',
        bgColor:'white'

    }
    ])
const jump=(data)=>{
    router.push(data.path);

}




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
    .el-icon {
        color: #999;
        font-size: 13px;
    }
}

.menu-list {
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

.menu-list {
    .menu-item {
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

        .menu-item-icon {
            width: 36px;
            height: 36px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            .el-icon {
                font-size: 20px;
                color: #666;
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

        .menu-name {
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

.menu-active {
            background: #d9d9d9;
        }
</style>
