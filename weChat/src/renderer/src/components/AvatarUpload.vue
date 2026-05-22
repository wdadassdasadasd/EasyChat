<template>
    <div class="avatar-upload">
        <div class="avatar-show">
            <template v-if="modelValue">
                <el-image v-if="preview" :src="loadFile" fit="scale-down"></el-image>
                <ShowLocalImage :fileId="props.modelValue" partType="avatar" :width="60" v-else></ShowLocalImage>
            </template>

            <template v-else>
                <el-upload name="file" :show-file-list="false" accept=".png,.PNG,.jpg,.JPG,.jpeg,.JPEG,.gif,.GIF,.bmp,.BMP" :multiple="false" :http-request="uploadImage">
                    <el-icon class="avatar-add-icon">
                        <Plus />
                    </el-icon>
                </el-upload>
            </template>
        </div>

        <div class="select-btn">
            <el-upload name="file" :show-file-list="false" accept=".png,.PNG,.jpg,.JPG,.jpeg,.JPEG,.gif,.GIF,.bmp,.BMP" :multiple="false" :http-request="uploadImage">
                    <el-button type="primary" size="small">选择</el-button>
                </el-upload>

        </div>
    </div>
</template>

<script setup>
import { el } from 'element-plus/es/locales.mjs';
import { ref, computed, getCurrentInstance } from 'vue';
const proxy = getCurrentInstance();
const props = defineProps({
    // 头像可以是字符串路径，也可以是文件对象
    modelValue: {
        type: [String,Object],
        default: null,
    },

});

const uploadImage=async(file) => {
    file=file.file;

};

const preview=computed(()=>{
    return props.modelValue instanceof File;

})
</script>

<style lang="scss" scoped>
.avatar-add-icon {
    font-size: 24px;
    color: #999;
}
</style>
