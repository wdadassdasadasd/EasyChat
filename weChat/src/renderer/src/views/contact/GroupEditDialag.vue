<template>
    <Dialog
        :show="dialogConfig.show"
        :title="dialogConfig.title"
        :buttons="dialogConfig.buttons"
        :width="dialogConfig.width"
        :showCancel="dialogConfig.showCancel"
        @close="dialogConfig.show = false"
    >
       <GroupEditForm ref="groupEditRef" @editBack="editBack"></GroupEditForm>
    </Dialog>
</template>


<script setup>
import { ref, computed, getCurrentInstance } from 'vue';
import GroupEditForm from './GroupEditForm.vue';
import { de } from 'element-plus/es/locales.mjs';
const {proxy} = getCurrentInstance();
const groupEditRef=ref();
const dialogConfig=ref({
    show:false,
    title:'编辑群组',
    buttons:[
      
    ]
})

const show=(data)=>{
    dialogConfig.value.show=true;
    nextTick(()=>{
        groupEditRef.value.show(data);
    })
}
const emit=defineEmits(['reloadGroupInfo']);
const emitback=()=>{
    dialogConfig.value.show=false;
    emit('reloadGroupInfo');
}
defineExpose({
    show
})
</script>

<style lang="scss" scoped>
</style>