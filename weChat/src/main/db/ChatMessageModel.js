import store from '../store';
import {
    insertOrReplace,
    insertOrReplaceStrict,
    queryAll,
    queryOne,
    runInTransaction,
    runStrict,
    run,
    update
} from './ADB';

const getClearInfoBySessionId = (sessionId) => {
    if (!sessionId) {
        return Promise.resolve(null);
    }

    const sql = 'select clear_message_id, clear_time from chat_session_clear where user_id=? and session_id=?';
    return queryOne(sql, [store.getUserId(), sessionId]);
};

const getMaxMessageIdBySessionId = async (sessionId) => {
    if (!sessionId) {
        return 0;
    }

    const sql = 'select max(message_id) as max_message_id from chat_message where user_id=? and session_id=?';
    const result = await queryOne(sql, [store.getUserId(), sessionId]);
    return Number(result?.maxMessageId || 0);
};

const saveClearInfoBySessionId = async (sessionId, clearMessageId) => {
    if (!sessionId) {
        return 0;
    }

    const previousClearInfo = await getClearInfoBySessionId(sessionId);
    const nextClearMessageId = Math.max(Number(previousClearInfo?.clearMessageId || 0), Number(clearMessageId || 0));
    const nextClearTime = Math.max(Number(previousClearInfo?.clearTime || 0), Date.now());
    const sql = [
        'insert or replace into chat_session_clear',
        '(user_id, session_id, clear_message_id, clear_time)',
        'values (?, ?, ?, ?)'
    ].join(' ');

    return run(sql, [store.getUserId(), sessionId, nextClearMessageId, nextClearTime]);
};

const isMessageBeforeClear = async (message = {}) => {
    const sessionId = message.sessionId;
    if (!sessionId) {
        return false;
    }

    const clearInfo = await getClearInfoBySessionId(sessionId);
    if (!clearInfo) {
        return false;
    }

    const clearMessageId = Number(clearInfo.clearMessageId || 0);
    const messageId = Number(message.messageId || 0);
    if (clearMessageId > 0 && messageId > 0) {
        return messageId <= clearMessageId;
    }

    const clearTime = Number(clearInfo.clearTime || 0);
    const sendTime = Number(message.sendTime || 0);
    return clearTime > 0 && sendTime > 0 && sendTime <= clearTime;
};

const filterVisibleMessages = async (messageList = []) => {
    const visibleMessageList = [];
    if (!Array.isArray(messageList)) {
        return visibleMessageList;
    }

    for (let item of messageList) {
        if (!(await isMessageBeforeClear(item))) {
            visibleMessageList.push(item);
        }
    }

    return visibleMessageList;
};

const messageExists = async (messageId) => {
    if (!messageId) {
        return false;
    }

    const sql = 'select message_id from chat_message where user_id=? and message_id=? limit 1';
    const result = await queryOne(sql, [store.getUserId(), messageId]);
    return Boolean(result);
};

const filterNewMessages = async (messageList = []) => {
    const newMessageList = [];
    const messageIdSet = new Set();
    if (!Array.isArray(messageList)) {
        return newMessageList;
    }

    for (let item of messageList) {
        const messageId = item?.messageId;
        if (!messageId) {
            newMessageList.push(item);
            continue;
        }
        const messageKey = String(messageId);
        if (messageIdSet.has(messageKey) || await messageExists(messageId)) {
            continue;
        }
        messageIdSet.add(messageKey);
        newMessageList.push(item);
    }

    return newMessageList;
};

const appendClearFilter = (sqlParts, params, clearInfo) => {
    const clearMessageId = Number(clearInfo?.clearMessageId || 0);
    const clearTime = Number(clearInfo?.clearTime || 0);

    if (clearMessageId > 0) {
        sqlParts.push('and message_id>?');
        params.push(clearMessageId);
        return;
    }

    if (clearTime > 0) {
        sqlParts.push('and (send_time is null or send_time>?)');
        params.push(clearTime);
    }
};

const incrementNoReadCountStrict = ({ contactId, noReadCount }) => {
    if (!contactId || !noReadCount) {
        return Promise.resolve(0);
    }
    const sql = 'update chat_session_user set no_read_count=coalesce(no_read_count,0)+? where user_id=? and contact_id=?';
    return runStrict(sql, [noReadCount, store.getUserId(), contactId]);
};

const saveMessage = async (data) => {
    if (await isMessageBeforeClear(data)) {
        return 0;
    }
    data.userId = store.getUserId();
    return insertOrReplace('chat_message', data);
};

const saveMessageBatch = async (chatMessageList) => {
    if (!Array.isArray(chatMessageList) || chatMessageList.length === 0) {
        return {
            savedCount: 0,
            savedMessages: []
        };
    }

    const visibleMessageList = await filterVisibleMessages(chatMessageList);
    if (visibleMessageList.length === 0) {
        return {
            savedCount: 0,
            savedMessages: []
        };
    }

    return runInTransaction(async () => {
        const newMessageList = await filterNewMessages(visibleMessageList);
        if (newMessageList.length === 0) {
            return {
                savedCount: 0,
                savedMessages: []
            };
        }

        const chatSessionCountMap = {};
        newMessageList.forEach((item) => {
            if (item.sendUserId == store.getUserId()) {
                return;
            }
            const contactId = item.contactType == 1 ? item.contactId : item.sendUserId;
            chatSessionCountMap[contactId] = Number(chatSessionCountMap[contactId] || 0) + 1;
        });

        for (let item in chatSessionCountMap) {
            await incrementNoReadCountStrict({
                contactId: item,
                noReadCount: chatSessionCountMap[item]
            });
        }

        for (let item of newMessageList) {
            item.userId = store.getUserId();
            await insertOrReplaceStrict('chat_message', item);
        }

        return {
            savedCount: newMessageList.length,
            savedMessages: newMessageList
        };
    });
};

const updateMessageStatus = (messageId, status = 1) => {
    if (!messageId) {
        return Promise.resolve();
    }
    return update('chat_message', {
        status
    }, {
        userId: store.getUserId(),
        messageId
    });
};

const selectMesssageList = async (query = {}) => {
    const { sessionId, beforeMessageId } = query;
    const pageSize = 20;

    if (!sessionId) {
        return {
            dataList: [],
            hasMore: false
        };
    }

    const clearInfo = await getClearInfoBySessionId(sessionId);
    const sqlParts = ['select * from chat_message where user_id=? and session_id=?'];
    const params = [store.getUserId(), sessionId];
    appendClearFilter(sqlParts, params, clearInfo);

    if (beforeMessageId) {
        sqlParts.push('and message_id<?');
        params.push(beforeMessageId);
    }

    sqlParts.push('order by message_id desc limit ?');
    params.push(pageSize);

    let dataList = await queryAll(sqlParts.join(' '), params);
    dataList = dataList.sort((a, b) => a.messageId - b.messageId);

    return {
        dataList,
        hasMore: dataList.length === pageSize
    };
};

const selectMessageContextByMessageId = async ({ sessionId, messageId } = {}) => {
    if (!sessionId || !messageId) {
        return [];
    }

    const contextSize = 20;
    const clearInfo = await getClearInfoBySessionId(sessionId);
    const olderSqlParts = ['select * from chat_message where user_id=? and session_id=?'];
    const olderParams = [store.getUserId(), sessionId];
    appendClearFilter(olderSqlParts, olderParams, clearInfo);
    olderSqlParts.push('and message_id<=? order by message_id desc limit ?');
    olderParams.push(messageId, contextSize);

    const newerSqlParts = ['select * from chat_message where user_id=? and session_id=?'];
    const newerParams = [store.getUserId(), sessionId];
    appendClearFilter(newerSqlParts, newerParams, clearInfo);
    newerSqlParts.push('and message_id>? order by message_id asc limit ?');
    newerParams.push(messageId, contextSize);

    const olderMessages = await queryAll(olderSqlParts.join(' '), olderParams);
    const newerMessages = await queryAll(newerSqlParts.join(' '), newerParams);
    const messageMap = new Map();
    olderMessages.concat(newerMessages).forEach((message) => {
        if (message?.messageId != null) {
            messageMap.set(String(message.messageId), message);
        }
    });

    return Array.from(messageMap.values()).sort((a, b) => a.messageId - b.messageId);
};

const clearMessageBySessionId = async (sessionId) => {
    if (!sessionId) {
        return Promise.resolve(0);
    }

    const maxMessageId = await getMaxMessageIdBySessionId(sessionId);
    await saveClearInfoBySessionId(sessionId, maxMessageId);

    const sql = 'delete from chat_message where user_id=? and session_id=?';
    return run(sql, [store.getUserId(), sessionId]);
};

const escapeLikeKeyword = (keyword = '') => {
    return String(keyword).replace(/[\\%_]/g, (match) => `\\${match}`);
};

const searchMessageBySessionId = async ({ sessionId, keyword } = {}) => {
    const searchKey = String(keyword || '').trim();
    if (!sessionId || !searchKey) {
        return [];
    }

    const clearInfo = await getClearInfoBySessionId(sessionId);
    const likeKeyword = `%${escapeLikeKeyword(searchKey)}%`;
    const sqlParts = [
        'select * from chat_message',
        'where user_id=? and session_id=?',
        'and (message_content like ? escape \'\\\' or file_name like ? escape \'\\\')'
    ];
    const params = [store.getUserId(), sessionId, likeKeyword, likeKeyword];
    appendClearFilter(sqlParts, params, clearInfo);
    sqlParts.push('order by message_id desc limit 50');

    const dataList = await queryAll(sqlParts.join(' '), params);
    return dataList || [];
};

export {
    filterNewMessages,
    filterVisibleMessages,
    saveMessage,
    saveMessageBatch,
    updateMessageStatus,
    selectMesssageList,
    selectMesssageList as selectMessageList,
    selectMessageContextByMessageId,
    clearMessageBySessionId,
    searchMessageBySessionId
};
