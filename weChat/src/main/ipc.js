import { app, dialog, ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import {initWs, closeWs} from './wsClient.js'
import store from './store.js'
import { addUserSetting, getLocalFileFolder, resetLocalFileFolder, updateLocalFileFolder } from './db/UserSettingModel.js';
import { selectUserSessionList,delChatSession,markSessionRead,topChatSession,saveOrUpdateChatSessionBatch4Init} from './db/ChatSessionUserModel.js';
import { clearMessageBySessionId, searchMessageBySessionId, selectMessageList, saveMessage } from './db/ChatMessageModel.js';
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
        // renderer 左侧会话列表只读本地 SQLite，WebSocket/发送链路负责提前把会话写入表。
        const result=await selectUserSessionList();
        e.sender.send("loadSessionDataCallback",result);
    })

}

const onDelChatSession=()=>{
    ipcMain.on("delChatSession",(e,contactId)=>{
        // 删除会话仅把会话置为不可见，不删除 chat_message 历史记录。
        delChatSession(contactId);

    })
}

const onTopChatSession=()=>{
    ipcMain.on("topChatSession",(e,{contactId,topType})=>{
        // 置顶状态由 renderer 乐观更新，这里负责把结果持久化。
        topChatSession(contactId,topType);

    })
}

//分页查询聊天消息
const onLoadChatMessage=()=>{
    ipcMain.on("loadChatMessage",async (e,data)=>{
        // 历史消息分页在主进程完成，sessionId/loadSeq 原样带回给 renderer 做防串线校验。
        const result=await selectMessageList(data);
        e.sender.send("loadChatMessageCallback",{
            ...result,
            sessionId: data?.sessionId,
            loadSeq: data?.loadSeq
        });
    })

}

const onMarkSessionRead=()=>{
    ipcMain.on("markSessionRead",async (e,contactId)=>{
        // 已读会同步清零本地会话未读数，renderer 收到新会话列表后红点也会随之刷新。
        await markSessionRead(contactId);
        e.sender.send("markSessionReadCallback",{
            contactId,
            success:true
        });
    })
}

const onResetToLogin=(_mainWindow, callback)=>{
    const reset = () => {
        closeWs();
        callback();
        return true;
    };

    ipcMain.handle("logout", () => {
        return reset();
    });

    ipcMain.on("reLogin", () => {
        reset();
    });
}



//保存发送的消息到本地，并更新会话
const saveSendMessageToLocal = async ({ message, chatSession } = {}) => {
    if (!message) {
        return {
            success: false,
            error: 'message is empty'
        };
    }

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

    return {
        success: true,
        messageId: message.messageId,
        session: sessionInfo
    };
};

const onSaveSendMessage = () => {
    ipcMain.handle('saveSendMessage', async (_e, payload) => {
        try {
            return await saveSendMessageToLocal(payload);
        } catch (error) {
            return {
                success: false,
                error: error?.message || String(error)
            };
        }
    });

    ipcMain.on('saveSendMessage', async (e, { message, chatSession }) => {
        if (!message) {
            return;
        }
        //保存发送的消息到chat_message 表
        // HTTP 发送成功后的消息在这里落库，避免刷新会话后本地历史缺失自己发出的消息。
        await saveMessage(message);

        // 同步更新会话表的最后一条消息，使左侧列表立即反映本次发送。
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
        try {
            // 清空记录写入 clear 游标后删除当前本地消息，后续旧 WebSocket 回补会被过滤。
            await clearMessageBySessionId(sessionId);
            e.sender.send('clearChatMessageCallback', {
                success: true,
                sessionId
            });
        } catch (error) {
            e.sender.send('clearChatMessageCallback', {
                success: false,
                sessionId,
                error: error?.message || String(error)
            });
        }
    });
};

const onSearchChatMessage = () => {
    ipcMain.on('searchChatMessage', async (e, data = {}) => {
        // 搜索只查当前 session 的本地消息，并把 searchSeq 带回 renderer 丢弃过期结果。
        const dataList = await searchMessageBySessionId(data);
        e.sender.send('searchChatMessageCallback', {
            sessionId: data.sessionId,
            keyword: data.keyword,
            searchSeq: data.searchSeq,
            dataList
        });
    });
};

const onLocalFileFolder = () => {
    ipcMain.handle('getLocalFileFolder', async () => {
        return await getLocalFileFolder();
    });

    ipcMain.handle('changeLocalFileFolder', async () => {
        const result = await dialog.showOpenDialog({
            title: '选择文件保存位置',
            properties: ['openDirectory', 'createDirectory']
        });

        if (result.canceled || !result.filePaths?.length) {
            return await getLocalFileFolder();
        }

        return await updateLocalFileFolder(result.filePaths[0]);
    });

    ipcMain.handle('resetLocalFileFolder', async () => {
        return await resetLocalFileFolder();
    });

    ipcMain.handle('openLocalFileFolder', async () => {
        const folderInfo = await getLocalFileFolder();
        const error = await shell.openPath(folderInfo.localFileFolder);
        return {
            ...folderInfo,
            success: !error,
            error
        };
    });
};

const onOpenTempVideoFile = () => {
    ipcMain.handle('openTempVideoFile', async (e, data = {}) => {
        // 没有本地原文件时，renderer 会把已下载视频 blob 交给主进程写入临时文件再打开。
        const { fileName = 'video.mp4', buffer } = data;
        if (!buffer) {
            return {
                success: false,
                error: '视频数据为空'
            };
        }

        const safeFileName = String(fileName).replace(/[\\/:*?"<>|]/g, '_');
        const tempFolder = path.join(app.getPath('temp'), 'EasyChat', 'video-preview');
        fs.mkdirSync(tempFolder, { recursive: true });
        const filePath = path.join(tempFolder, `${Date.now()}_${safeFileName}`);
        fs.writeFileSync(filePath, Buffer.from(buffer));
        const error = await shell.openPath(filePath);

        return {
            success: !error,
            error,
            filePath
        };
    });

    ipcMain.handle('readLocalVideoFile', async (e, data = {}) => {
        // 自己刚发送的视频可从本地路径读取，用于服务端文件尚未可下载时的预览回退。
        const { filePath } = data;
        if (!filePath || !fs.existsSync(filePath)) {
            return {
                success: false,
                error: '本地视频文件不存在'
            };
        }

        const buffer = fs.readFileSync(filePath);
        const arrayBuffer = buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength
        );
        return {
            success: true,
            arrayBuffer,
            fileSize: buffer.length
        };
    });

    ipcMain.handle('openLocalVideoFile', async (e, data = {}) => {
        // 系统播放器入口优先打开本地原文件，避免重复下载大视频。
        const { filePath } = data;
        if (!filePath || !fs.existsSync(filePath)) {
            return {
                success: false,
                error: '本地视频文件不存在'
            };
        }

        const error = await shell.openPath(filePath);
        return {
            success: !error,
            error
        };
    });
};
export {
    onLoginOnRegister,
    onLoginSuccess,
    onResetToLogin,
    winTitleOp,
    onSetLocalStore,
    onGetLocalStore,
    onLoadSessionData,
    onDelChatSession,
    onMarkSessionRead,
    onTopChatSession,
    onLoadChatMessage,
    onSaveSendMessage,
    onClearChatMessage,
    onSearchChatMessage,
    onLocalFileFolder,
    onOpenTempVideoFile
};
