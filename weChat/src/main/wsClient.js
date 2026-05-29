import { WebSocket } from "ws";
import { saveOrUpdateChatSessionBatch4Init, upsertSessionBatchInTransaction } from './db/ChatSessionUserModel'
const NODE_ENV=process.env.NODE_ENV
import store from "./store.js";
import { saveMessageBatchInTransaction, updateMessageStatus} from './db/ChatMessageModel'
import { updateNoReadCount} from './db/UserSettingModel'

const MESSAGE_FLUSH_DELAY = 50;
const MESSAGE_BATCH_SIZE = 100;

let ws=null;
let maxReConnectTimes=null;

let wsUrl=null;
let webContentsSender=null;
let needReconnect=null;
let lockReconnect=false;
let heartbeatTimer=null;
let incomingMessageQueue=[];
let incomingFlushTimer=null;
let incomingFlushing=false;

const sendToRenderer=(channel,payload)=>{
    if(!webContentsSender || webContentsSender.isDestroyed?.()){
        return;
    }
    webContentsSender.send(channel,payload);
}

const getReceiveContactId=(message={})=>{
    return message.contactType==1 ? message.contactId : message.sendUserId;
}

const buildSessionPatch=(message={})=>{
    const contactId=getReceiveContactId(message);
    if(!contactId){
        return null;
    }
    return {
        contactId,
        contactType: message.contactType,
        sessionId: message.sessionId,
        status: 1,
        contactName: message.contactName || message.sendUserNickName,
        lastMessage: message.messageContent,
        lastReceiveTime: message.sendTime || Date.now(),
        memberCount: message.memberCount
    };
}

const dedupeSessionPatches=(messages=[],unreadCounts={})=>{
    const patchMap=new Map();
    messages.forEach((message)=>{
        const patch=buildSessionPatch(message);
        if(patch){
            patchMap.set(patch.contactId,Object.assign({},patchMap.get(patch.contactId),patch));
        }
    });
    Object.entries(unreadCounts || {}).forEach(([contactId,noReadCountDelta])=>{
        const previous=patchMap.get(contactId) || { contactId };
        patchMap.set(contactId,Object.assign({},previous,{
            noReadCountDelta
        }));
    });
    return [...patchMap.values()];
}

const emitMessageBatch=(messages,sessionPatches,queuedAt,statusUpdates=[])=>{
    sendToRenderer('receiveMessageBatch',{
        messages,
        sessionPatches,
        statusUpdates,
        stats: {
            batchSize: messages.length + statusUpdates.length,
            queuedAt,
            flushedAt: Date.now()
        }
    });
}

const flushIncomingMessages=async()=>{
    if(incomingFlushing){
        return;
    }
    incomingFlushing=true;
    if(incomingFlushTimer){
        clearTimeout(incomingFlushTimer);
        incomingFlushTimer=null;
    }

    try {
        while(incomingMessageQueue.length>0){
            const batch=incomingMessageQueue.slice(0,MESSAGE_BATCH_SIZE);
            const queuedAt=Math.min(...batch.map((item)=>item.queuedAt));
            const messageList=batch.map((item)=>item.message);
            const preliminarySessionPatches=dedupeSessionPatches(messageList);
            await upsertSessionBatchInTransaction(preliminarySessionPatches);
            const saveResult=await saveMessageBatchInTransaction(messageList);
            const visibleMessages=saveResult.messages || [];
            const sessionPatches=dedupeSessionPatches(visibleMessages,saveResult.unreadCounts);
            const persistedSessionPatches=sessionPatches.map(({ noReadCountDelta, ...sessionPatch }) => sessionPatch);
            await upsertSessionBatchInTransaction(persistedSessionPatches);
            emitMessageBatch(visibleMessages,sessionPatches,queuedAt);
            incomingMessageQueue.splice(0,batch.length);
        }
    } catch (error) {
        console.error('flush incoming messages failed', error);
    } finally {
        incomingFlushing=false;
        if(incomingMessageQueue.length>0){
            scheduleIncomingFlush();
        }
    }
}

const scheduleIncomingFlush=()=>{
    if(incomingFlushTimer){
        return;
    }
    incomingFlushTimer=setTimeout(()=>{
        flushIncomingMessages();
    },MESSAGE_FLUSH_DELAY);
}

const enqueueIncomingMessage=(message)=>{
    incomingMessageQueue.push({
        message,
        queuedAt: Date.now()
    });
    if(incomingMessageQueue.length>=MESSAGE_BATCH_SIZE){
        flushIncomingMessages();
        return;
    }
    scheduleIncomingFlush();
}

const parseWsMessage=(data)=>{
    if(typeof data === 'string'){
        return JSON.parse(data);
    }
    if(Buffer.isBuffer(data)){
        return JSON.parse(data.toString('utf8'));
    }
    return data;
}

const initWs=(config,sender)=>{
    const domainKey = NODE_ENV!=='development' ? 'prodWsDomain' : 'devWsDomain';
    const wsDomain = store.getData(domainKey);
    if(!wsDomain){
        console.log(`未配置${domainKey}，无法建立WS连接`);
        return;
    }
    wsUrl=`${wsDomain}?token=${config.token}`
    webContentsSender=sender;
    needReconnect=true;
    maxReConnectTimes=5;
    createWs();
}
const closeWs=()=>{
    needReconnect=false;
    if(heartbeatTimer){
        clearInterval(heartbeatTimer);
        heartbeatTimer=null;
    }
    if(incomingFlushTimer){
        clearTimeout(incomingFlushTimer);
        incomingFlushTimer=null;
    }
    flushIncomingMessages();
    if(ws){
        ws.close();
    }

}

const createWs=()=>{
    if(wsUrl==null){
        return;
    }
    ws=new WebSocket(wsUrl);
    ws.onopen=function() {
        console.log("客户端连接成功");
        ws.send("heart beat");
        if(heartbeatTimer){
            clearInterval(heartbeatTimer);
        }
        heartbeatTimer=setInterval(()=>{
            if(ws!=null&&ws.readyState===1){
                ws.send("heart beat");
            }
        },10000);
        maxReConnectTimes=5;
    }
    ws.onmessage = async function (e) {
        let message = null;

        try {
            message = parseWsMessage(e.data);
        } catch (error) {
            console.error('WebSocket 消息解析失败', error);
            return;
        }

        const messageType = message.messageType;

        switch (messageType) {
            case 0: {
                const chatSessionList = (message.extendData?.chatSessionList || []).filter((item) => {
                    return item.contactName !== 'EasyChat';
                });

                await saveOrUpdateChatSessionBatch4Init(chatSessionList);

                const chatMessageList = message.extendData?.chatMessageList || [];
                await saveMessageBatchInTransaction(chatMessageList);
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
                await updateMessageStatus(message.messageId, message.status ?? 1);
                emitMessageBatch([],[],Date.now(),[message]);
                break;
            }

           default: {
                enqueueIncomingMessage(message);
                break;
            }
        }
    };

    ws.onclose=function(){
        console.log("关闭客户端连接，准备重连")
        reconnet();
    }
    ws.onerror=function()
    {
        console.log("连接失败，准备重连")
        reconnet();
    }
    const reconnet=()=>{
        if(!needReconnect){
            console.log("连接断开，无需重连")
            return;
        }
        if(ws!=null){
            ws.close();
        }
        if(lockReconnect){
            return;
        }
        lockReconnect=true;
        if(maxReConnectTimes>0){
            console.log("准备重连，剩余重连次数"+maxReConnectTimes,new Date().getTime())
            maxReConnectTimes--;
            setTimeout(() => {
                createWs();
                lockReconnect=false;
            }, 5000);
        }else{
            console.log("连接超时")
        }
    }
}

export {
    initWs,
    closeWs,
    enqueueIncomingMessage,
    flushIncomingMessages
}
