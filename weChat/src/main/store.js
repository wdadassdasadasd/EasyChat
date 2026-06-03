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
  store.set(userId + key, value)
}
const getUserData = (key) => {
  return store.get(userId + key)
}
const deleteUserData = (key) => {
  store.delete(userId + key)
}

export default { initUserId, getUserId, setData, getData, setUserData, getUserData, deleteUserData }
