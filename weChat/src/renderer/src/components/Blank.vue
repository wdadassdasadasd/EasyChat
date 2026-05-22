<template>
    <div class="blank-page">
        <div class="blank-content">
            <el-icon class="blank-icon">
                <ChatDotRound />
            </el-icon>
        </div>
    </div>
</template>

<script setup>
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


</style>
