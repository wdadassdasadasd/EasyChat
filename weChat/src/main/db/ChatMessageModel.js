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

        let countSql = 'select count(1) as total from chat_message where user_id=? and session_id=?';
        const countParams = [store.getUserId(), sessionId];

        if (maxMessageId) {
            countSql += ' and message_id<?';
            countParams.push(maxMessageId);
        }

        const totalCount = await queryCount(countSql, countParams);
        const { pageTotal, offset, limit } = getPageOffset(pageNo, totalCount);

        let sql = 'select * from chat_message where user_id=? and session_id=?';
        const params = [store.getUserId(), sessionId];

        if (maxMessageId) {
            sql += ' and message_id<?';
            params.push(maxMessageId);
        }

        sql += ' order by message_id desc limit ?,?';
        params.push(offset, limit);

        let dataList = await queryAll(sql, params);
        dataList = dataList.sort((a, b) => a.messageId - b.messageId);

        resolve({
            dataList,
            pageNo,
            pageTotal
        });
    });
};

export {
    saveMessage,
    saveMessageBatch,
    updateMessageStatus,
    selectMesssageList,
    selectMesssageList as selectMessageList
}
