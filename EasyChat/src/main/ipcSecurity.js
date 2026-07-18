const normalizeRendererUrl = (value) => {
  try {
    const url = new URL(String(value || ''))
    url.hash = ''
    url.search = ''
    return url
  } catch {
    return null
  }
}

let trustedRendererUrl = null

const configureTrustedRendererUrl = (url) => {
  trustedRendererUrl = normalizeRendererUrl(url)
}

const isTrustedRendererUrl = (url) => {
  const candidate = normalizeRendererUrl(url)
  if (!trustedRendererUrl || !candidate) return false
  return candidate.origin === trustedRendererUrl.origin && candidate.pathname === trustedRendererUrl.pathname
}

const isTrustedIpcEvent = (event) => {
  const sender = event?.sender
  const senderFrame = event?.senderFrame
  if (!sender || !senderFrame || sender.isDestroyed?.()) return false
  if (sender.mainFrame && senderFrame !== sender.mainFrame) return false
  return isTrustedRendererUrl(senderFrame.url || sender.getURL?.())
}

const buildUntrustedSenderResult = (channel) => ({
  success: false,
  channel,
  kind: 'untrusted_sender',
  error: 'IPC request rejected: untrusted renderer'
})

export {
  buildUntrustedSenderResult,
  configureTrustedRendererUrl,
  isTrustedIpcEvent,
  isTrustedRendererUrl
}
