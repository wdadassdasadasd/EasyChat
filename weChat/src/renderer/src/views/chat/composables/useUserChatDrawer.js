import { ref } from 'vue';

export const useUserChatDrawer = ({ currentChatSession, proxy }) => {
    const visible = ref(false);
    const loading = ref(false);
    const userInfo = ref({});
    let activeContactId = '';
    let loadSeq = 0;

    const getFallbackUserInfo = () => {
        return {
            userId: currentChatSession.value?.contactId,
            contactId: currentChatSession.value?.contactId,
            nickName: currentChatSession.value?.contactName,
            contactName: currentChatSession.value?.contactName
        };
    };

    const loadUserInfo = async () => {
        const contactId = currentChatSession.value?.contactId;
        if (!contactId) {
            userInfo.value = {};
            return;
        }

        const currentSeq = ++loadSeq;
        loading.value = true;
        const result = await proxy.Request({
            url: proxy.Api.getContactUserInfo,
            params: {
                contactId
            },
            showLoading: false,
            showError: false
        });
        if (currentSeq !== loadSeq) {
            return;
        }
        loading.value = false;

        userInfo.value = result?.data || getFallbackUserInfo();
        activeContactId = contactId;
    };

    const openDrawer = async () => {
        if (currentChatSession.value?.contactType == 1) {
            visible.value = false;
            return;
        }

        visible.value = true;
        await loadUserInfo();
    };

    const closeDrawer = () => {
        visible.value = false;
    };

    const syncVisible = async (nextVisible) => {
        visible.value = nextVisible;
        if (!nextVisible) {
            closeDrawer();
            return;
        }
        if (activeContactId !== currentChatSession.value?.contactId) {
            userInfo.value = {};
        }
        await openDrawer();
    };

    return {
        closeDrawer,
        loading,
        openDrawer,
        syncVisible,
        userInfo,
        visible
    };
};
