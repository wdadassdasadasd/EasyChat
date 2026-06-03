import store from '../store';
import {
    insertOrReplace,
    queryAll,
    queryOne,
    queryCount,
    runInTransaction,
    run,
    update

} from './ADB';
import { updateNoReadCount } from './ChatSessionUserModel';


const getClearInfoBySessionId = (sessionId) => {
    // 清空聊天记录不只删除现有消息，还保存清空游标用于过滤之后补回来的旧消息。
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

    // 多次清空取更大的 messageId/time，避免旧清空游标覆盖新清空范围。
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
    // WebSocket 初始化或历史补偿可能带来已清空前的消息，落库前统一拦截。
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
    // 查询历史/搜索时也要套清空过滤，保证 UI 与落库过滤规则一致。
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


const saveMessageBatch=async(chatMeassageList)=>{
        if (!Array.isArray(chatMeassageList) || chatMeassageList.length === 0) {
            return 0;
        }
        // 批量保存前先过滤被清空游标覆盖的消息，再统计真正可见的新未读数。
        const visibleMessageList = [];
        for (let item of chatMeassageList) {
            if (!(await isMessageBeforeClear(item))) {
                visibleMessageList.push(item);
            }
        }

        if (visibleMessageList.length === 0) {
            return 0;
        }

        return runInTransaction(async () => {
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
            item.userId=store.getUserId();
            await insertOrReplace("chat_message",item);

        }
        return visibleMessageList.length;
        });
}

const updateMessageStatus=(messageId,status=1)=>{
    // 文件消息的上传回执只需要更新 status，不改消息正文和会话摘要。
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
    // 聊天历史固定 20 条一页，renderer 会把新页 prepend 到已有列表前面。
    const pageSize=20;
    const pageTotal=totalCount%pageSize==0?totalCount/pageSize:Math.floor(totalCount/pageSize)+1;
    pageNo=pageNo<=1?1:pageNo;
    return {
        pageTotal,
        offset:(pageNo-1)*pageSize,
        limit:pageSize
    }

}

const selectMesssageList = async (query = {}) => {
        const { sessionId, pageNo = 1, maxMessageId } = query;

        if (!sessionId) {
            return {
                dataList: [],
                pageNo,
                pageTotal: 0
            };
        }

        // maxMessageId 锁定首次加载时的消息上界，避免向上翻页时混入新消息。
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

        return {
            dataList,
            pageNo,
            pageTotal
        };
};

const clearMessageBySessionId = async (sessionId) => {
    if (!sessionId) {
        return Promise.resolve(0);
    }

    // 先记录当前最大 messageId，再删除本地消息；未来小于等于该 id 的回补会被过滤。
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

        // 搜索只在当前会话可见消息里查正文和文件名，最多返回最近 50 条。
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
    saveMessage,
    saveMessageBatch,
    updateMessageStatus,
    selectMesssageList,
    selectMesssageList as selectMessageList,
    clearMessageBySessionId,
    searchMessageBySessionId
}
