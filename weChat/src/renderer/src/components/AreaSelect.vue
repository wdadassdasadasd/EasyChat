<template>
    <div>
        <el-cascader
            v-model="selectedAreaCode"
            :options="AreaData"
            :props="cascaderProps"
            placeholder="请选择"
            clearable
            filterable
        ></el-cascader>
    </div>
    
</template>

<script setup>
import { computed } from 'vue';
import AreaData from './AreaData'

const props=defineProps({
    modelValue:{
        type:Object,
        default: () => ({
            areaCode: [],
            areaName: []
        })
    }

})
const emit=defineEmits(['update:modelValue']);

const cascaderProps = {
    value: 'value',
    label: 'label',
    children: 'children'
}

const selectedAreaCode = computed({
    get() {
        return props.modelValue?.areaCode || []
    },
    set(value) {
        change(value)
    }
})

const findPathLabels = (options, values) => {
    if (!values || values.length === 0) {
        return []
    }

    let children = options
    const labels = []

    for (const value of values) {
        const node = children.find((item) => item.value === value)
        if (!node) {
            break
        }
        labels.push(node.label)
        children = node.children || []
    }

    return labels
}

const change=(areaCode = [])=>{
    const areaData={
        areaName:[],
        areaCode:[]
    }

    if (!areaCode || areaCode.length === 0) {
        emit('update:modelValue',areaData);
        return;
    }

    areaData.areaCode = areaCode;
    areaData.areaName = findPathLabels(AreaData, areaCode);
    emit('update:modelValue',areaData);
}



</script>

<style lang="scss" scoped>




</style>
