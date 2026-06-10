# EasyChat 桌面即时通讯项目 - 简历展示稿

> 适用场景：前端实习 / Electron 客户端 / Vue 工程化 / 即时通讯方向  
> 项目定位：一个基于 Electron + Vue 3 的桌面端 IM 客户端，覆盖登录、会话列表、单聊/群聊、文本/图片/视频/文件消息、联系人、设置、本地历史、WebSocket 实时收发与离线缓存。

## 简历项目写法

### 精简版

**EasyChat 桌面即时通讯客户端** | Electron、Vue 3、Element Plus、Pinia、SQLite、WebSocket

- 独立实现 Electron + Vue 3 桌面聊天客户端，完成登录、会话列表、单聊/群聊、联系人、个人设置、文本/图片/视频/文件消息收发等核心 IM 功能。
- 设计主进程统一管理 SQLite 的数据链路，通过 IPC 隔离渲染层和本地数据库，支持消息分页、消息搜索、会话清空游标、未读数维护与本地历史缓存。
- 优化实时消息接收流程：WebSocket 心跳保活、断线重连、消息合法性校验、接收队列、批量落库和批量推送，降低高频消息下的 UI 刷新与数据库写入压力。
- 针对长聊天记录实现虚拟列表，基于消息高度缓存、前缀和与二分查找计算可视区，仅渲染视口附近消息，提升历史消息滚动性能。
- 完善消息发送状态机：本地 pending 消息、服务端 messageId 替换、失败重试、媒体文件异步上传、上传并发控制和 ACK 状态回填，提升弱网场景下的交互一致性。
- 使用 Vitest 覆盖 WebSocket 消息归一化、消息模型落库、发送链路和虚拟列表等关键逻辑，降低聊天链路改动的回归风险。

### 强调前端性能版

**EasyChat 桌面即时通讯客户端** | Electron、Vue 3、Pinia、SQLite、WebSocket

- 负责聊天窗口核心体验建设，拆分会话状态、消息列表、发送链路、滚动控制、虚拟列表等 composable，降低单文件复杂度并提升功能可维护性。
- 实现长消息列表虚拟滚动：以 `messageId` 作为高度缓存键，使用累计高度数组和二分查找定位可视范围，配合 overscan、顶部/底部 spacer 和图片加载后重测，减少大批量消息渲染开销。
- 处理历史消息 prepend 后的阅读位置恢复，通过记录虚拟总高度与 scrollTop 的差值修正滚动位置，避免用户向上翻页时视口跳动。
- 增加会话切换 `loadSeq` 防竞态机制，丢弃过期分页回包，避免快速切换聊天对象时旧会话消息写入当前窗口。
- 支持文本、图片、视频、文件的统一发送链路，使用本地临时消息提供即时反馈，并在服务端回包后替换为真实消息，兼顾响应速度和数据一致性。

### 强调客户端工程版

**EasyChat 桌面即时通讯客户端** | Electron、Vue 3、SQLite、WebSocket、Vitest

- 搭建 Electron 主进程、preload、Vue 渲染层三层结构，主进程负责窗口、托盘、IPC、WebSocket 和 SQLite，渲染层专注 UI 状态与交互。
- 封装 SQLite 数据访问层，支持 WAL、busy timeout、串行写队列、事务封装、字段驼峰转换和 SQL 参数分批，提升本地消息存储的稳定性。
- 实现消息批量保存时的去重、清空游标过滤、会话摘要更新、未读数累加和置顶状态保留，保证消息表与会话表在同一事务内保持一致。
- 设计 WebSocket 接收缓冲区，支持嵌套批量消息归一化、非法消息过滤、批量 flush、失败重试和队列溢出保护，增强高并发消息下的容错能力。
- 编写 Vitest 单测验证 WebSocket 消息解析、消息模型状态保留和虚拟列表底部定位等关键行为。

## 面试讲述稿

这个项目不是单纯做聊天页面，而是把桌面 IM 客户端里几个容易出问题的链路补完整：实时消息接收、本地持久化、长列表性能、发送状态一致性和会话切换竞态。

架构上我把 Electron 主进程作为本地数据和系统能力的边界，SQLite、WebSocket、窗口控制都放在主进程，渲染进程通过 IPC 获取消息和会话数据。这样做的好处是 UI 不直接操作数据库，聊天窗口只需要处理状态展示和用户交互，本地数据一致性由主进程集中保证。

消息接收上，WebSocket 不直接一条消息触发一次数据库写入和 UI 更新，而是先进入接收队列，按数量或短延迟批量 flush。批量落库时会做 messageId 去重、清空游标过滤、会话摘要更新和未读数累加，然后再批量推送给渲染层。这样可以减少高频消息下的写入次数和渲染压力。

长聊天记录上，我没有直接渲染完整消息列表，而是做了虚拟列表。每条消息的实际高度按 messageId 缓存，累计高度用于计算顶部和底部 spacer，滚动时通过二分查找定位可视范围。因为聊天消息高度不固定，所以图片/视频加载完成后会重新测量高度，向上加载历史消息时也会恢复原来的阅读位置。

发送链路上，我使用本地临时 messageId 先展示 pending 消息，再通过 HTTP 拿到服务端 messageId 后替换本地消息。媒体消息会先创建消息，再异步上传文件，上传任务限制最大并发，失败后保留重试能力。这个链路能让用户立即看到发送反馈，同时保证最终落库的是服务端确认过的消息。

## 可被追问的技术亮点

### 1. WebSocket 高可靠接收链路

**代码位置**

- `src/main/wsClient.js`
- `src/main/constants.js`
- `test/main/wsClient.spec.js`

**可以这样说**

- 心跳间隔：`HEARTBEAT_INTERVAL = 10000`
- 断线重连：最多 `5` 次，每次延迟 `5000ms`
- 接收队列：短延迟 `50ms` 或达到 `100` 条触发批量写入
- 容错处理：消息归一化、合法性校验、失败重试、溢出保护、运行代际校验

**面试展开**

我把 WebSocket 收到的数据先归一化成消息数组，支持服务端返回单条、数组或嵌套 batch。每条消息进入队列前会校验 `messageType`、`messageId`、`sessionId` 等关键字段。落库时如果失败，会给消息加重试次数，超过阈值后丢弃并通知渲染层，避免队列卡死。

### 2. SQLite 本地消息一致性

**代码位置**

- `src/main/db/ADB.js`
- `src/main/db/ChatMessageModel.js`
- `src/main/db/ChatSessionUserModel.js`
- `test/main/db/ChatMessageModel.spec.js`

**可以这样说**

- SQLite 开启 WAL 和 `busy_timeout`
- 所有写入进入串行写队列
- 事务使用 `BEGIN IMMEDIATE` 保证批量消息与会话摘要一起提交
- 批量消息保存时做已有 messageId 查询和本批次内去重
- 会话清空不是简单删除，而是写入 clear cursor，查询时过滤历史消息

**面试展开**

聊天数据一致性的核心问题是消息表和会话表不能互相打架。比如收到一批消息时，如果先写会话摘要再写消息，中间失败就可能出现会话最后一条消息指向不存在的记录。所以我把批量消息写入、会话摘要更新和未读数累加放进同一个事务里，并且在事务内做去重，避免并发批量保存时重复插入。

### 3. 长列表虚拟滚动

**代码位置**

- `src/renderer/src/views/chat/composables/useVirtualMessageList.js`
- `src/renderer/src/components/chat/ChatMessageList.vue`
- `test/renderer/views/chat/composables/useVirtualMessageList.spec.js`

**可以这样说**

- 只渲染视口附近消息，其他区域用 spacer 撑开滚动高度
- 消息高度以 `messageId` 缓存，prepend 历史消息后缓存仍然有效
- 使用累计高度数组和二分查找计算可视区
- 图片/视频加载完成后重新测量高度
- 历史消息 prepend 后按高度差恢复用户阅读位置

**面试展开**

普通列表在几千条消息时 DOM 数量会迅速膨胀，聊天气泡又有图片、文件、时间分割线，行高不固定。我这里用测量后的高度缓存构建累计高度数组，滚动时二分定位 start/end，再只渲染可视范围加 overscan。因为 key 是 messageId，而不是数组索引，所以向上插入历史消息时已有消息的测量高度不会失效。

### 4. 消息发送状态机

**代码位置**

- `src/renderer/src/views/chat/composables/useChatMessageSender.js`
- `src/renderer/src/views/chat/composables/useChatMessages.js`

**可以这样说**

- 文本和媒体消息统一走 pending -> server confirmed -> persisted/failed 状态
- 本地临时负数 messageId 保证发送后立即展示
- 服务端返回后用真实 messageId 替换本地临时消息
- 失败消息支持重试
- 媒体上传最大并发数为 `3`
- 文件 ACK 可异步回填消息状态

**面试展开**

发送消息最容易出问题的是 UI 已展示但本地没存、服务端成功但本地替换失败、媒体消息创建成功但文件上传失败。我把它拆成几个明确阶段：先生成 pending 消息并落库，再请求服务端创建消息，再替换本地 id。媒体消息创建成功后再上传文件，并限制上传并发，上传失败时只把该消息标记失败，用户可以重试。

### 5. 会话切换与异步竞态处理

**代码位置**

- `src/renderer/src/views/chat/composables/useChatMessages.js`
- `src/renderer/src/views/chat/composables/useMessageScroll.js`

**可以这样说**

- 每次消息加载绑定当前 active `loadSeq`
- IPC 回调同时校验 `sessionId` 和 `loadSeq`
- 快速切换会话时丢弃旧请求回包
- 首屏加载和历史翻页使用不同滚动策略

**面试展开**

聊天窗口快速切换时，旧会话的分页请求可能比新会话晚返回。如果不处理，旧消息就会插入当前聊天窗口。我用递增的 `loadSeq` 标识当前活跃加载批次，回调回来时必须同时匹配当前会话和当前序列号，否则直接丢弃。

## Demo 展示路线

1. 打开应用并登录，展示桌面窗口、会话列表、联系人、设置页。
2. 进入聊天窗口，展示文本、图片、视频、文件消息。
3. 连续发送多条消息，说明 pending 状态、服务端 messageId 替换和失败重试。
4. 发送多个媒体文件，说明上传并发限制和文件 ACK 回填。
5. 滚动长聊天记录，说明虚拟列表、历史分页和阅读位置恢复。
6. 搜索消息并定位上下文，说明本地 SQLite 查询与消息上下文加载。
7. 断开/恢复服务端连接，说明 WebSocket 心跳、重连和状态通知。
8. 运行 `npm run test`，展示关键逻辑有自动化测试覆盖。

## 项目文件导览

- `src/main/index.js`：Electron 窗口、托盘和主进程启动逻辑
- `src/main/ipc.js`：主进程 IPC 入口，连接渲染层和本地数据层
- `src/main/wsClient.js`：WebSocket 连接、心跳、重连、接收队列和批量推送
- `src/main/db/ADB.js`：SQLite 基础访问层、事务、写队列、字段转换
- `src/main/db/ChatMessageModel.js`：消息保存、分页、搜索、清空、状态更新
- `src/renderer/src/views/chat/Chat.vue`：聊天模块编排入口
- `src/renderer/src/views/chat/composables/useChatMessages.js`：消息列表、分页、接收、竞态处理
- `src/renderer/src/views/chat/composables/useChatMessageSender.js`：发送、重试、媒体上传状态机
- `src/renderer/src/views/chat/composables/useVirtualMessageList.js`：虚拟滚动核心逻辑
- `src/renderer/src/components/chat/ChatMessageList.vue`：聊天消息列表渲染与高度测量
- `test/`：Vitest 单元测试

## 面试问题准备

### 为什么 SQLite 操作放在主进程？

桌面端的文件系统和数据库访问属于本地能力，放在主进程更符合 Electron 的职责边界。渲染层通过 IPC 请求数据，可以避免多个 UI 组件直接操作数据库造成并发混乱，也便于集中做事务、去重、错误处理和日志。

### 为什么清空聊天记录不只做 delete？

只 delete 当前本地消息会有同步边界问题：如果服务端或 WebSocket 后续又推来较旧消息，可能重新出现在列表里。所以我记录当前会话的 `clear_message_id` 或 `clear_time`，之后查询和批量保存都以这个游标过滤，保证用户视角上的“已清空”稳定。

### 为什么接收消息要批量落库？

一条消息一次落库和一次 IPC 推送，在群聊或恢复连接时会造成大量数据库写入和 UI 更新。批量处理能把多条消息合并为一次事务，同时把会话摘要和未读数一起更新，性能和一致性都更好。

### 虚拟列表为什么不用数组索引做高度缓存？

聊天记录会向头部 prepend 历史消息，如果高度缓存按数组索引保存，prepend 后所有已有消息索引都会变化，缓存会错位。用稳定的 `messageId` 做 key，历史消息插入后已有消息的高度仍能复用。

### 媒体消息为什么要拆成“创建消息”和“上传文件”？

这样能先获得服务端消息 id，保证消息在会话里有稳定身份；文件上传是耗时操作，放到后续异步任务里处理。上传失败只影响该媒体内容，不会破坏整个消息发送链路，用户也能按消息维度重试。

## 可量化表达建议

如果你后续能补测压数据，可以把简历 bullet 进一步改成下面这种更有冲击力的写法：

- 将 WebSocket 高频消息处理从逐条落库优化为批量落库，在 N 条消息恢复场景下减少约 X% 数据库写入事务。
- 使用虚拟列表将长聊天记录 DOM 节点控制在视口附近约 X 条，支持 X 千条历史消息流畅滚动。
- 通过发送状态机和失败重试，将弱网场景下消息状态从“不可感知失败”改为 pending/success/failed 可追踪状态。

没有真实数据前，不建议在简历里编数字。可以先写“降低”“减少”“提升”，面试时说明优化思路和代码实现。

## 一句话项目总结

我把一个 Electron + Vue 的聊天客户端从“页面能聊天”推进到“具备桌面 IM 客户端工程能力”：实时收发、本地持久化、长列表性能、弱网状态、数据一致性和关键逻辑测试都有覆盖。
