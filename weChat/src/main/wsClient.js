import { WebSocket } from "ws";
import { saveOrUpdateChatSessionBatch4Init } from './db/ChatSessionUserModel'
import store from "./store.js";
import { saveMessageBatch, updateMessageStatus } from './db/ChatMessageModel'
import { updateNoReadCount } from './db/UserSettingModel'

const NODE_ENV = process.env.NODE_ENV
const HEARTBEAT_INTERVAL = 10000
const RECEIVE_FLUSH_DELAY = 50
const RECEIVE_FLUSH_MAX = 100

let ws = null;
let maxReConnectTimes = null;
let wsUrl = null;
let webContentsSender = null;
let needReconnect = null;
let lockReconnect = false;
let heartbeatTimer = null;
let reconnectTimer = null;
let receiveQueue = [];
let receiveFlushTimer = null;
let receiveFlushing = false;

const clearHeartbeatTimer = () => {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}

const clearReconnectTimer = () => {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

const clearReceiveFlushTimer = () => {
    if (receiveFlushTimer) {
        clearTimeout(receiveFlushTimer);
        receiveFlushTimer = null;
    }
}

const getMessageContactId = (message = {}) => {
    if (message.contactType == 1) {
        return message.contactId;
    }
    return message.sendUserId == store.getUserId() ? message.contactId : message.sendUserId;
}

const toSessionInfo = (message = {}) => {
    const contactId = getMessageContactId(message);
    return {
        contactId,
        contactType: message.contactType,
        sessionId: message.sessionId,
        status: 1,
        contactName: message.contactName || message.groupName || message.sendUserNickName,
        lastMessage: message.messageContent,
        lastReceiveTime: message.sendTime || Date.now(),
        memberCount: message.memberCount,
        noReadCountDelta: message.sendUserId == store.getUserId() ? 0 : 1
    }
}

const getLatestSessionList = (messages = []) => {
    const sessionMap = new Map();
    messages.forEach((message) => {
        const sessionInfo = toSessionInfo(message);
        if (!sessionInfo.contactId) {
            return;
        }
        const previous = sessionMap.get(sessionInfo.contactId);
        if (!previous || Number(sessionInfo.lastReceiveTime || 0) >= Number(previous.lastReceiveTime || 0)) {
            sessionMap.set(sessionInfo.contactId, sessionInfo);
        } else {
            previous.noReadCountDelta += sessionInfo.noReadCountDelta;
        }
    });

    return Array.from(sessionMap.values()).map((sessionInfo) => {
        const noReadCountDelta = messages.reduce((total, message) => {
            return getMessageContactId(message) == sessionInfo.contactId && message.sendUserId != store.getUserId()
                ? total + 1
                : total;
        }, 0);
        return {
            ...sessionInfo,
            noReadCountDelta
        };
    });
}

const sendToRenderer = (channel, payload) => {
    if (!webContentsSender || webContentsSender.isDestroyed?.()) {
        return;
    }
    webContentsSender.send(channel, payload);
}

const saveAndPublishMessageBatch = async (messages) => {
    if (!messages.length) {
        return;
    }

    const sessions = getLatestSessionList(messages);
    const sessionRows = sessions.map(({ noReadCountDelta, ...sessionInfo }) => sessionInfo);

    // Ensure a new conversation row exists before unread counters are incremented.
    await saveOrUpdateChatSessionBatch4Init(sessionRows);
    await saveMessageBatch(messages);

    sendToRenderer('receiveMessageBatch', {
        messageType: 'batch',
        messages,
        sessions
    });
}

const flushReceiveQueue = async () => {
    clearReceiveFlushTimer();
    if (receiveFlushing) {
        return;
    }
    receiveFlushing = true;

    try {
        while (receiveQueue.length > 0) {
            const messages = receiveQueue.splice(0, RECEIVE_FLUSH_MAX);
            await saveAndPublishMessageBatch(messages);
        }
    } finally {
        receiveFlushing = false;
        if (receiveQueue.length > 0) {
            scheduleReceiveFlush();
        }
    }
}

const scheduleReceiveFlush = () => {
    if (receiveQueue.length >= RECEIVE_FLUSH_MAX) {
        flushReceiveQueue();
        return;
    }
    if (!receiveFlushTimer) {
        receiveFlushTimer = setTimeout(flushReceiveQueue, RECEIVE_FLUSH_DELAY);
    }
}

const enqueueReceiveMessage = (message) => {
    receiveQueue.push(message);
    scheduleReceiveFlush();
}

const startHeartbeat = () => {
    clearHeartbeatTimer();
    if (ws?.readyState === WebSocket.OPEN) {
        ws.send("heart beat");
    }
    heartbeatTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
            console.log("发送心跳");
            ws.send("heart beat");
        }
    }, HEARTBEAT_INTERVAL);
}

const initWs = (config, sender) => {
    const domainKey = NODE_ENV !== 'development' ? 'prodWsDomain' : 'devWsDomain';
    const wsDomain = store.getData(domainKey);
    if (!wsDomain) {
        console.log(`未配置${domainKey}，无法建立WS连接`);
        return;
    }
    wsUrl = `${wsDomain}?token=${config.token}`
    webContentsSender = sender;
    needReconnect = true;
    maxReConnectTimes = 5;
    createWs();
}

const closeWs = () => {
    needReconnect = false;
    lockReconnect = false;
    clearHeartbeatTimer();
    clearReconnectTimer();
    clearReceiveFlushTimer();
    receiveQueue = [];
    if (ws) {
        ws.close();
        ws = null;
    }
}

const handleWsMessage = async (message) => {
    const messageType = message.messageType;

    switch (messageType) {
        case 0: {
            await flushReceiveQueue();
            const chatSessionList = (message.extendData?.chatSessionList || []).filter((item) => {
                return item.contactName !== 'EasyChat';
            });

            await saveOrUpdateChatSessionBatch4Init(chatSessionList);

            const chatMessageList = message.extendData?.chatMessageList || [];
            await saveMessageBatch(chatMessageList);
            await updateNoReadCount({
                useId: store.getUserId(),
                noReadCount: message.extendData?.contact?.applyCount || 0
            });

            sendToRenderer('receiveMessage', {
                messageType: message.messageType
            });
            break;
        }

        case 6: {
            await flushReceiveQueue();
            await updateMessageStatus(message.messageId, message.status ?? 1);
            sendToRenderer('receiveMessage', message);
            break;
        }

        default: {
            enqueueReceiveMessage(message);
            break;
        }
    }
}

const createWs = () => {
    if (wsUrl == null) {
        return;
    }

    clearHeartbeatTimer();
    ws = new WebSocket(wsUrl);

    ws.onopen = function () {
        console.log("客户端连接成功");
        lockReconnect = false;
        maxReConnectTimes = 5;
        startHeartbeat();
    }

    ws.onmessage = async function (e) {
        console.log('收到服务消息', e.data);

        let message = null;
        try {
            message = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        } catch (error) {
            console.error('WebSocket 消息解析失败', error);
            return;
        }

        await handleWsMessage(message);
    };

    ws.onclose = function () {
        console.log("关闭客户端连接，准备重连")
        clearHeartbeatTimer();
        reconnect();
    }

    ws.onerror = function () {
        console.log("连接失败，准备重连")
        clearHeartbeatTimer();
        reconnect();
    }
}

const reconnect = () => {
    if (!needReconnect) {
        console.log("连接断开，无需重连")
        return;
    }
    if (lockReconnect) {
        return;
    }
    lockReconnect = true;

    if (ws) {
        ws.close();
    }

    if (maxReConnectTimes > 0) {
        console.log("准备重连，剩余重连次数" + maxReConnectTimes, new Date().getTime())
        maxReConnectTimes--;
        clearReconnectTimer();
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            createWs();
        }, 5000);
    } else {
        console.log("连接超时")
    }
}

export {
    initWs,
    closeWs
}
