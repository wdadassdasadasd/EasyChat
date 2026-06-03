import store from '../store';
import {
    insertOrReplaceStrict,
    queryAll,
    queryOne,
    run,
    runInTransaction,
    update

} from './ADB';


const saveOrUpdateChatSessionBatch4Init=async (chatSessionList)=>{
    // WebSocket 初始化、普通消息和发送成功统一使用 INSERT OR REPLACE 批量 upsert。
    if (!Array.isArray(chatSessionList) || chatSessionList.length === 0) {
        return;
    }
    const userId = store.getUserId();
    return runInTransaction(async () => {
        for(let i=0;i<chatSessionList.length;i++)
        {
            const sessionInfo={...chatSessionList[i],userId,status:1};
            await insertOrReplaceStrict('chat_session_user', sessionInfo);
        }
    });
}

//更新未读数
const updateNoReadCount=({contactId,noReadCount})=>{
    // noReadCount=0 表示已读清零，其他数值表示在原未读数上累加。
    if(!contactId){
        return Promise.resolve(0);
    }
    if(noReadCount===0){
        let sql="update chat_session_user set no_read_count=0 where user_id=? and contact_id=?";
        return run(sql,[store.getUserId(),contactId])
    }
    let sql="update chat_session_user set no_read_count=coalesce(no_read_count,0)+? where user_id=? and contact_id=?";
    return run(sql,[noReadCount,store.getUserId(),contactId])

}

const markSessionRead=(contactId)=>{
    return updateNoReadCount({contactId,noReadCount:0})
}

//查询用户会话列表
const selectUserSessionList=()=>{
    // renderer 只展示 status=1 的会话；删除会话会把 status 置为 0。
    let sql="select * from chat_session_user where user_id=? and status=1";
    return queryAll(sql,[store.getUserId()])

}

const selectUserSessionBySessionId=(sessionId)=>{
    let sql="select * from chat_session_user where user_id=? and session_id=?";
    return queryOne(sql,[store.getUserId(),sessionId])

}

const clearChatSessionSummaryBySessionId=async (sessionId)=>{
    if(!sessionId){
        return null;
    }
    const sessionData=await selectUserSessionBySessionId(sessionId);
    if(!sessionData){
        return null;
    }
    const sessionInfo={
        lastMessage:'',
        noReadCount:0
    }
    await update("chat_session_user",sessionInfo,{
        userId:store.getUserId(),
        sessionId
    });
    return Object.assign({},sessionData,sessionInfo);
}

const delChatSession=(contactId)=>{
    // 这里不物理删除会话，也不删除消息，方便后续重新打开聊天时继续使用历史记录。
    const paramData={
        userId:store.getUserId(),
        contactId

    }
    const sessionInfo={
        status:0,

    }
    return update("chat_session_user",sessionInfo,paramData);

}


const topChatSession=(contactId,topType)=>{
     const paramData={
        userId:store.getUserId(),
        contactId

    }
    const sessionInfo={
        topType

    }
    return update("chat_session_user",sessionInfo,paramData);

}


export {
     saveOrUpdateChatSessionBatch4Init,
     updateNoReadCount,
     markSessionRead,
     selectUserSessionList,
     selectUserSessionBySessionId,
     clearChatSessionSummaryBySessionId,
     delChatSession,
     topChatSession
}
