import fs from 'fs'

const STORE_OBFUSCATION_KEY = 'EasyChat.desktop.store.obfuscation.v1'

const isPlainObject = (value) => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const migratePlaintextStore = (store, { readFileSync = fs.readFileSync } = {}) => {
  if (!store?.path) {
    return false
  }

  let parsed
  try {
    const raw = readFileSync(store.path, 'utf8')
    parsed = JSON.parse(String(raw).replace(/^\uFEFF/, ''))
  } catch {
    return false
  }

  if (!isPlainObject(parsed)) {
    return false
  }

  // Assigning the full snapshot makes electron-store rewrite the existing JSON
  // using its configured encryptionKey while preserving every legacy key.
  store.store = parsed
  return true
}

export { STORE_OBFUSCATION_KEY, migratePlaintextStore }
