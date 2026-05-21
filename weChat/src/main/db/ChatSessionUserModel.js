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
const saveOrUpdateChatSessionBatch4Init=async (chatSessionList)=>{
    for(let i=0;i<chatSessionList.length;i++)
    {
        const sessionInfo=chatSessionList[i];
        sessionInfo.status=1;
        let sessionData=await selectUserSessionByContactId(sessionInfo.contactId)
        if(sessionData){
            await updateChatSession(sessionInfo)
        }else{
            await addChatSession(sessionInfo);
        }
    }
}

//更新未读数
const updateNoReadCount=({contactId,noReadCount})=>{
    let sql="update chat_session_user set no_read_count=? where user_id=? and contact_id=?";
    return run(sql,[noReadCount,store.getUserId(),contactId])

}

//查询用户会话列表
const selectUserSessionList=()=>{
    let sql="select * from chat_session_user where user_id=? and status=1";
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
     updateNoReadCount,
     selectUserSessionList,
     delChatSession,
     topChatSession
}