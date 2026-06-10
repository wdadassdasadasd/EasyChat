<template>
  <div :class="['image-panel', preview && imageUrl ? 'image-panel-preview' : '']">
    <el-image
      :src="imageUrl"
      fit="scale-down"
      :width="width"
      :preview-src-list="previewSrcList"
      :preview-teleported="true"
      :hide-on-click-modal="true"
      @load="emitLoaded"
    >
      <template #error>
        <div class="image-fallback">
          <span v-if="fallbackText">{{ fallbackText }}</span>
          <el-icon v-else :size="width * 0.5"><User /></el-icon>
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
import { computed, getCurrentInstance, ref, watch, onBeforeUnmount } from 'vue'
import { User, Loading } from '@element-plus/icons-vue'

const { proxy } = getCurrentInstance()

const props = defineProps({
  width: {
    type: Number,
    default: 170
  },
  height: {
    type: Number
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
    type: [Boolean, Number, String],
    default: false
  },
  preview: {
    type: Boolean,
    default: false
  },
  showCover: {
    type: Boolean,
    default: false
  },
  fallbackText: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['loaded'])
const imageUrl = ref('')
const previewSrcList = computed(() => {
  return props.preview && imageUrl.value ? [imageUrl.value] : []
})
let currentObjectUrl = ''

const emitLoaded = () => {
  emit('loaded')
}

const loadImage = async () => {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl)
    currentObjectUrl = ''
  }
  imageUrl.value = ''

  if (!props.fileId) {
    return
  }

  // 统一使用项目封装的 Request 工具，复用 token 注入、901 登出、统一错误处理。
  const blob = await proxy.Request({
    url: proxy.Api.downloadFile,
    params: {
      fileId: props.fileId,
      showCover: props.showCover
    },
    responseType: 'blob',
    showLoading: false,
    showError: false
  })

  if (!blob) {
    imageUrl.value = ''
    return
  }

  if (blob.type && (blob.type.includes('json') || blob.type.includes('application/json'))) {
    try {
      const text = await blob.text()
      console.error('[ShowLocalImage] 后端返回错误:', text)
    } catch (e) {
      // blob.text() 失败时忽略，继续尝试按图片渲染。
    }
    imageUrl.value = ''
    return
  }

  // 后端 downloadFile 返回 Content-Type 可能不是图片 MIME 类型，
  // 修正为 image/png 确保 el-image 能正确渲染。
  const imageBlob = new Blob([blob], { type: 'image/png' })
  currentObjectUrl = URL.createObjectURL(imageBlob)
  imageUrl.value = currentObjectUrl
}

watch(
  () => [props.fileId, props.partType, props.forceGet, props.showCover],
  () => {
    loadImage()
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl)
  }
})
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

.image-panel-preview {
  cursor: zoom-in;
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

  span {
    font-size: 12px;
    letter-spacing: 0;
  }
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
