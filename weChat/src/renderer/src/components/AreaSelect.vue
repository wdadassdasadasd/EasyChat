<template>
    <div>
        <el-cascader @click="change" v-model="modelValue.areaCode" :options="AreaData" ref="areaSelectRef" clearable></el-cascader>
    </div>
    
</template>

<script setup>
import { useRoute,useRouter } from 'vue-router';
import { ref, computed, getCurrentInstance } from 'vue';
import AreaData from './AreaData'
const {proxy}=getCurrentInstance();
const route=useRoute();
const router=useRouter();
const props=defineProps({
    modelValue:{
        type:Object,
        default:{}
    }

})
const areaSelectRef=ref();
const emit=defineEmits('update:modelValue');

const change=(e)=>{
    const areaData={
        areaName:[],
        areaCode:[]
    }
    const checkNodes=areaSelectRef.value.getCheckedNodes()[0];
       if(!checkNodes){
        emit('update:modelValue',areaData);
        return;
    }
        const pathLabels=checkNodes.pathLabels;
        const pathValues=checkNodes.pathValues;
        areaData.areaName=pathLabels;
        areaData.areaCode=pathValues;
        emit('update:modelValue',areaData);
}



</script>

<style lang="scss" scoped>




</style>