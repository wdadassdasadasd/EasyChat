<template>
    <div :class="['win-op-no-drag', `win-op-${mode}`]">
        <div v-if="showSetTop" :class="['win-icon',isTop?'win-top':'']"
        @click="top" :title="isTop?'取消置顶':'置顶'">
            <el-icon>
                <Top />
            </el-icon>
        </div>
        <div v-if="showMin" class="win-icon" @click="minmize" title="最小化">
            <el-icon>
                <Minus />
            </el-icon>
        </div>
        <div v-if="showMax" class="win-icon" @click="maximize" :title="isMax?'向下还原':'最大化'">
            <el-icon>
                <ScaleToOriginal v-if="isMax" />
                <FullScreen v-else />
            </el-icon>
        </div>
        <div v-if="showClose" class="win-icon win-close" @click="close" title="关闭">
            <el-icon>
                <Close />
            </el-icon>
        </div>
    </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
const props=defineProps({
    mode:{
        type:String,
        default:'float',
    },
    showSetTop:{
        type:Boolean,
        default:true,
    },
    showMin:{
        type:Boolean,
        default:true,
    },
    showMax:{
        type:Boolean,
        default:true,
    },
    showClose:{
        type:Boolean,
        default:true,
    },
    closeType:{
        type:Number,
        default:1
    }
})
const emit=defineEmits(['closeCallback'])

const isMax=ref(false);
const isTop=ref(false);

let winStateHandler = null;

onMounted(()=>{
    isMax.value=false;
    // 监听主进程窗口状态变更（如 Win+↑/↓ 快捷键、拖拽标题栏等），保持按钮图标同步。
    winStateHandler = (_e, payload) => {
        if (payload && typeof payload.maximized === 'boolean') {
            isMax.value = payload.maximized;
        }
    };
    window.ipcRenderer.on('winStateChange', winStateHandler);
})

onUnmounted(() => {
    if (winStateHandler) {
        window.ipcRenderer.removeListener('winStateChange', winStateHandler);
        winStateHandler = null;
    }
})

const winOp=(action,data)=>{
    window.ipcRenderer.send("winTitleOp",{
        action,
        data
    })
}

const close=()=>{
    winOp('close',{
        type:props.closeType
    })
    emit('closeCallback')

}

const minmize=()=>{
    winOp('minimize')
}

const maximize=()=>{
    if(isMax.value){
        winOp('unmaximize')
        isMax.value=false;
    }
    else{
        winOp('maximize')
        isMax.value=true;
    }
}

const top=()=>{
    isTop.value=!isTop.value;
    winOp('top',{top:isTop.value})
}
</script>

<style lang="scss" scoped>
.win-op-no-drag {
    position: absolute;
    top: 0;
    right: 0;
    display: flex;
    align-items: center;
    z-index: 100;
    -webkit-app-region: no-drag;

    &.win-op-inline {
        position: static;
        top: auto;
        right: auto;
        z-index: auto;
    }

    .win-icon {
        width: 36px;
        height: 34px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 14px;
        -webkit-app-region: no-drag;
        &:hover {
            background: rgba(0, 0, 0, 0.1);
        }
        &.win-close:hover {
            background: #e81123;
            color: #fff;
        }
    }
}
</style>
