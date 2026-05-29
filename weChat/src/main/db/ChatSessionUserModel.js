import store from '../store';
import {
    insertOrIgnore,
    queryAll,
    queryOne,
    run,
    transaction,
    update

} from './ADB';


const addChatSession=(sessionInfo)=>{
    sessionInfo.userId=store.getUserId();
    insertOrIgnore("chat_session_user",sessionInfo)
}

const updateChatSession=(sessionInfo)=>{
    const paramData={
        userId:store.getUserId(),
        contactId:sessionInfo.contactId
    }
    const updateInfo=Object.assign({},sessionInfo);
    updateInfo.userId=paramData.userId;
    updateInfo.contactId=paramData.contactId;
    return update("chat_session_user",updateInfo,paramData);

}
const upsertChatSession=(sessionInfo={})=>{
    if(!sessionInfo.contactId){
        return Promise.resolve(0);
    }
    const userId=store.getUserId();
    const sql=[
        "insert into chat_session_user",
        "(user_id,contact_id,contact_type,session_id,status,contact_name,last_message,last_receive_time,no_read_count,member_count,top_type)",
        "values (?,?,?,?,?,?,?,?,?,?,?)",
        "on conflict(user_id,contact_id) do update set",
        "contact_type=coalesce(excluded.contact_type,chat_session_user.contact_type),",
        "session_id=coalesce(excluded.session_id,chat_session_user.session_id),",
        "status=coalesce(excluded.status,chat_session_user.status),",
        "contact_name=coalesce(excluded.contact_name,chat_session_user.contact_name),",
        "last_message=coalesce(excluded.last_message,chat_session_user.last_message),",
        "last_receive_time=coalesce(excluded.last_receive_time,chat_session_user.last_receive_time),",
        "no_read_count=coalesce(excluded.no_read_count,chat_session_user.no_read_count),",
        "member_count=coalesce(excluded.member_count,chat_session_user.member_count),",
        "top_type=coalesce(excluded.top_type,chat_session_user.top_type)"
    ].join(" ");
    return run(sql,[
        userId,
        sessionInfo.contactId,
        sessionInfo.contactType,
        sessionInfo.sessionId,
        sessionInfo.status ?? 1,
        sessionInfo.contactName,
        sessionInfo.lastMessage,
        sessionInfo.lastReceiveTime,
        sessionInfo.noReadCount,
        sessionInfo.memberCount,
        sessionInfo.topType
    ]);
}

const upsertSessionBatchInTransaction=async (chatSessionList=[])=>{
    const sessionMap=new Map();
    chatSessionList.forEach((sessionInfo)=>{
        if(!sessionInfo?.contactId){
            return;
        }
        const previous=sessionMap.get(sessionInfo.contactId) || {};
        sessionMap.set(sessionInfo.contactId,Object.assign({},previous,sessionInfo,{
            status: sessionInfo.status ?? previous.status ?? 1
        }));
    });
    const sessionList=[...sessionMap.values()];
    if(sessionList.length===0){
        return 0;
    }
    return transaction(async()=>{
        let count=0;
        for(const sessionInfo of sessionList){
            count+=await upsertChatSession(sessionInfo);
        }
        return count;
    });
}

const saveOrUpdateChatSessionBatch4Init=async (chatSessionList)=>{
    return upsertSessionBatchInTransaction(chatSessionList);
}

//更新未读数
const updateNoReadCount=({contactId,noReadCount})=>{
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
    let sql="select * from chat_session_user where user_id=? and status=1 order by top_type desc,last_receive_time desc";
    return queryAll(sql,[store.getUserId()])

}

const selectUserSessionByContactId=(contactId)=>{
    let sql="select * from chat_session_user where user_id=? and contact_id=?";
    return queryOne(sql,[store.getUserId(),contactId])

}

const delChatSession=(contactId)=>{
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
     upsertSessionBatchInTransaction,
     updateNoReadCount,
     markSessionRead,
     selectUserSessionList,
     delChatSession,
     topChatSession
}
