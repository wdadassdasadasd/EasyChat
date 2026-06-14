const isRequestFailure = (result) => Boolean(result && result.success === false)

const getSendFailureMessage = (
  result,
  fallback = '消息发送失败，请检查网络后重试。'
) => {
  if (!isRequestFailure(result)) {
    return fallback
  }
  if (result.kind === 'timeout') {
    return '消息发送超时，请检查网络后重试。'
  }
  if (result.kind === 'auth_expired') {
    return '登录已过期，请重新登录后再发送。'
  }
  if (result.kind === 'api_code' && result.msg) {
    return result.msg
  }
  if (result.kind === 'http_status') {
    return '服务器暂时不可用，请稍后重试。'
  }
  if (result.kind === 'canceled') {
    return '请求已取消。'
  }
  return fallback
}

const getUploadFailureMessage = (result, canceled = false) => {
  if (canceled || result?.kind === 'canceled') {
    return '文件上传已取消。'
  }
  if (result?.kind === 'timeout') {
    return '文件上传超时，请检查网络后重试。'
  }
  if (result?.kind === 'api_code' && result.msg) {
    return result.msg
  }
  if (result?.kind === 'http_status') {
    return '文件上传服务暂时不可用，请稍后重试。'
  }
  return '文件上传失败，请检查网络后重试。'
}

export { getSendFailureMessage, getUploadFailureMessage, isRequestFailure }
