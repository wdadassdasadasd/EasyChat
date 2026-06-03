import { ref } from 'vue'

export const useUserChatDrawer = ({ currentChatSession, proxy }) => {
  const visible = ref(false)
  const loading = ref(false)
  const userInfo = ref({})
  let activeContactId = ''
  let loadSeq = 0

  const getFallbackUserInfo = () => {
    return {
      userId: currentChatSession.value?.contactId,
      contactId: currentChatSession.value?.contactId,
      nickName: currentChatSession.value?.contactName,
      contactName: currentChatSession.value?.contactName
    }
  }

  const loadUserInfo = async () => {
    const contactId = currentChatSession.value?.contactId
    if (!contactId) {
      userInfo.value = {}
      return
    }

    // 单聊详情也可能被快速切换，loadSeq 防止旧联系人资料覆盖新会话。
    const currentSeq = ++loadSeq
    loading.value = true
    try {
      const result = await proxy.Request({
        url: proxy.Api.getContactUserInfo,
        params: {
          contactId
        },
        showLoading: false,
        showError: false
      })
      if (currentSeq !== loadSeq) {
        return
      }

      userInfo.value = result?.data || getFallbackUserInfo()
      activeContactId = contactId
    } catch (error) {
      console.error('loadUserInfo failed', error)
      if (currentSeq === loadSeq) {
        userInfo.value = getFallbackUserInfo()
      }
    } finally {
      if (currentSeq === loadSeq) {
        loading.value = false
      }
    }
  }

  const openDrawer = async () => {
    if (currentChatSession.value?.contactType == 1) {
      visible.value = false
      return
    }

    // 用户抽屉只服务单聊；群聊详情由 GroupChatDrawer 单独处理。
    visible.value = true
    await loadUserInfo()
  }

  const closeDrawer = () => {
    visible.value = false
  }

  const syncVisible = async (nextVisible) => {
    visible.value = nextVisible
    if (!nextVisible) {
      closeDrawer()
      return
    }
    // 换联系人时先清空旧资料，避免异步加载期间展示上一个人的信息。
    if (activeContactId !== currentChatSession.value?.contactId) {
      userInfo.value = {}
    }
    await openDrawer()
  }

  return {
    closeDrawer,
    loading,
    openDrawer,
    syncVisible,
    userInfo,
    visible
  }
}
