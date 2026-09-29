const checkAvailableVersion = async ({ request, url, appVersion, userId } = {}) => {
  try {
    const result = await request({
      url,
      showError: false,
      params: {
        appVersion,
        ...(userId ? { uid: userId } : {})
      }
    })
    if (!result) return { kind: 'failed' }
    if (!result.data) return { kind: 'latest' }
    return { kind: 'available', update: result.data }
  } catch (error) {
    return { kind: 'failed', error }
  }
}

export { checkAvailableVersion }
