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
const os=require("os");
const userDir=os.homedir();
const updateNoReadCount=(contactId,noReadCount)=>{
     return new Promise(async (resolve,reject)=>{
        let sql=null;
        if(noReadCount===0){
            resolve();
            return;
        }
        if(noReadCount){
            sql="update user_setting set contact_no_read=contact_no_read+? where user_id=?";
        }

        //清空未读数
        else{
            noReadCount=0;
            sql="update user_setting set contact_no_read=? where user_id=?"
        }
        await run(sql,[noReadCount,contactId]);
        resolve();
    })
}

const addUserSetting=async (userId,email)=>{
    let sql="select max(server_port) maxserver_port from user_setting";
    let {serverPort}= await queryOne(sql,[]);
    if(serverPort==null){
        serverPort=10240;
    }else{
        serverPort++;
    }
    const sysSetting={
        localFileFolder:userDir+ "\\.weChat\\fileStorge\\"

    };
    sql="select * from user_setting where user_id=?";
    const userInfo=await queryOne(sql,[userId]);
    let resultServerPort=null;
    let  localFileFolder=null;

    if(userInfo){
        await update("sys_setting",{email:email},{userId:userId})
        resultServerPort=userInfo.serverPort;
        localFileFolder=JSON.parse(userInfo.sysSetting).localFileFolder;
    }else{
        await insertOrIgnore("sys_setting",{
            userId:userId,
            email:email,
            sysSetting:JSON.stringify(sysSetting),
            contactNoRead:0,
            serverPort:serverPort

        })
        resultServerPort=serverPort;

    }
    //Todo 启动本地服务
    store.setUserData("localSeverPort",resultServerPort);
    store.setUserData("localFileFolder",localFileFolder);

}
export {
    updateNoReadCount,
    addUserSetting
}