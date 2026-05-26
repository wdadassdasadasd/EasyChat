<template>
    <div class="image-panel" @click="showImageHandler">
        <el-image :src="imageUrl" fit="scale-down" :width="width">
            <template #error>
                <div class="image-fallback">
                    <el-icon :size="width * 0.5"><User /></el-icon>
                </div>
            </template>
            <template #placeholder>
                <div class="image-loading">
                    <el-icon class="is-loading" :size="width * 0.3"><Loading /></el-icon>
                </div>
            </template>
        </el-image>
    </div>
</template>

<script setup>
import { ref, watch, onBeforeUnmount } from 'vue';
import axios from 'axios';
import { User, Loading } from '@element-plus/icons-vue';

const props = defineProps({
    width: {
        type: Number,
        default: 170
    },
    height: {
        type: Number,
    },
    showPlaye: {
        type: Boolean,
        default: false
    },
    fileId: {
        type: [String, Number],
        default: ''
    },
    partType: {
        type: String,
        default: 'avatar'
    },
    fileType: {
        type: Number,
        default: 0
    },
    forceGet: {
        type: Boolean,
        default: false
    }
});

const imageUrl = ref('');
let currentObjectUrl = '';

const loadImage = async () => {
    // 释放之前的 blob URL
    if (currentObjectUrl) {
        URL.revokeObjectURL(currentObjectUrl);
        currentObjectUrl = '';
    }
    imageUrl.value = '';

    if (!props.fileId) {
        return;
    }

    // 使用后端 downloadFile 接口，fileId 为非数字时获取头像，为数字时获取聊天文件
    const url = `/api/chat/downloadFile`;
    let userInfoJson = localStorage.getItem('userInfo');
    let token = userInfoJson ? JSON.parse(userInfoJson).token : '';

    try {
        const response = await axios.post(url, `fileId=${props.fileId}&showCover=false`, {
            baseURL: import.meta.env.PROD ? (import.meta.env.VITE_DOMAIN || import.meta.env.VITE_PROD_DOMAIN || 'http://localhost:5050') : '',
            responseType: 'blob',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                'token': token
            }
        });

        const blob = response.data;
        if (blob.type && (blob.type.includes('json') || blob.type.includes('application/json'))) {
            const text = await blob.text();
            console.error('[ShowLocalImage] 后端返回错误:', text);
            imageUrl.value = '';
            return;
        }

        // 后端 downloadFile 返回 Content-Type 为 application/x-msdownload，不是图片类型，
        // 需要修正为 image/png，否则 el-image 可能无法正确渲染。
        const imageBlob = new Blob([blob], { type: 'image/png' });
        currentObjectUrl = URL.createObjectURL(imageBlob);
        imageUrl.value = currentObjectUrl;
    } catch (e) {
        console.error('[ShowLocalImage] 请求失败:', e.message);
        imageUrl.value = '';
    }
};

watch(
    () => [props.fileId, props.partType, props.forceGet],
    () => {
        loadImage();
    },
    { immediate: true }
);

onBeforeUnmount(() => {
    if (currentObjectUrl) {
        URL.revokeObjectURL(currentObjectUrl);
    }
});
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

.image-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #e0e0e0;
    color: #999;
    border-radius: inherit;
}

.image-loading {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ccc;
}
</style>
