import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const Store = require('electron-store')
const store = new Store()
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

const setUserData = (key, value) => {
  if (!userId) {
    console.error('setUserData called before initUserId, key:', key)
    return
  }
  store.set(userId + key, value)
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

export default { initUserId, getUserId, setData, getData, setUserData, getUserData, deleteUserData }
