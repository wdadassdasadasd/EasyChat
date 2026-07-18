import { ref } from 'vue'

export const bootstrapPhase = ref('restoring')
export const bootstrapError = ref('')

let retryBootstrap = () => {}

export const beginBootstrap = () => {
  bootstrapError.value = ''
  bootstrapPhase.value = 'restoring'
}

export const completeBootstrap = () => {
  bootstrapError.value = ''
  bootstrapPhase.value = 'ready'
}

export const failBootstrap = (message, retry) => {
  bootstrapError.value = message
  bootstrapPhase.value = 'failed'
  retryBootstrap = typeof retry === 'function' ? retry : () => {}
}

export const retryFailedBootstrap = () => retryBootstrap()
