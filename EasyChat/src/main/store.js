import { createRequire } from 'module'
import { STORE_OBFUSCATION_KEY, migratePlaintextStore } from './storeMigration.js'

const require = createRequire(import.meta.url)
const Store = require('electron-store')
// electron-store documents encryptionKey as obfuscation, not secure credential storage.
// The stable application key keeps existing installations readable across upgrades.
const store = new Store({
  encryptionKey: STORE_OBFUSCATION_KEY
})
migratePlaintextStore(store)
let userId = null
const initUserId = (_userId) => {
  userId = _userId
}

const getUserId = () => {
  return userId
}
const setData = (key, value) => {
  store.set(key, value)
}
const getData = (key) => {
  return store.get(key)
}
const deleteData = (key) => {
  store.delete(key)
}

const clearLegacyTokenData = () => {
  const keys = Object.keys(store.store || {})
  keys.filter((key) => /token$/i.test(key)).forEach((key) => store.delete(key))
}

const setUserData = (key, value) => {
  if (!userId) {
    console.error('setUserData called before initUserId, key:', key)
    return
  }
  store.set(userId + key, value)
}
const getUserStoreKey = (targetUserId, key) => {
  if (!targetUserId) {
    throw new Error('userId is required')
  }
  return targetUserId + key
}
const setUserDataForUser = (targetUserId, key, value) => {
  store.set(getUserStoreKey(targetUserId, key), value)
}
const getUserDataForUser = (targetUserId, key) => {
  return store.get(getUserStoreKey(targetUserId, key))
}
const deleteUserDataForUser = (targetUserId, key) => {
  store.delete(getUserStoreKey(targetUserId, key))
}
const getUserData = (key) => {
  if (!userId) {
    console.error('getUserData called before initUserId, key:', key)
    return undefined
  }
  return store.get(userId + key)
}
const deleteUserData = (key) => {
  if (!userId) {
    console.error('deleteUserData called before initUserId, key:', key)
    return
  }
  store.delete(userId + key)
}

export default {
  initUserId,
  getUserId,
  setData,
  getData,
  deleteData,
  clearLegacyTokenData,
  setUserData,
  getUserData,
  deleteUserData,
  setUserDataForUser,
  getUserDataForUser,
  deleteUserDataForUser
}
