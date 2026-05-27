<template>
    <div class="blank-page">
        <div class="blank-content">
            <el-icon class="blank-icon">
                <ChatDotRound />
            </el-icon>
            <div class="blank-text" v-if="text">{{ text }}</div>
        </div>
    </div>
</template>

<script setup>
defineProps({
    text: {
        type: String,
        default: ''
    }
});
</script>

<style lang="scss" scoped>
.blank-page {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
}

.blank-content {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
}

.blank-icon 
{
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 100px;
    color: #ddd;
}

.blank-text {
    margin-top: 12px;
    font-size: 14px;
    color: #aaa;
}

</style>
