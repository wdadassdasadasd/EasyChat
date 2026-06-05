import { computed, ref } from 'vue'

const getMemberId = (member = {}) => {
  return String(member.userId || member.contactId || member.id || '')
}

const getMemberName = (member = {}) => {
  return String(
    member.nickName || member.contactName || member.userName || member.name || getMemberId(member)
  )
}

/**
 * 当前群聊详情抽屉的状态管理入口。
 *
 * 负责加载群资料和成员列表、本地过滤成员，并通过 loadSeq 丢弃快速切换群聊时的过期回包。
 */
export const useGroupChatDrawer = ({ currentChatSession, proxy }) => {
  const visible = ref(false)
  const loading = ref(false)
  const groupInfo = ref({})
  const memberList = ref([])
  const searchKey = ref('')
  let activeGroupId = ''
  let loadSeq = 0

  const filteredMemberList = computed(() => {
    const keyword = (searchKey.value || '').trim().toLowerCase()
    if (!keyword) {
      return memberList.value
    }

    return memberList.value.filter((member) => {
      const name = getMemberName(member).toLowerCase()
      const memberId = getMemberId(member).toLowerCase()
      return name.includes(keyword) || memberId.includes(keyword)
    })
  })

  const normalizeGroupInfo = (data = {}) => {
    return (
      data.groupInfo ||
      data.groupInfoVO?.groupInfo ||
      data.groupInfoVo?.groupInfo ||
      data.group ||
      data ||
      {}
    )
  }

  const normalizeMemberList = (data = {}) => {
    return (
      data.userContactList ||
      data.groupInfoVO?.userContactList ||
      data.groupInfoVo?.userContactList ||
      data.memberList ||
      data.contactList ||
      []
    )
  }

  const loadGroupInfo = async () => {
    const groupId = currentChatSession.value?.contactId
    if (!groupId) {
      return
    }

    // 抽屉可能在不同群聊间快速切换，loadSeq 用来丢弃过期的群资料回包。
    const currentSeq = ++loadSeq
    loading.value = true
    try {
      const result = await proxy.Request({
        url: proxy.Api.getGroupInfo4Chat,
        params: {
          groupId
        },
        showLoading: false,
        showError: false
      })
      if (currentSeq !== loadSeq) {
        return
      }

      if (!result) {
        groupInfo.value = {
          groupId,
          groupName: currentChatSession.value.contactName,
          memberCount: currentChatSession.value.memberCount
        }
        memberList.value = []
        return
      }

      const data = result.data || {}
      groupInfo.value = normalizeGroupInfo(data)
      memberList.value = normalizeMemberList(data)
      activeGroupId = groupId
    } catch (error) {
      console.error('loadGroupInfo failed', error)
      if (currentSeq === loadSeq) {
        groupInfo.value = {
          groupId,
          groupName: currentChatSession.value.contactName,
          memberCount: currentChatSession.value.memberCount
        }
        memberList.value = []
      }
    } finally {
      if (currentSeq === loadSeq) {
        loading.value = false
      }
    }
  }

  const openDrawer = async () => {
    if (currentChatSession.value?.contactType != 1) {
      visible.value = false
      return
    }

    // 群聊抽屉只服务群会话，每次打开都刷新成员列表和群资料。
    visible.value = true
    searchKey.value = ''
    await loadGroupInfo()
  }

  const closeDrawer = () => {
    visible.value = false
    searchKey.value = ''
  }

  const syncVisible = async (nextVisible) => {
    visible.value = nextVisible
    if (!nextVisible) {
      closeDrawer()
      return
    }
    // 切换到另一个群时先清空旧数据，避免 loading 期间展示上一群成员。
    if (activeGroupId !== currentChatSession.value?.contactId) {
      groupInfo.value = {}
      memberList.value = []
    }
    await openDrawer()
  }

  return {
    closeDrawer,
    filteredMemberList,
    getMemberId,
    getMemberName,
    groupInfo,
    loading,
    memberList,
    openDrawer,
    searchKey,
    syncVisible,
    visible
  }
}
