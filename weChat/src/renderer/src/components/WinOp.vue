<template>
    <div class="win-op-no-drag">
        <div v-if="showSetTop" :class="['iconfont icon-narrow-up',isTop?'win-top':'']"
        @click="top" :title="isTop?'取消置顶':'置顶'">
        </div>
        <div v-if="showMin" class="iconfont icon-min" @click="minmize" title="最小化"></div>
        <div v-if="showMax" :class="['iconfont',isMax?'icon-maximize':'icon-max']" @click="maximize" :title="isMax?'向下还原':'最大化'"></div>
        <div v-if="showClose" class="iconfont icon-close" @click="close" title="关闭">
        </div>
    </div>
</template>

<script setup>
import {ref,reactive,nextTick,getCurrentInstance, onMounted} from 'vue';
const proxy=getCurrentInstance();
const props=defineProps({
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

onMounted(()=>{
    isMax.value=false;
    
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
    }
    else{
        winOp('maximize')
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
    .iconfont {
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 14px;
        &:hover {
            background: rgba(0, 0, 0, 0.1);
        }
        &.icon-close:hover {
            background: #e81123;
            color: #fff;
        }
    }
}
</style>