import { app, BrowserWindow,ipcMain } from 'electron'
import {initWs} from './wsClient.js'
import store from './store.js'
import { addUserSetting } from './db/UserSettingModel.js';
import { selectUserSessionList,delChatSession,topChatSession,saveOrUpdateChatSessionBatch4Init} from './db/ChatSessionUserModel.js';
import { clearMessageBySessionId, selectMessageList, saveMessage } from './db/ChatMessageModel.js';
const Node_ENV=process.env.NODE_ENV;
//通知主进程切换登录/注册窗口
const onLoginOnRegister=(mainWindow, callback)=>{
      ipcMain.on("loginOrRegister",(e,isLogin)=>{
        callback(isLogin);
      });
}

//初始化用户数据，并启动ws
const onLoginSuccess=(mainWindow, callback)=>{
    ipcMain.on("openChat",(e,config)=>{
        store.initUserId(config.userId);
        store.setUserData("token",config.token);
        addUserSetting(config.userId,config.email);
        callback(config);
        initWs(config,e.sender);
    })
}

const winTitleOp=(callback)=>{
    ipcMain.on("winTitleOp",(e,data)=>{
        callback(e,data);
    })
}

//存数据到主进程store
const onSetLocalStore=()=>{
    ipcMain.on("SetLocalStore",(e,{key,value})=>{
        store.setData(key,value)
    })
}

const onGetLocalStore=()=>{
      ipcMain.on("GetLocalStore",(e,payload)=>{
        const key = typeof payload === 'string' ? payload : payload?.key;
        if(!key){
            return;
        }
        const value = store.getData(key);
        console.log("收到渲染进程的获取事件Key:",key)
        e.sender.send("getLocalStoreCallback",value)

    })

}


//查询本地会话列表
const onLoadSessionData=()=>{
    ipcMain.on("loadSessionData",async (e)=>{
        const result=await selectUserSessionList();
        e.sender.send("loadSessionDataCallback",result);
    })

}

const onDelChatSession=()=>{
    ipcMain.on("delChatSession",(e,contactId)=>{
        delChatSession(contactId);

    })
}

const onTopChatSession=()=>{
    ipcMain.on("topChatSession",(e,{contactId,topType})=>{
        topChatSession(contactId,topType);

    })
}

//分页查询聊天消息
const onLoadChatMessage=()=>{
    ipcMain.on("loadChatMessage",async (e,data)=>{
        const result=await selectMessageList(data);
        e.sender.send("loadChatMessageCallback",{
            ...result,
            sessionId: data?.sessionId,
            loadSeq: data?.loadSeq
        });
    })

}



//保存发送的消息到本地，并更新会话
const onSaveSendMessage = () => {
    ipcMain.on('saveSendMessage', async (e, { message, chatSession }) => {
        if (!message) {
            return;
        }
        //保存发送的消息到chat_message 表
        await saveMessage(message);

        const sessionInfo = {
            contactId: chatSession?.contactId || message.contactId,
            contactType: chatSession?.contactType ?? message.contactType,
            sessionId: message.sessionId || chatSession?.sessionId,
            status: 1,
            contactName: chatSession?.contactName || message.contactName,
            lastMessage: message.messageContent,
            lastReceiveTime: message.sendTime || Date.now(),
            memberCount: chatSession?.memberCount,
            noReadCount: 0
        };

        await saveOrUpdateChatSessionBatch4Init([sessionInfo]);

        e.sender.send('saveSendMessageCallback', {
            success: true,
            messageId: message.messageId
        });
    });
};

const onClearChatMessage = () => {
    ipcMain.on('clearChatMessage', async (e, { sessionId } = {}) => {
        await clearMessageBySessionId(sessionId);
        e.sender.send('clearChatMessageCallback', {
            success: true,
            sessionId
        });
    });
};
export {
    onLoginOnRegister,
    onLoginSuccess,
    winTitleOp,
    onSetLocalStore,
    onGetLocalStore,
    onLoadSessionData,
    onDelChatSession,
    onTopChatSession,
    onLoadChatMessage,
    onSaveSendMessage,
    onClearChatMessage
};
