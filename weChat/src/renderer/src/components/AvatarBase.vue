<template>
    <div class="user-avatar" @click="showDetailHandler" :style="{width: width + 'px', height: width + 'px', borderRadius: borderRadius + 'px'}">
        <ShowLocalImage :width="width" :fileId="userId" :forceGet="false" partType="avatar" ></ShowLocalImage>
    </div>
</template>

<script setup>
import ShowLocalImage from './ShowLocalImage.vue';
const props = defineProps({
    userId: {
        type: String,
        default: ''
    },
    width: {
        type: Number,
        default: 40
    },
    borderRadius: {
        type: Number,
        default: 0
    },
    showDetails: {
        type: Boolean,
        default: false
    },
    
})

const showDetailHandler=()=>{
    if(!props.showDetails) return;

}


</script>

<style lang="scss" scoped>
.user-avatar {
    background: white;
    display: flex;
    overflow: hidden;
    cursor: pointer;
    align-items: center;
    justify-content: center;
   
}
</style>
