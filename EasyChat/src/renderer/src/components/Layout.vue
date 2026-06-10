<template>
    <div class="layout-container">
        <div class="left-side-inner">
            <slot name="left-content"></slot>
        </div>
        <div class="right-content">
            <slot name="right-content"></slot>
        </div>
    </div>
</template>

<script setup>

</script>

<style lang="scss" scoped>
.layout-container {
    display: flex;
    width: 100%;
    height: 100vh;
    overflow: hidden;
}

.left-side-inner {
    width: 250px;
    flex-shrink: 0;
    background: #f5f5f5;
    border-right: 1px solid #e0e0e0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.right-content {
    flex: 1;
    height: 100%;
    background: #ededed;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding-top: 27px;
    padding-right: 5px;
}
</style>