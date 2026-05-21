<template>
    <div class="image-panel" @click="showImageHandler">
        <el-image :src="serverUrl" fit="scale-down" :width="width">
            <template #error></template>
            <template #placeholder></template>
        </el-image>
    </div>
</template>

<script setup>
import { ref, computed, getCurrentInstance } from 'vue';



const { proxy } = getCurrentInstance();
const props = defineProps({
    width: {
        type: Number,
        default: 170
    },
    height: {
        type:  Number,
    },
    showPlaye: {
        type: Boolean,
        default: false
    },
    fileId:{
        type:[String,Number],
        default:''
    },
    partType:{
        type:String,
        default:'avatar'
    },
    fileType:{
        type:Number,    
        default:0
    },
    forceGet:{
        type:Boolean,
        default:false
    }
    
})

const serverUrl = computed(() => {
    if (!props.fileId) return '';
    return `http://localhost:5050/api/file/${props.partType}/${props.fileId}.png`;
})

</script>

<style lang="scss" scoped>
.image-panel {
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
}
</style>