import { safeStorage } from 'electron'
import store from './store.js'

const SECURE_SESSION_KEY = 'secureSessionV1'

const getSecureStorageStatus = () => {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return { available: false, kind: 'secure_storage_unavailable' }
    }
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
      return { available: false, kind: 'secure_storage_unavailable' }
    }
    return { available: true, kind: 'secure_storage_available' }
  } catch {
    return { available: false, kind: 'secure_storage_unavailable' }
  }
}

const clearSecureSession = () => {
  store.deleteData(SECURE_SESSION_KEY)
}

const toStoredSession = (config = {}) => ({
  userId: String(config.userId || ''),
  email: String(config.email || ''),
  nickName: String(config.nickName || ''),
  admin: config.admin,
  token: String(config.token || '')
})

const isValidSession = (session) => Boolean(session?.userId && session?.token)

const saveSecureSession = (config = {}) => {
  const session = toStoredSession(config)
  if (!isValidSession(session)) {
    return { success: false, kind: 'validation_error', error: 'Session userId and token are required' }
  }

  const storage = getSecureStorageStatus()
  if (!storage.available) {
    clearSecureSession()
    return { success: true, persistent: false, kind: storage.kind }
  }

  try {
    const encrypted = safeStorage.encryptString(JSON.stringify(session))
    store.setData(SECURE_SESSION_KEY, { version: 1, ciphertext: encrypted.toString('base64') })
    return { success: true, persistent: true, kind: 'secure_storage_available' }
  } catch {
    clearSecureSession()
    return { success: true, persistent: false, kind: 'secure_storage_unavailable' }
  }
}

const restoreSecureSession = () => {
  const storage = getSecureStorageStatus()
  if (!storage.available) {
    clearSecureSession()
    return { success: false, kind: storage.kind, error: 'Secure session storage is unavailable' }
  }

  const stored = store.getData(SECURE_SESSION_KEY)
  if (!stored?.ciphertext) {
    return { success: false, kind: 'not_authenticated', error: 'No persisted session' }
  }

  try {
    const plain = safeStorage.decryptString(Buffer.from(stored.ciphertext, 'base64'))
    const session = JSON.parse(plain)
    if (!isValidSession(session)) throw new Error('Invalid secure session')
    return { success: true, session: toStoredSession(session) }
  } catch {
    clearSecureSession()
    return { success: false, kind: 'secure_storage_corrupt', error: 'Secure session could not be restored' }
  }
}

export { clearSecureSession, getSecureStorageStatus, restoreSecureSession, saveSecureSession }
