import { add_tables, add_index, alter_tables } from "./Tables"

// 全局列名映射：camelCase 业务字段 -> snake_case 数据库列名
const globalColumnMap = {
    chat_message: {
        userId: "user_id",
        messageId: "message_id",
        sessionId: "session_id",
        messageType: "message_type",
        messageContent: "message_content",
        contactType: "contact_type",
        sendUserId: "send_user_id",
        sendUserNickName: "send_user_nick_name",
        sendTime: "send_time",
        status: "status",
        fileSize: "file_size",
        fileName: "file_name",
        filePath: "file_path",
        fileType: "file_type"
    },
    chat_session_user: {
        userId: "user_id",
        contactId: "contact_id",
        contactType: "contact_type",
        sessionId: "session_id",
        status: "status",
        contactName: "contact_name",
        lastMessage: "last_message",
        lastReceiveTime: "last_receive_time",
        noReadCount: "no_read_count",
        memberCount: "member_count",
        topType: "top_type"
    },
    user_setting: {
        userId: "user_id",
        email: "email",
        sysSetting: "sys_setting",
        contactNoRead: "contact_no_read",
        serverPort: "server_port"
    }
}

const fs=require("fs")   //用于文件/目录操作
const sqlite3=require("sqlite3")  //引入 sqlite3 模块，用于操作 SQLite 数据库
const os=require("os")  //用于获取系统信息
const NODE_ENV=process.env.NODE_ENV  //获取环境变量

const userDir=os.homedir()  // 获取当前用户的主目录路径 
console.log(userDir)
const flieFolder=userDir+(NODE_ENV==="development"?"/.weChattest/":"/.weChat/")  // 根据环境变量决定数据库文件夹路径

//创建数据库文件夹
if(!fs.existsSync(flieFolder)){
    fs.mkdirSync(flieFolder)
}

const db=new sqlite3.Database(flieFolder+'local.db')  // 创建/连接SQLite数据库文件

//初始化数据库表
const createTable=()=>{
    return new Promise(async(resolve,reject)=>{

        for(const item of add_tables){
            await db.run(item)
        }
        for(const item of add_index){
            await db.run(item)
        }
        for(const item of alter_tables){
            const fieldList=await queryAll(`PRAGMA table_info(${item.table_Name})`,[])
            const field=fieldList.some(row=>row.name=item.field)
            if(!field){
                await db.run(sql)
            }
        }
        resolve()

    })

}

//查询所有数据
const queryAll=(sql,params)=>{
    return new  Promise((resolve,reject)=>{
        const stmt=db.prepare(sql)
        stmt.all(params,function (err,row){
            if(err){
                resolve([])

            }
            row.forEach((item,index)=>{
                row[index]=convertDbObj2BizObj(item)

            })
            //通知 Promise 操作成功，并将 row 作为结果返回给调用
            resolve(row)

        })
        //释放资源
        stmt.finalize()

    })
}


const queryOne=(sql,params)=>{
       return new  Promise((resolve,reject)=>{
        const stmt=db.prepare(sql)
        stmt.get(params,function (err,row){
            if(err){
                resolve([])
            }
            resolve(convertDbObj2BizObj(row))

            })
        //释放资源
        stmt.finalize()
    })
}

const queryCount=(sql,params)=>{
      return new  Promise((resolve)=>{
        //预处理sql语句防止sql注入
        const stmt=db.prepare(sql)
        stmt.get(params,function (err,row){
            if(err||!row){
                resolve(0)
                return
            }
            const firstValue=Object.values(row)[0]
            resolve(firstValue||0)

            })
        //释放资源
        stmt.finalize()
    })

}

const run=(sql,params)=>{
   return new  Promise((resolve,reject)=>{
        const stmt=db.prepare(sql)
        stmt.run(params,function (err){
            if(err){
                console.error(`执行的SQL:${sql},params:${params},执行失败:${err}`)
                resolve(操作数据库失败)
            }
            console.error(`执行的SQL:${sql},params:${params},执行记录数:${this.changes}`)
            resolve(this.changes)
            })

        //释放资源
        stmt.finalize()
    })
}

//数据库对象转业务对象
const convertDbObj2BizObj=(data)=>{
    if(!data){
        return null;
    }
    const bizData={};
    for(let item in data){
        bizData[toCamelCase(item)]=data[item]

    }
    return bizData;

}

//下划线转驼峰
const toCamelCase=(str)=>{
    return str.replace(/_([a-z])/g,function (math,p1){
        return String.fromCharCode(p1.charCodeAt(0) - 32)

    });
    
}
const obj=convertDbObj2BizObj({

})


const insert=(sqlPrefix,tableName,data)=>{
    const columnsMap=globalColumnMap[tableName]
    const dbColumns=[]
    const params=[]
    for(let item in data){
        if(data[item]!==undefined&&columnsMap[item]!==undefined){
            dbColumns.push(columnsMap[item])
            params.push(data[item])
        }
    }
    const preper=dbColumns.map(()=>"?").join(",")
    const sql=`${sqlPrefix} ${tableName} (${dbColumns.join(",")}) values (${preper})`

    return run(sql,params)
 
   
}

const insertOrReplace=(tableName,data)=>{
    return insert("insert or replace into",tableName,data)
    
}

const insertOrIgnore=(tableName,data)=>{

    return insert("insert or ignore into",tableName,data)

}


const update=(tableName,data,paramData)=>{
    const columnsMap=globalColumnMap[tableName]
    const dbColumns=[]
    const params=[]
    const whereColumns=[]
    for(let item in data){
        if(data[item]!==undefined&&columnsMap[item]!==undefined){
            dbColumns.push(`${columnsMap[item]}=?`)
            params.push(data[item])
        }
    }
    for(let item in paramData){
        if(paramData[item]){
            params.push(paramData[item])
            whereColumns.push(`${columnsMap[item]}=?`)
        }
    }
    const sql=`update ${tableName} set ${dbColumns.join(",")} where ${whereColumns.join(" and ")}`

    return run(sql,params)
 
   
}
const init=()=>{
    db.serialize(async()=>{
        await createTable(); 

    })
}
init();
export {
    createTable,
    insertOrReplace,
    insertOrIgnore,
    queryAll,
    queryOne,
    queryCount,
    run,
    insert,
    update
}
