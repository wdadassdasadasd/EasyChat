<template>
    <AppDialog
        :show="dialogConfig.show"
        :title="dialogConfig.title"
        :buttons="dialogConfig.buttons"
        :width="dialogConfig.width"
        :showCancel="dialogConfig.showCancel"
        @close="dialogConfig.show = false"
    >
       <GroupEditForm ref="groupEditRef" @editBack="editBack"></GroupEditForm>
    </AppDialog>
</template>


<script setup>
import { ref, nextTick } from 'vue';
import GroupEditForm from './GroupEditForm.vue';
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
const editBack=()=>{
    dialogConfig.value.show=false;
    emit('reloadGroupInfo');
}
defineExpose({
    show
})
</script>

<style lang="scss" scoped>
</style>
