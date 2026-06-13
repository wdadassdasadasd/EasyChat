# EasyChat 后端接口文档

> 基于 `easychat-java` (Spring Boot 2.6.1 + Netty 4.1.50 + MyBatis + Redis) 源码生成  
> 生成日期: 2026-06-10

---

## 基础信息

| 项目 | 值 |
|------|-----|
| 协议 | HTTP/1.1 |
| 地址 | `http://localhost:5050` |
| 前缀 | `/api` |
| 数据格式 | `application/x-www-form-urlencoded` (文件上传: `multipart/form-data`) |
| 认证方式 | HTTP Header `Authorization: Bearer <token>` |
| WebSocket | `ws://localhost:5051/ws?token=<token>` |

## 通用响应格式

```json
{
  "status": "success" | "error",
  "code": 200,
  "info": "描述信息",
  "data": { ... }
}
```

### 状态码

| 状态码 | 含义 |
|--------|------|
| 200 | 成功 |
| 404 | 地址不存在 |
| 500 | 服务器错误 |
| 600 | 请求参数错误 |
| 601 | 信息已存在 |
| 602 | 文件不存在 |
| 901 | 登录超时 / 未授权 |
| 902 | 不是好友 |
| 903 | 不在群组中 |

---

## 一、账户模块 `/account`

### `GET/POST` /account/checkCode
获取图片验证码（算术题）。

**认证**: 无

**参数**: 无

**响应**: `ResponseVO<Map<String,String>>`
```json
{
  "code": 200,
  "data": {
    "checkCode": "data:image/png;base64,...",
    "checkCodeKey": "uuid-string"
  }
}
```
`checkCodeKey` 需在登录/注册时回传以验证验证码答案。

---

### `POST` /account/register
注册新用户。

**认证**: 无

**参数** (全部必填):

| 参数 | 类型 | 校验 | 说明 |
|------|------|------|------|
| email | String | @Email | 邮箱 |
| password | String | 见下方规则 | 密码 |
| nickName | String | @NotEmpty | 昵称 |
| checkCode | String | @NotEmpty | 验证码答案 |
| checkCodeKey | String | @NotEmpty | 从 checkCode 接口获取的 key |

**密码规则**: 8-18 位，至少包含一个数字和一个字母，允许特殊字符 `~!@#$%^&*_`

**响应**: `ResponseVO<null>`

---

### `POST` /account/login
登录。

**认证**: 无

**参数** (全部必填):

| 参数 | 类型 | 说明 |
|------|------|------|
| email | String | 邮箱 |
| password | String | 密码 |
| checkCode | String | 验证码答案 |
| checkCodeKey | String | 验证码 key |

**响应**: `ResponseVO<UserInfoVO>`
```json
{
  "code": 200,
  "data": {
    "userId": "U53792695301",
    "nickName": "用户昵称",
    "sex": 1,
    "joinType": 0,
    "personalSignature": "签名",
    "areaCode": "110000",
    "areaName": "北京",
    "token": "uuid-token-string",
    "admin": false,
    "contactStatus": null
  }
}
```
`token` 有效期 2 天，存储在 Redis (`easychat:ws:token:<token>`)。

---

### `GET/POST` /account/getSysSetting
获取系统公开设置。

**认证**: 需要登录

**参数**: 无

**响应**: `ResponseVO<SysSettingVO>`
```json
{
  "code": 200,
  "data": {
    "maxImageSize": 20971520,
    "maxVideoSize": 2147483648,
    "maxFileSize": 2147483648
  }
}
```
单位：字节。

---

## 二、用户模块 `/userInfo`

### `GET/POST` /userInfo/getUserInfo
获取当前用户信息。

**认证**: 需要登录

**参数**: 无（从请求 Header `Authorization: Bearer <token>` 中解析）

**响应**: `ResponseVO<UserInfoVO>` —— 字段同登录返回

---

### `POST` /userInfo/saveUserInfo
更新用户资料（含头像）。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| nickName | String | 否 | 昵称 |
| sex | Integer | 否 | 性别 (0=未知, 1=男, 2=女) |
| personalSignature | String | 否 | 个性签名 |
| areaCode | String | 否 | 地区编码 |
| areaName | String | 否 | 地区名称 |
| avatarFile | File | 否 | 头像文件 (multipart) |
| avatarCover | File | 否 | 头像封面 (multipart) |

**响应**: `ResponseVO<UserInfoVO>` —— 返回更新后的用户信息

---

### `POST` /userInfo/updatePassword
修改密码。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| password | String | 是 | 新密码 (8-18位，至少1数字+1字母) |

**响应**: `ResponseVO<null>`

⚠️ 修改密码后会强制断开 WebSocket 连接。

---

### `POST` /userInfo/logout
退出登录。

**认证**: 需要登录

**参数**: 无

**响应**: `ResponseVO<null>`

退出后清除 Redis 中的 token，断开 WebSocket。

---

## 三、联系人模块 `/contact`

### `POST` /contact/search
搜索用户或群组。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| contactId | String | 是 | 用户 ID 或群组 ID |

**响应**: `ResponseVO<UserContactSearchResultDto>`
```json
{
  "code": 200,
  "data": {
    "contactId": "U123456",
    "contactType": 0,
    "nickName": "用户昵称",
    "status": 1,
    "statusName": "在线",
    "sex": 1,
    "areaName": "北京",
    "avatarLastUpdate": null
  }
}
```
- `contactType`: 0=用户, 1=群组
- `status`: 0=离线, 1=在线

---

### `POST` /contact/applyAdd
发送好友/群组申请。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| contactId | String | 是 | 目标用户/群组 ID |
| contactType | String | 是 | "USER" 或 "GROUP" |
| applyInfo | String | 否 | 申请附言 |

**响应**: `ResponseVO<Integer>`
- `data`: 0=直接添加成功, 1=已发送申请, 2=已是好友

---

### `POST` /contact/loadApply
加载待处理的好友/群组申请列表。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| pageNo | Integer | 否 | 页码，默认第 1 页（每页 15 条） |

**响应**: `ResponseVO<PaginationResultVO<UserContactApply>>`
```json
{
  "code": 200,
  "data": {
    "totalCount": 100,
    "pageSize": 15,
    "pageNo": 1,
    "pageTotal": 7,
    "list": [ ... ]
  }
}
```

---

### `POST` /contact/dealWithApply
处理好友/群组申请（接受或拒绝）。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| applyId | Integer | 是 | 申请 ID |
| status | Integer | 是 | 1=拒绝, 2=接受, 3=已处理 |

**响应**: `ResponseVO<null>`

---

### `POST` /contact/loadContact
加载联系人列表。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| contactType | String | 是 | "USER" (好友) 或 "GROUP" (群组) |

**响应**: `ResponseVO<List<UserContact>>`

---

### `POST` /contact/getContactInfo
获取用户公开信息（无需是好友）。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| contactId | String | 是 | 用户 ID |

**响应**: `ResponseVO<UserInfoVO>` —— 含 `contactStatus` 字段（好友关系状态）

---

### `POST` /contact/getContactUserInfo
获取好友详情信息。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| contactId | String | 是 | 好友用户 ID |

**响应**: `ResponseVO<UserInfoVO>`

---

### `POST` /contact/delContact
删除联系人。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| contactId | String | 是 | 要删除的联系人 ID |

**响应**: `ResponseVO<null>`

---

### `POST` /contact/addContact2BlackList
拉黑联系人。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| contactId | String | 是 | 要拉黑的联系人 ID |

**响应**: `ResponseVO<null>`

---

## 四、群组模块 `/group`

### `POST` /group/saveGroup
创建或修改群组。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| groupId | String | 否 | 群组 ID（修改时传入） |
| groupName | String | 是 | 群组名称 |
| groupNotice | String | 否 | 群公告 |
| joinType | Integer | 是 | 加群方式 (0=直接加入, 1=需验证) |
| avatarFile | File | 否 | 群头像 (multipart) |
| avatarCover | File | 否 | 群头像封面 (multipart) |

**响应**: `ResponseVO<null>`

---

### `POST` /group/loadMyGroup
加载我拥有的群组列表。

**认证**: 需要登录

**参数**: 无

**响应**: `ResponseVO<List<GroupInfo>>`

---

### `POST` /group/getGroupInfo
获取群组信息（需是成员）。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| groupId | String | 是 | 群组 ID |

**响应**: `ResponseVO<GroupInfo>`
```json
{
  "code": 200,
  "data": {
    "groupId": "G...",
    "groupName": "群名称",
    "groupOwnerId": "U...",
    "groupNotice": "群公告",
    "joinType": 0,
    "memberCount": 42,
    "createTime": 1700000000000
  }
}
```

---

### `POST` /group/getGroupInfo4Chat
获取群组信息及全部成员（用于聊天面板）。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| groupId | String | 是 | 群组 ID |

**响应**: `ResponseVO<GroupInfoVO>`
```json
{
  "code": 200,
  "data": {
    "groupInfo": { ... },
    "userContactList": [ ... ]
  }
}
```

---

### `POST` /group/leaveGroup
退出群组。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| groupId | String | 是 | 群组 ID |

**响应**: `ResponseVO<null>`

---

### `POST` /group/dissolutionGroup
解散群组（仅群主）。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| groupId | String | 是 | 群组 ID |

**响应**: `ResponseVO<null>`

---

### `POST` /group/addOrRemoveGroupUser
添加或移除群成员。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| groupId | String | 是 | 群组 ID |
| selectContacts | String | 是 | 用户 ID 列表 (逗号分隔) |
| opType | Integer | 是 | 0=移除, 1=添加 |

**响应**: `ResponseVO<null>`

---

## 五、聊天模块 `/chat`

### `POST` /chat/sendMessage
发送消息。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| contactId | String | 是 | 接收方 ID |
| messageContent | String | 是 | 消息内容 (最长 500 字符) |
| messageType | Integer | 是 | 1=文本, 5=文件/媒体 |
| fileSize | Long | 否 | 文件大小 (字节) |
| fileName | String | 否 | 文件名 |
| fileType | Integer | 否 | 0=图片, 1=视频, 2=文件 |

**响应**: `ResponseVO<MessageSendDto>`
```json
{
  "code": 200,
  "data": {
    "messageId": 123456789,
    "sessionId": "s1",
    "sendUserId": "U...",
    "sendUserNickName": "发送者",
    "contactId": "U...",
    "contactName": "接收者",
    "messageContent": "消息内容",
    "lastMessage": "消息内容",
    "messageType": 2,
    "sendTime": 1700000000000,
    "contactType": 0,
    "status": 1,
    "fileSize": null,
    "fileName": null,
    "fileType": null,
    "memberCount": null
  }
}
```

---

### `POST` /chat/uploadFile
上传完整文件（< 8MB 小文件单次上传）。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| messageId | Long | 是 | 关联的消息 ID |
| file | File | 是 | 文件 (multipart) |
| cover | File | 是 | 封面图 (multipart) |

**响应**: `ResponseVO<null>`

---

### `POST` /chat/uploadFile/init
初始化分片上传（≥ 8MB 大文件）。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| messageId | Long | 是 | 关联的消息 ID |
| fileName | String | 是 | 文件名 |
| fileSize | Long | 是 | 文件总大小 (字节) |
| totalChunks | Integer | 是 | 总分片数 |
| fileType | Integer | 否 | 文件类型 |
| chunkSize | Integer | 否 | 分片大小 (默认 4MB) |

**响应**: 返回 `uploadId` (后续分片上传使用)

---

### `POST` /chat/uploadFile/chunk
上传单个分片。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| uploadId | String | 是 | 上传会话 ID (由 init 返回) |
| messageId | Long | 是 | 关联的消息 ID |
| chunkIndex | Integer | 是 | 分片序号 (从 0 开始) |
| totalChunks | Integer | 是 | 总分片数 |
| chunk | File | 是 | 分片数据 (multipart) |

**响应**: `ResponseVO<null>`

备注：已上传的分片会被跳过（断点续传）。

---

### `POST` /chat/uploadFile/complete
完成分片上传，合并文件。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| uploadId | String | 是 | 上传会话 ID |
| messageId | Long | 是 | 关联的消息 ID |
| fileName | String | 是 | 文件名 |
| fileSize | Long | 是 | 文件总大小 |
| totalChunks | Integer | 是 | 总分片数 |
| fileType | Integer | 否 | 文件类型 |
| cover | File | 否 | 封面图 (multipart) |

**响应**: `ResponseVO<null>`

---

### `POST` /chat/uploadFile/cancel
取消上传。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| messageId | Long | 是 | 关联的消息 ID |
| uploadId | String | 否 | 上传会话 ID |

**响应**: `ResponseVO<null>`

---

### `POST` /chat/createDownloadToken
生成文件下载 token。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| fileId | String | 是 | 文件 ID (通常为 messageId) |
| showCover | Boolean | 是 | 是否返回封面图 |
| download | Boolean | 否 | 是否为下载模式 |

**响应**: `ResponseVO<Map>`
```json
{
  "code": 200,
  "data": {
    "downloadToken": "token-string",
    "streamUrl": "/api/chat/streamFile?fileId=...&downloadToken=..."
  }
}
```
`downloadToken` 有效期 5 分钟。

---

### `GET` /chat/streamFile
流式下载文件。

**认证**: 无（通过 `downloadToken` 验证）

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| fileId | String | 是 | 文件 ID |
| showCover | Boolean | 是 | 是否返回封面 |
| downloadToken | String | 是 | 下载 token |
| download | Boolean | 否 | 是否为下载（触发浏览器另存为） |

**响应**: 二进制文件流，支持 HTTP Range 请求（断点续传）。

---

### `GET/POST` /chat/downloadFile
下载文件（头像/聊天附件通用）。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| fileId | String | 是 | 文件 ID |
| showCover | Boolean | 是 | 是否返回封面 |

**响应**: 二进制文件流。

---

## 六、更新模块 `/update`

### `POST` /update/checkVersion
检查客户端更新。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| appVersion | String | 否 | 当前客户端版本号 |
| uid | String | 否 | 用户 ID |

**响应**: `ResponseVO<AppUpdateVO>`
```json
{
  "code": 200,
  "data": {
    "id": 1,
    "version": "1.1.0",
    "updateList": ["修复了...", "新增了..."],
    "size": 52428800,
    "fileName": "EasyChat-Setup-1.1.0.exe",
    "fileType": 0,
    "outerLink": null
  }
}
```
- 无可用更新时 `data` 可能为特殊值，前端需判空
- `fileType`: 0=本地文件下载, 1=外部链接

---

### `GET` /update/download
下载客户端更新包。

**认证**: 需要登录

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | Integer | 是 | 更新记录 ID |

**响应**: 二进制文件流。

---

## 七、管理模块 `/admin`

> 以下所有接口需要 **管理员权限** (`admin=true`)。

### 👤 用户管理

#### `POST` /admin/loadUser
分页加载用户列表。

**认证**: 管理员

**参数** (继承 `UserInfoQuery`):

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| pageNo | Integer | 否 | 页码 (默认 1) |
| pageSize | Integer | 否 | 每页条数 |
| userId | String | 否 | 按用户 ID 筛选 |
| nickName | String | 否 | 按昵称模糊搜索 |
| status | Integer | 否 | 按状态筛选 |

**响应**: `ResponseVO<PaginationResultVO<UserInfo>>`

---

#### `POST` /admin/updateUserStatus
启用/禁用用户。

**认证**: 管理员

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| userId | String | 是 | 用户 ID |
| status | Integer | 是 | 0=禁用, 1=启用 |

**响应**: `ResponseVO<null>`

---

#### `POST` /admin/forceOffLine
强制用户下线。

**认证**: 管理员

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| userId | String | 是 | 用户 ID |

**响应**: `ResponseVO<null>`

作用：清除 Redis 中该用户的 token，断开 WebSocket 连接。

---

### 👥 群组管理

#### `POST` /admin/loadGroup
分页加载群组列表（含群主昵称和成员数）。

**认证**: 管理员

**参数** (继承 `GroupInfoQuery`):

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| pageNo | Integer | 否 | 页码 |
| pageSize | Integer | 否 | 每页条数 |
| groupName | String | 否 | 按群名称模糊搜索 |

**响应**: `ResponseVO<PaginationResultVO<GroupInfo>>`

---

#### `POST` /admin/dissolutionGroup
管理员强制解散群组。

**认证**: 管理员

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| groupId | String | 是 | 群组 ID |

**响应**: `ResponseVO<null>`

---

### ⚙️ 系统设置

#### `POST` /admin/getSysSetting
获取系统设置（管理员版，含机器人配置）。

**认证**: 管理员

**参数**: 无

**响应**: `ResponseVO<SysSettingDto>`
```json
{
  "code": 200,
  "data": {
    "maxGroupCount": 100,
    "maxGroupMemberCount": 200,
    "maxImageSize": 20971520,
    "maxVideoSize": 2147483648,
    "maxFileSize": 2147483648,
    "robotUid": "U...",
    "robotNickName": "小助手",
    "robotWelcome": "欢迎使用 EasyChat"
  }
}
```

---

#### `POST` /admin/saveSysSetting
保存系统设置。

**认证**: 管理员

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| maxGroupCount | Integer | 否 | 最大群组数 |
| maxGroupMemberCount | Integer | 否 | 每个群最大成员数 |
| maxImageSize | Long | 否 | 图片大小限制 (字节) |
| maxVideoSize | Long | 否 | 视频大小限制 (字节) |
| maxFileSize | Long | 否 | 文件大小限制 (字节) |
| robotUid | String | 否 | 机器人用户 ID |
| robotNickName | String | 否 | 机器人昵称 |
| robotWelcome | String | 否 | 机器人欢迎语 |
| robotFile | File | 否 | 机器人头像 (multipart) |
| robotCover | File | 否 | 机器人封面 (multipart) |

**响应**: `ResponseVO<null>`

---

### 🤖 靓号管理

#### `POST` /admin/loadBeautyAccountList
分页加载靓号列表。

**认证**: 管理员

**参数** (继承 `UserInfoBeautyQuery`):

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| pageNo | Integer | 否 | 页码 |
| pageSize | Integer | 否 | 每页条数 |

**响应**: `ResponseVO<PaginationResultVO<UserInfoBeauty>>`

---

#### `POST` /admin/saveBeautAccount
创建/修改靓号。

**认证**: 管理员

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | Integer | 否 | 靓号 ID (修改时传入) |
| userId | String | 否 | 绑定的用户 ID |
| email | String | 否 | 预注册邮箱 |
| status | Integer | 否 | 状态 |

**响应**: `ResponseVO<null>`

---

#### `POST` /admin/delBeautAccount
删除靓号。

**认证**: 管理员

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | Integer | 是 | 靓号 ID |

**响应**: `ResponseVO<null>`

---

### 📦 更新包管理

#### `POST` /admin/loadUpdateList
分页加载客户端更新包列表（按 ID 降序）。

**认证**: 管理员

**参数** (继承 `AppUpdateQuery`):

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| pageNo | Integer | 否 | 页码 |
| pageSize | Integer | 否 | 每页条数 |

**响应**: `ResponseVO<PaginationResultVO<AppUpdate>>`

---

#### `POST` /admin/saveUpdate
创建/修改更新包。

**认证**: 管理员

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | Integer | 否 | 记录 ID (修改时传入) |
| version | String | 是 | 版本号 |
| updateDesc | String | 是 | 更新说明 (每行一条，前端可用 \n 分隔) |
| fileType | Integer | 是 | 0=本地文件, 1=外链 |
| outerLink | String | 否 | 外部下载链接 (fileType=1 时) |
| file | File | 否 | 安装包文件 (fileType=0 时, multipart) |

**响应**: `ResponseVO<null>`

---

#### `POST` /admin/delUpdate
删除更新包。

**认证**: 管理员

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | Integer | 是 | 更新记录 ID |

**响应**: `ResponseVO<null>`

---

#### `POST` /admin/postUpdate
发布/下架更新包。

**认证**: 管理员

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | Integer | 是 | 更新记录 ID |
| status | Integer | 是 | 0=下架, 1=发布 |
| grayscaleUid | String | 否 | 灰度发布用户 ID (逗号分隔) |

**响应**: `ResponseVO<null>`

---

## 八、WebSocket

### 连接

```
ws://host:5051/ws?token=<login_token>
```

- 端口: **5051** (独立于 HTTP 的 Netty 服务器)
- 心跳: 60 秒读空闲超时断开; 服务端定时发送 `heart` ping
- Token 在握手时从 URL query 中提取，通过 Redis 验证

### 消息格式 (JSON)

**服务端 → 客户端**: `MessageSendDto`
```json
{
  "messageId": 123456789,
  "sessionId": "s1",
  "sendUserId": "U...",
  "sendUserNickName": "发送者",
  "contactId": "U...",
  "contactName": "接收者",
  "messageContent": "消息内容",
  "lastMessage": "最后一条消息",
  "messageType": 2,
  "sendTime": 1700000000000,
  "contactType": 0,
  "status": 1,
  "fileSize": null,
  "fileName": null,
  "fileType": null,
  "memberCount": null
}
```

**messageType 含义**:

| messageType | 含义 | 前端处理 |
|-------------|------|----------|
| 0 (INIT) | 初始化消息 | `extendData` 包含 `WsInitData` (会话列表 + 最近消息 + 待处理申请数) |
| 1 | 文本消息 | 正常追加 |
| 2 | 聊天消息 | 正常追加 |
| 5 | 文件/媒体消息 | 显示文件/图片/视频 |
| 6 | 状态更新 | 消息状态变更通知 |

**contactType**: 0=单聊, 1=群聊

### Redis 消息广播

使用 Redisson `RTopic` 在 `"message.topic"` 频道广播，实现集群内多节点消息同步。

---

## 九、认证机制

```
┌─────────────┐     POST /login      ┌─────────────┐
│  前端       │ ────────────────────→ │  后端       │
│  Request.js │                       │  Account    │
│  Header:    │ ←── Bearer token ───── │  Controller │
│Authorization│                       └──────┬──────┘
└─────────────┘                              │
                                    ┌────────▼──────┐
                                    │  Redis        │
                                    │  key:         │
                                    │  easychat:ws: │
                                    │  token:<token>│
                                    │  TTL: 2 days  │
                                    └───────────────┘
```

1. 登录成功 → 生成 UUID token → 存入 Redis (TTL 2 天) → 返回给客户端
2. 每次 HTTP 请求 → 从 Header `Authorization: Bearer <token>` 读取 → 查 Redis 获取用户信息 → 放入请求上下文
3. WebSocket 连接 → 从 URL `?token=xxx` 读取 → 查 Redis 验证 → 建立连接
4. 退出/强制下线 → 清除 Redis 中 token → 断开 WebSocket

---

## 十、前端路径对照表

| 前端 Api.js 变量 | 路径 | 后端 Controller | 状态 |
|---|---|---|---|
| checkCode | /account/checkCode | AccountController | ✅ |
| Login | /account/login | AccountController | ✅ |
| Register | /account/register | AccountController | ✅ |
| getSysSetting | /account/getSysSetting | AccountController | ✅ |
| loadMyGroup | /group/loadMyGroup | GroupController | ✅ |
| saveGroup | /group/saveGroup | GroupController | ✅ |
| getGroupInfo | /group/getGroupInfo | GroupController | ✅ |
| getGroupInfo4Chat | /group/getGroupInfo4Chat | GroupController | ✅ |
| dissolutionGroup | /group/dissolutionGroup | GroupController | ✅ |
| leaveGroup | /group/leaveGroup | GroupController | ✅ |
| addOrRemoveGroupUser | /group/addOrRemoveGroupUser | GroupController | ✅ |
| search | /contact/search | UserContactController | ✅ |
| applyAdd | /contact/applyAdd | UserContactController | ✅ |
| loadApply | /contact/loadApply | UserContactController | ✅ |
| dealWithApply | /contact/dealWithApply | UserContactController | ✅ |
| loadContact | /contact/loadContact | UserContactController | ✅ |
| getContactUserInfo | /contact/getContactUserInfo | UserContactController | ✅ |
| addContact2BlackList | /contact/addContact2BlackList | UserContactController | ✅ |
| delContact | /contact/delContact | UserContactController | ✅ |
| getContactInfo | /contact/getContactInfo | UserContactController | ✅ |
| saveUserInfo | /userInfo/saveUserInfo | UserInfoController | ✅ |
| getUserInfo | /userInfo/getUserInfo | UserInfoController | ✅ |
| updatePassword | /userInfo/updatePassword | UserInfoController | ✅ |
| logout | /userInfo/logout | UserInfoController | ✅ |
| sendMessage | /chat/sendMessage | ChatController | ✅ |
| uploadFile | /chat/uploadFile | ChatController | ✅ |
| uploadFileInit | /chat/uploadFile/init | ChatController | ✅ |
| uploadFileChunk | /chat/uploadFile/chunk | ChatController | ✅ |
| uploadFileComplete | /chat/uploadFile/complete | ChatController | ✅ |
| uploadFileCancel | /chat/uploadFile/cancel | ChatController | ✅ |
| downloadFile | /chat/downloadFile | ChatController | ✅ |
| createDownloadToken | /chat/createDownloadToken | ChatController | ✅ |
| streamFile | /chat/streamFile | ChatController | ✅ |
| checkVersion | /update/checkVersion | UpdateController | ✅ |
| loadAdminContact | /admin/loadUser | AdminUserInfoController | ✅ |
| updateUserStatus | /admin/updateUserStatus | AdminUserInfoController | ✅ |
| forceOffline | /admin/forceOffLine | AdminUserInfoController | ✅ |
| loadGroup | /admin/loadGroup | AdminGroupController | ✅ |
| adminDissolutionGroup | /admin/dissolutionGroup | AdminGroupController | ✅ |
| saveSysSetting | /admin/saveSysSetting | AdminSettingController | ✅ |
| getSysSeting4Admin | /admin/getSysSetting | AdminSettingController | ✅ |
| saveBeautAccount | /admin/saveBeautAccount | AdminUserInfoBeautyController | ✅ |
| delBeautAccount | /admin/delBeautAccount | AdminUserInfoBeautyController | ✅ |
| *(缺失)* | /admin/loadBeautyAccountList | AdminUserInfoBeautyController | ⚠️ 前端未定义 |
| *(缺失)* | /admin/loadUpdateList | AdminAppUpdateController | ⚠️ 前端未定义 |
| *(缺失)* | /admin/saveUpdate | AdminAppUpdateController | ⚠️ 前端未定义 |
| *(缺失)* | /admin/delUpdate | AdminAppUpdateController | ⚠️ 前端未定义 |
| *(缺失)* | /admin/postUpdate | AdminAppUpdateController | ⚠️ 前端未定义 |
| *(缺失)* | /update/download | UpdateController | ⚠️ 前端未定义 |
