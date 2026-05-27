import { computed, ref } from 'vue';
import ContextMenu from '@imengyu/vue3-context-menu';

export const useChatSessions = ({ proxy, route }) => {
    const chatSessionList = ref([]);
    const currentChatSession = ref({});
    let selectSession = () => {};

    const hasCurrentChat = computed(() => Object.keys(currentChatSession.value).length > 0);

    const getRealSessionName = (session = {}) => {
        const realName = session.contactName || session.groupName || session.nickName || '';
        if (realName && realName != session.contactId) {
            return realName;
        }
        return '';
    };

    const getSessionName = (session = {}) => {
        return getRealSessionName(session) || session.contactId || '';
    };

    const currentChatSessionTitle = computed(() => {
        return getSessionName(currentChatSession.value);
    });

    const welcomeText = computed(() => {
        if (currentChatSession.value.contactType == 1) {
            return `${currentChatSessionTitle.value} 已创建好，快来开始群聊吧`;
        }
        return `欢迎和 ${currentChatSessionTitle.value || ''} 开始聊天`;
    });

    const setSessionSelector = (handler) => {
        selectSession = handler;
    };

    const loadChatSession = () => {
        window.ipcRenderer.send('loadSessionData');
    };

    const sortChatSessionList = (dataList) => {
        dataList.sort((a, b) => {
            const topTypeResult = b.topType - a.topType;
            if (topTypeResult == 0) {
                return b.lastReceiveTime - a.lastReceiveTime;
            }
            return topTypeResult;
        });
    };

    const delChatSessionList = (contactId) => {
        chatSessionList.value = chatSessionList.value.filter((item) => {
            return item.contactId != contactId;
        });
    };

    const getContactTypeValue = (type) => {
        if (type === 'GROUP' || type == 1) {
            return 1;
        }
        return 0;
    };

    const getSessionInfoFromServer = async (contactId, contactType) => {
        if (!contactId) {
            return {};
        }

        if (contactType == 1) {
            const result = await proxy.Request({
                url: proxy.Api.getGroupInfo,
                params: {
                    groupId: contactId
                },
                showLoading: false,
                showError: false
            });

            const groupInfo = result?.data?.groupInfo || result?.data?.group || result?.data || {};
            const groupName = groupInfo.groupName || result?.data?.groupName;
            return {
                contactId,
                contactType,
                contactName: groupName,
                memberCount: groupInfo.memberCount,
                groupName
            };
        }

        const result = await proxy.Request({
            url: proxy.Api.getContactUserInfo,
            params: {
                contactId
            },
            showLoading: false,
            showError: false
        });

        const userInfo = result?.data || {};
        return {
            contactId,
            contactType,
            contactName: userInfo.contactName || userInfo.nickName,
            nickName: userInfo.nickName
        };
    };

    const fillSessionName = async (session) => {
        if (!session?.contactId) {
            return session;
        }
        if (session.contactType != 1 && getRealSessionName(session)) {
            return session;
        }
        const serverInfo = await getSessionInfoFromServer(session.contactId, session.contactType);
        return Object.assign({}, session, serverInfo, {
            contactName: serverInfo.contactName || session.contactName
        });
    };

    const syncCurrentSession = (session) => {
        if (currentChatSession.value.contactId == session.contactId) {
            currentChatSession.value = Object.assign({}, currentChatSession.value, session);
        }
    };

    const hydrateSessionList = async (dataList = []) => {
        const hydratedList = await Promise.all(dataList.map(fillSessionName));
        hydratedList.forEach(syncCurrentSession);
        return hydratedList;
    };

    const openChatFromRoute = async () => {
        const chatId = route.query.chatId;
        if (!chatId) {
            return;
        }

        const contactType = getContactTypeValue(route.query.type);
        let session = chatSessionList.value.find((item) => item.contactId == chatId);
        if (session) {
            if (route.query.contactName && (session.contactType == 1 || !getRealSessionName(session))) {
                session = Object.assign({}, session, {
                    contactName: route.query.contactName,
                    memberCount: route.query.memberCount || session.memberCount
                });
            }
            session = await fillSessionName(session);
            const index = chatSessionList.value.findIndex((item) => item.contactId == chatId);
            if (index !== -1) {
                chatSessionList.value[index] = session;
            }
            selectSession(session);
            return;
        }

        const serverInfo = await getSessionInfoFromServer(chatId, contactType);
        session = {
            contactId: chatId,
            contactType,
            contactName: serverInfo.contactName || route.query.contactName || chatId,
            memberCount: serverInfo.memberCount,
            status: 1,
            topType: 0,
            noReadCount: 0
        };
        chatSessionList.value.unshift(session);
        selectSession(session);
    };

    const registerSessionListener = () => {
        window.ipcRenderer.on('loadSessionDataCallback', async (e, dataList) => {
            const hydratedList = await hydrateSessionList(dataList || []);
            sortChatSessionList(hydratedList);
            chatSessionList.value = hydratedList;
            openChatFromRoute();
        });
    };

    const removeSessionListener = () => {
        window.ipcRenderer.removeAllListeners('loadSessionDataCallback');
    };

    const setChatSessionTop = (contactId, topType) => {
        const session = chatSessionList.value.find((item) => item.contactId == contactId);
        if (session) {
            session.topType = topType;
        }
        if (currentChatSession.value.contactId == contactId) {
            currentChatSession.value = Object.assign({}, currentChatSession.value, {
                topType
            });
        }
        sortChatSessionList(chatSessionList.value);
        window.ipcRenderer.send('topChatSession', { contactId, topType });
    };

    const setTop = (data) => {
        setChatSessionTop(data.contactId, data.topType == 0 ? 1 : 0);
    };

    const delChatSession = (contactId) => {
        delChatSessionList(contactId);
        currentChatSession.value = {};
        window.ipcRenderer.send('delChatSession', contactId);
    };

    const onContextmenu = (data, e) => {
        e.preventDefault();
        ContextMenu.showContextMenu({
            x: e.x,
            y: e.y,
            items: [
                {
                    label: data.topType == 0 ? '置顶' : '取消置顶',
                    onClick: () => {
                        setTop(data);
                    }
                },
                {
                    label: '删除聊天',
                    onClick: () => {
                        proxy.Confirm({
                            message: '确认删除吗？',
                            okfun: () => {
                                delChatSession(data.contactId);
                            }
                        });
                    }
                }
            ]
        });
    };

    return {
        chatSessionList,
        currentChatSession,
        currentChatSessionTitle,
        hasCurrentChat,
        loadChatSession,
        onContextmenu,
        openChatFromRoute,
        registerSessionListener,
        removeSessionListener,
        setChatSessionTop,
        setSessionSelector,
        welcomeText
    };
};
