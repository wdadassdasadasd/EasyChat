<template>
  <el-dialog :show-close="showClose" :draggable="draggable" :model-value="show" :close-on-click-modal="false"
    class="cust-dialog" :top="top + 'px'" :width="width" @close="close" @open="open">
    <template #header="{ close, titleId, titleClass }">
      <div v-if="title" class="title">{{ title }}</div>
      <slot v-else name="header"></slot>
    </template>
    <div class="dialog-body" :style="{ 'max-height': maxHeight + 'px', padding: padding + 'px' }">
      <slot></slot>
    </div>
    <template v-if="(buttons && buttons.length > 0) || showCancel">
      <div class="dialog-footer">
        <el-button link @click="close" v-if="showCancel"> 取消 </el-button>
        <el-button v-for="btn in buttons" :type="btn.type || 'primary'" @click="btn.click">
          {{ btn.text }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
const props = defineProps({
  draggable: {
    type: Boolean,
    default: true
  },
  title: {
    type: String
  },
  show: {
    type: Boolean,
    default: false
  },
  showClose: {
    type: Boolean,
    default: true
  },
  showCancel: {
    type: Boolean,
    default: true
  },
  top: {
    type: Number,
    default: 50
  },
  width: {
    type: String,
    default: '30%'
  },
  buttons: {
    type: Array
  },
  padding: {
    type: Number,
    default: 15
  }
})

const maxHeight =
  window.innerHeight - props.top - (!props.buttons || props.buttons.length == 0 ? 50 : 90)

const emit = defineEmits(['close', 'open'])
const close = () => {
  emit('close')
}

const open = () => {
  emit('open')
}
</script>

<style lang="scss">
.cust-dialog {
  padding: 0px !important;
  margin-bottom: 5px !important;
  -webkit-app-region: no-drag;
  
  :deep(.el-dialog) {
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-xl);
    overflow: hidden;
  }
  
  :deep(.el-dialog__header) {
    padding: 20px 24px;
    border-bottom: 1px solid var(--border-color);
    background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
    -webkit-app-region: no-drag;
    margin-right: 0;
  }
  
  :deep(.el-dialog__title) {
    font-size: 18px;
    font-weight: 600;
    color: var(--text);
    letter-spacing: 0.3px;
  }
  
  :deep(.el-dialog__headerbtn) {
    top: 20px;
    right: 20px;
    
    .el-dialog__close {
      color: var(--text3);
      font-size: 18px;
      transition: var(--transition);
      
      &:hover {
        color: var(--blue);
        transform: rotate(90deg);
      }
    }
  }
  
  :deep(.el-dialog__body) {
    padding: 0px;
    background: var(--bg-primary);
  }
  
  .title {
    font-size: 18px;
    font-weight: 600;
    color: var(--text);
    letter-spacing: 0.3px;
  }
  
  .dialog-body {
    min-height: 80px;
    overflow: auto;
    overflow-x: hidden;
  }
  
  .dialog-footer {
    border-top: 1px solid var(--border-color);
    text-align: right;
    padding: 16px 24px;
    background: var(--bg-secondary);
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    
    :deep(.el-button) {
      border-radius: var(--radius-md);
      font-weight: 500;
      padding: 10px 20px;
      transition: var(--transition);
      
      &:hover {
        transform: translateY(-1px);
        box-shadow: var(--shadow-md);
      }
      
      &.el-button--primary {
        background: linear-gradient(135deg, var(--blue) 0%, var(--blue-dark) 100%);
        border: none;
        
        &:hover {
          background: linear-gradient(135deg, var(--blue-light) 0%, var(--blue) 100%);
        }
      }
    }
  }
}
</style>