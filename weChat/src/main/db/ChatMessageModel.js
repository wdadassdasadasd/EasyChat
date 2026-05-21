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


const saveMessage=(data)=>{
    // 获取当前用户 ID，绑定到消息数据
    data.userId=store.getUserId();
    // 插入或替换消息到数据库
    return insertOrReplace("chat_message",data) 

}


const saveMessageBatch=(chatMeassageList)=>{
     return new Promise(async(resolve,reject)=>{
        const chatSessionCountMap={}
        chatMeassageList.forEach((item)=>{
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
        for(let item of chatMeassageList){
            await saveMessage(item);

        }
        resolve();

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
const selectMesssageList=(query)=>{
      return new Promise(async(resolve,reject)=>{
        const {sessionId,pageNo,maxMessageId}=query;
        let sql='select count(1) from chat_message where user_id=? and session_id=?';
        const totalCount=await queryCount(sql,[sessionId,store.getUserId()]);
        const {pageTotal,offset,limit}=getPageOffset(pageNo,totalCount);

        const params=[sessionId,store.getUserId()];
        sql='select * from chat_message where user_id=? and session_id=?';
        if(maxMessageId){
            sql=sql+" and message_id<=?";
            params.push(maxMessageId);
        }
        params.push(offset);
        params.push(limit);
        sql=sql=sql+" order by message_id limit ?,?";
        const dataList=await queryAll(sql,params);
        resolve({
            dataList,
            pageNo,
            pageTotal
        })


        

    })

}

export {
    saveMessageBatch,
    selectMesssageList,
    selectMesssageList as selectMessageList
}
