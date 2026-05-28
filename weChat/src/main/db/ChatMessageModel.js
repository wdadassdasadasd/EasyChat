import store from '../store';
import {
    insertOrReplace,
    insertOrIgnore,
    queryAll,
    queryOne,
    queryCount,
    run,
    insert,
    update

} from './ADB';
import { updateNoReadCount } from './ChatSessionUserModel';


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

const saveMessage=async (data)=>{
    if (await isMessageBeforeClear(data)) {
        return 0;
    }
    // 获取当前用户 ID，绑定到消息数据
    data.userId=store.getUserId();
    // 插入或替换消息到数据库
    return insertOrReplace("chat_message",data) 

}


const saveMessageBatch=(chatMeassageList)=>{
     return new Promise(async(resolve,reject)=>{
        const visibleMessageList = [];
        for (let item of chatMeassageList) {
            if (!(await isMessageBeforeClear(item))) {
                visibleMessageList.push(item);
            }
        }

        const chatSessionCountMap={}
        visibleMessageList.forEach((item)=>{
            if(item.sendUserId==store.getUserId()){
                return;
            }
            let contactId=item.contactType==1?item.contactId:item.sendUserId;
            let noReadCount=chatSessionCountMap[contactId];
            if(!noReadCount){
                chatSessionCountMap[contactId]=1
            }
            else{
                chatSessionCountMap[contactId]=noReadCount+1;
            }
        })
        //更新未读数
        for(let item in chatSessionCountMap){
            await updateNoReadCount({contactId:item,noReadCount:chatSessionCountMap[item]})

        }

        //批量插入
        for(let item of visibleMessageList){
            await saveMessage(item);

        }
        resolve();

    })
}

const updateMessageStatus=(messageId,status=1)=>{
    if(!messageId){
        return Promise.resolve();
    }
    return update("chat_message",{
        status
    },{
        userId:store.getUserId(),
        messageId
    })
}


const getPageOffset=(pageNo=1,totalCount)=>{
    const pageSize=20;
    const pageTotal=totalCount%pageSize==0?totalCount/pageSize:Math.floor(totalCount/pageSize)+1;
    pageNo=pageNo<=1?1:pageNo;
    return {
        pageTotal,
        offset:(pageNo-1)*pageSize,
        limit:pageSize
    }

}

const selectMesssageList = (query = {}) => {
    return new Promise(async (resolve) => {
        const { sessionId, pageNo = 1, maxMessageId } = query;

        if (!sessionId) {
            resolve({
                dataList: [],
                pageNo,
                pageTotal: 0
            });
            return;
        }

        const clearInfo = await getClearInfoBySessionId(sessionId);
        const countSqlParts = ['select count(1) as total from chat_message where user_id=? and session_id=?'];
        const countParams = [store.getUserId(), sessionId];
        appendClearFilter(countSqlParts, countParams, clearInfo);

        if (maxMessageId) {
            countSqlParts.push('and message_id<?');
            countParams.push(maxMessageId);
        }

        const totalCount = await queryCount(countSqlParts.join(' '), countParams);
        const { pageTotal, offset, limit } = getPageOffset(pageNo, totalCount);

        const sqlParts = ['select * from chat_message where user_id=? and session_id=?'];
        const params = [store.getUserId(), sessionId];
        appendClearFilter(sqlParts, params, clearInfo);

        if (maxMessageId) {
            sqlParts.push('and message_id<?');
            params.push(maxMessageId);
        }

        sqlParts.push('order by message_id desc limit ?,?');
        params.push(offset, limit);

        let dataList = await queryAll(sqlParts.join(' '), params);
        dataList = dataList.sort((a, b) => a.messageId - b.messageId);

        resolve({
            dataList,
            pageNo,
            pageTotal
        });
    });
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

const searchMessageBySessionId = ({ sessionId, keyword } = {}) => {
    return new Promise(async (resolve) => {
        const searchKey = String(keyword || '').trim();
        if (!sessionId || !searchKey) {
            resolve([]);
            return;
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
        resolve(dataList || []);
    });
};

export {
    saveMessage,
    saveMessageBatch,
    updateMessageStatus,
    selectMesssageList,
    selectMesssageList as selectMessageList,
    clearMessageBySessionId,
    searchMessageBySessionId
}
