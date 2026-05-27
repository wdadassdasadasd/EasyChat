import { computed, ref } from 'vue';

const getMemberId = (member = {}) => {
    return String(member.userId || member.contactId || member.id || '');
};

const getMemberName = (member = {}) => {
    return String(member.nickName || member.contactName || member.userName || member.name || getMemberId(member));
};

export const useGroupChatDrawer = ({ currentChatSession, proxy }) => {
    const visible = ref(false);
    const loading = ref(false);
    const groupInfo = ref({});
    const memberList = ref([]);
    const searchKey = ref('');
    let activeGroupId = '';
    let loadSeq = 0;

    const filteredMemberList = computed(() => {
        const keyword = (searchKey.value || '').trim().toLowerCase();
        if (!keyword) {
            return memberList.value;
        }

        return memberList.value.filter((member) => {
            const name = getMemberName(member).toLowerCase();
            const memberId = getMemberId(member).toLowerCase();
            return name.includes(keyword) || memberId.includes(keyword);
        });
    });

    const normalizeGroupInfo = (data = {}) => {
        return data.groupInfo || data.group || data || {};
    };

    const normalizeMemberList = (data = {}) => {
        return data.userContactList || data.memberList || data.contactList || [];
    };

    const loadGroupInfo = async () => {
        const groupId = currentChatSession.value?.contactId;
        if (!groupId) {
            return;
        }

        const currentSeq = ++loadSeq;
        loading.value = true;
        const result = await proxy.Request({
            url: proxy.Api.getGroupInfo4Chat,
            params: {
                groupId
            },
            showLoading: false,
            showError: false
        });
        if (currentSeq !== loadSeq) {
            return;
        }
        loading.value = false;

        if (!result) {
            groupInfo.value = {
                groupId,
                groupName: currentChatSession.value.contactName,
                memberCount: currentChatSession.value.memberCount
            };
            memberList.value = [];
            return;
        }

        const data = result.data || {};
        groupInfo.value = normalizeGroupInfo(data);
        memberList.value = normalizeMemberList(data);
        activeGroupId = groupId;
    };

    const openDrawer = async () => {
        if (currentChatSession.value?.contactType != 1) {
            visible.value = false;
            return;
        }

        visible.value = true;
        searchKey.value = '';
        await loadGroupInfo();
    };

    const closeDrawer = () => {
        visible.value = false;
        searchKey.value = '';
    };

    const syncVisible = async (nextVisible) => {
        visible.value = nextVisible;
        if (!nextVisible) {
            closeDrawer();
            return;
        }
        if (activeGroupId !== currentChatSession.value?.contactId) {
            groupInfo.value = {};
            memberList.value = [];
        }
        await openDrawer();
    };

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
    };
};
