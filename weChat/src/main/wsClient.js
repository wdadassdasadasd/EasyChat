import { WebSocket } from "ws";
import { saveOrUpdateChatSessionBatch4Init} from './db/ChatSessionUserModel'
const NODE_ENV=process.env.NODE_ENV
import store from "./store.js";
import { saveMessageBatch} from './db/ChatMessageModel'
import { updateNoReadCount} from './db/UserSettingModel'

let ws=null;
let maxReConnectTimes=null;

let wsUrl=null;
let webContentsSender=null;
let needReconnect=null;
let lockReconnect=false;
let heartbeatTimer=null;
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
                console.log("发送心跳");
                ws.send("heart beat");
            }
        },10000);
        maxReConnectTimes=5;
    }
    //客户端 WebSocket 收到服务端推送消息时，处理这条消息
    ws.onmessage = async function (e) {
    console.log('收到服务消息', e.data);

    let message = null;

    try {
        message = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    } catch (error) {
        console.error('WebSocket 消息解析失败', error);
        return;
    }

    const messageType = message.messageType;

    switch (messageType) {
        case 0: {
            // WebSocket 初始化消息
            const chatSessionList = (message.extendData?.chatSessionList || []).filter((item) => {
                return item.contactName !== 'EasyChat';
            });

            await saveOrUpdateChatSessionBatch4Init(chatSessionList);

            const chatMessageList = message.extendData?.chatMessageList || [];
            await saveMessageBatch(chatMessageList);
            //更新未读数
            await updateNoReadCount({
                useId: store.getUserId(),
                noReadCount: message.extendData?.contact?.applyCount || 0
            });

            webContentsSender.send('receiveMessage', {
                messageType: message.messageType
            });

            break;
        }

        default: {
            // 普通聊天消息
            await saveMessageBatch([message]);

            webContentsSender.send('receiveMessage', message);

            break;
        }
    }
};

    ws.onclose=function(){
        console.log("关闭客户端连接重连")
        reconnet();
        

    }
    ws.onerror=function()
    {
        console.log("连接失败了准备重连")
        reconnet();


    }
    const reconnet=()=>{
        if(!needReconnect){
            console.log("连接断开无需重连")
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
    setInterval(()=>{
        if(ws!=null&&ws.readyState==1){
            ws.send("heart beat");
        }
    })

}

export {
    initWs,
    closeWs
}