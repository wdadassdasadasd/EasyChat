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
    }
}

// 模拟 run 函数
const run = (sql, params) => {
    console.log("执行 SQL:", sql)
    console.log("参数:", params)
    return { sql, params }
}

const insert = (sqlPrefix, tableName, data) => {
    const columnsMap = globalColumnMap[tableName]
    if (!columnsMap) {
        throw new Error(`未找到表 ${tableName} 的列映射`)
    }
    const dbColumns = []
    const params = []
    for (let item in data) {
        if (data[item] !== undefined && columnsMap[item] !== undefined) {
            dbColumns.push(columnsMap[item])
            params.push(data[item])
        }
    }
    if (dbColumns.length === 0) {
        throw new Error("没有可插入的列")
    }
    // 生成占位符：?,?,?
    const preper = dbColumns.map(() => "?").join(",")
    const sql = `${sqlPrefix} (${dbColumns.join(",")}) values (${preper})`
    console.log("生成的SQL:", sql)
    return run(sql, params)
}

// 测试
insert("insert into chat_message", "chat_message", {
    userId: "1234",
    messageId: "123456",
    messageType: "text"
})

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
update("chat_message", {
    userId: "1234",
    messageId: "123456",
}, 
{
    userId: "1234",
    messageId: "123456"
})      

