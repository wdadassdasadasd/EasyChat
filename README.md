# EasyChat 桌面即时通讯客户端

## 项目概览

EasyChat 是一款基于 Electron 和 Vue 3 构建的桌面即时通讯客户端，覆盖登录注册、单聊与群聊、联系人管理、会话管理、消息收发、媒体文件传输、本地消息持久化和断线恢复等场景。

项目采用 Electron 主进程、Preload 安全桥接层和 Vue 渲染进程的分层设计：主进程负责 SQLite、文件系统、WebSocket、上传下载任务、窗口控制和 IPC；渲染进程负责页面交互、消息展示、HTTP 请求及短期 UI 状态；Preload 仅通过命名的白名单 API 暴露受控能力，避免渲染层直接访问 Node.js、SQLite 或任意 IPC channel。

## 技术栈

- 桌面端：Electron 34、electron-vite、electron-builder
- 前端：Vue 3、JavaScript、Pinia、Vue Router、Element Plus
- 通信与数据：WebSocket、Axios、SQLite3、electron-store
- 工程与测试：Vitest、Playwright、ESLint、Prettier

## 架构设计

项目按 Electron 的运行时边界拆分为主进程、Preload 安全桥接层和 Vue 渲染进程。系统能力、持久化事实和页面状态分别收敛，重点保证消息链路在重复投递、网络波动、应用重启和会话切换时仍可恢复。

```text
用户操作
  ↓
Vue 渲染进程：页面交互、消息展示、Pinia 状态、HTTP 与同步请求
  ↓ window.api
Preload：命名白名单 API、IPC 参数校验与事件订阅封装
  ↓ contextBridge / ipcRenderer
Electron 主进程：WebSocket、SQLite、文件系统、上传下载任务、窗口控制
  ↓
本地 SQLite / 服务端 HTTP / WebSocket 服务
```

### 分层职责

- **主进程**：独占 SQLite、文件系统、WebSocket、窗口和任务管理能力。消息接收后先校验、排队并批量落库，再将业务数据通知渲染进程；上传和下载按当前用户及运行代次隔离。
- **Preload 层**：仅通过 `contextBridge.exposeInMainWorld('api', ...)` 暴露命名业务方法、回调订阅与取消订阅能力，不提供通用 `send` 或 `invoke` 接口。
- **渲染进程**：负责 Vue 页面、路由、Pinia 状态、Element Plus UI、聊天交互、HTTP 请求及同步触发。聊天页面将领域状态和副作用拆分到 composable，页面组件保持编排职责。
- **SQLite 本地存储**：保存会话、消息、未读数、消息状态、上传任务、同步游标和用户设置。写入通过队列与事务串行化，为历史分页、失败重试、断线补偿和重启恢复提供本地事实来源。
- **WebSocket 与同步链路**：WebSocket 处理心跳、重连和实时事件；接收事件批量事务落库、按事件去重并推进同步游标。异常或游标失效时，渲染进程通过增量事件同步或快照同步恢复本地状态。

### 核心数据流

**发送消息流程：**

```text
输入框发送
  → 渲染进程生成本地 pending 消息
  → 调用 Preload 白名单 API
  → 主进程写入 SQLite
  → 渲染进程请求服务端发送
  → 服务端返回 messageId
  → 本地临时 ID 替换为正式 messageId
  → 更新消息状态、会话摘要和上传任务状态
```

**接收与恢复流程：**

```text
WebSocket 收到 V2 事件
  → 主进程校验事件结构并进入有界队列
  → 批量事务写入 SQLite、去重并更新游标/未读数
  → 通过 IPC 批量推送给渲染进程
  → 渲染进程按 messageId 合并、去重并刷新会话
  → 发生断线、溢出或游标失效时执行增量同步或快照同步
```

**媒体文件流程：**

```text
用户选择文件
  → Preload 注册受控上传源或封面
  → 主进程持久化并调度上传任务
  → 小文件普通上传；大文件按分片上传
  → 上传进度与服务端 ACK 回写消息状态
  → 下载、预览、打开和文件夹定位统一走主进程 IPC
```

### 架构取舍

- 将 SQLite、文件系统和长生命周期任务放在主进程，既保持渲染进程最小权限，也便于统一处理写队列、事务、用户切换和异常清理。
- Preload 只暴露命名业务 API，并在主进程执行 IPC 来源和参数校验，避免任意 channel 被调用。
- 接收消息坚持“先持久化、后通知 UI”，用少量展示延迟换取可恢复的本地状态与跨重启一致性。
- 聊天逻辑按会话、消息、发送、输入、滚动、虚拟列表、文件传输和同步控制拆分，避免 `Chat.vue` 成为难以维护的单体组件。
- 长消息列表采用动态高度虚拟窗口；高频接收采用有界批处理与增量会话更新，降低 SQLite、IPC 和 DOM 的放大开销。

## 目录设计

项目主体代码位于 `EasyChat/`，目录按 Electron 运行时和业务职责划分：

```text
EasyChat/
├── src/
│   ├── main/                              # Electron 主进程
│   │   ├── db/                            # SQLite 基础设施、表结构和数据模型
│   │   │   ├── ADB.js                     # 数据库连接、写队列和事务封装
│   │   │   ├── Tables.js                  # 本地表结构定义
│   │   │   ├── ChatMessageModel.js        # 消息记录、状态和同步事件落库
│   │   │   ├── ChatSessionUserModel.js    # 会话摘要、排序和未读数维护
│   │   │   └── UploadTaskModel.js         # 可恢复上传任务持久化
│   │   ├── ipc.js                         # 主进程 IPC handler
│   │   ├── ipcRegistry.js                 # 可信 IPC 注册与来源校验
│   │   ├── ipcValidation.js               # IPC 入参校验
│   │   ├── wsClient.js                    # WebSocket、接收队列、批量落库和重连
│   │   ├── uploadTaskManager.js           # 上传调度、重试和 ACK 协调
│   │   ├── downloadTaskManager.js         # 下载进度、取消和运行代次隔离
│   │   ├── receiveRecoveryStore.js        # 接收落库失败时的本地恢复记录
│   │   ├── syncRuntimeDiagnostics.js      # 同步运行诊断状态
│   │   └── index.js                       # Electron 应用入口和窗口创建
│   ├── preload/
│   │   └── index.js                       # contextBridge 白名单 API
│   ├── renderer/
│   │   └── src/
│   │       ├── views/                     # 登录、聊天、联系人和设置页面
│   │       ├── components/                # 公共组件和聊天展示组件
│   │       ├── stores/                    # Pinia 用户、联系人等全局状态
│   │       ├── router/                    # Vue Router 路由与鉴权守卫
│   │       ├── utils/                     # HTTP、接口路径、聊天与文件工具
│   │       ├── App.vue                    # 根组件
│   │       └── main.js                    # 渲染进程入口
│   └── shared/
│       ├── runtimeConfig.js               # HTTP/WebSocket 运行时地址配置
│       ├── ipcChannels.js                 # 跨进程共享的 IPC channel 常量
│       └── v2EventTypes.js                # 实时与同步事件协议常量
├── test/                                  # Vitest 单元、集成与压力测试
│   ├── main/                              # 主进程、SQLite、IPC 与任务管理测试
│   ├── preload/                           # Preload 白名单测试
│   ├── renderer/                          # 页面、工具和聊天 composable 测试
│   └── electron/                          # Electron 启动与安全策略测试
├── docs/
│   └── reliability-performance.md         # 可靠性、性能与联调说明
├── package.json                           # 脚本、依赖和工程配置
└── electron.vite.config.js                # Electron Vite 构建配置
```

### 聊天模块目录拆分

```text
src/renderer/src/views/chat/
├── Chat.vue
└── composables/
    ├── useChatPageController.js           # 聊天页生命周期、同步与订阅编排
    ├── useChatSessions.js                 # 会话加载、置顶、删除和未读状态
    ├── useChatMessages.js                 # 历史分页、实时消息合并、搜索和去重
    ├── useChatMessageSender.js            # 文本/媒体发送、pending 替换和重试
    ├── useMessageComposer.js              # 输入框、表情、草稿和发送前组装
    ├── useMessageScroll.js                # 滚动到底、历史加载位置保持
    ├── useVirtualMessageList.js           # 动态高度虚拟列表
    ├── useFileTransfer.js                 # 上传、下载、预览、取消和进度
    ├── outbound/                          # 发出消息与媒体上传生命周期
    ├── message/                           # 消息集合、历史与订阅控制
    ├── session/                           # 会话操作、资料解析与订阅控制
    └── fileTransfer/                      # 本地文件访问与视频预览控制
```

这样的目录设计形成“页面编排 + 领域 composable + 主进程能力”的结构：页面负责展示和组合，composable 负责业务状态与副作用，主进程负责系统能力和持久化。

## 项目职责

1. 提供登录注册、单聊群聊、联系人检索与申请、群成员管理、个人资料和本地文件设置等桌面端即时通讯能力。
2. 实现可恢复的消息发送闭环：发送前创建并持久化本地 pending 消息，服务端确认后替换临时 ID；失败、替换异常或媒体 ACK 延迟时保留状态并支持恢复或重试。
3. 实现主进程 WebSocket 接收链路：心跳与重连、事件校验、有界队列、批量事务落库、IPC 批量通知和本地恢复记录，降低高频消息下的顺序和一致性风险。
4. 维护会话、消息、未读数和同步游标的一致性；使用事件去重、增量事件同步和快照同步覆盖重复投递、断线重连、游标失效与页面切换场景。
5. 提供图片、视频和普通文件的传输能力，包括受控文件访问、分片上传、并发限制、进度反馈、取消、下载预览、打开文件及文件夹定位。
6. 优化长消息列表体验：按可视窗口渲染动态高度消息，加载历史时保持滚动锚点，减少大量聊天记录对 DOM 和滚动性能的影响。

## 核心模块说明

### 1. 聊天页面模块化

聊天页面将领域逻辑拆分到 `src/renderer/src/views/chat/composables/` 下：

- `useChatPageController.js`：组织页面生命周期、订阅、事件同步、快照恢复和已读回执补偿。
- `useChatSessions.js`：会话列表加载、置顶、删除、未读状态和当前会话切换。
- `useChatMessages.js`：历史消息分页、实时消息合并、搜索、会话切换代次保护和消息去重。
- `useChatMessageSender.js`：文本和媒体消息发送、pending 状态、本地消息替换和失败重试。
- `useMessageComposer.js`：输入框、表情、草稿和待发送媒体组装。
- `useMessageScroll.js` 与 `useVirtualMessageList.js`：滚动位置保持、动态高度缓存和可视区域渲染。
- `useFileTransfer.js`：上传、下载、打开、预览、取消和进度管理。

这种拆分让 `Chat.vue` 保持页面编排职责，具体业务状态和副作用由领域 composable 承担，便于单独维护和测试。

### 2. 消息发送闭环

消息发送链路遵循“先落本地，再请求服务端，再替换 ID”的流程：

1. 用户发送文本、图片、视频或文件消息。
2. 渲染进程创建本地 pending 消息并显示在消息列表。
3. 通过 Preload 白名单 API 调用主进程，将待发送消息写入本地 SQLite。
4. 渲染进程请求服务端发送；媒体消息由主进程上传任务管理器按状态调度上传。
5. 服务端确认后使用正式 `messageId` 替换临时 ID，并更新消息、会话摘要和相关任务状态。
6. 失败、替换未完成或 ACK 延迟时保留可恢复状态，允许后续重试和重启后的补偿处理。

该流程在弱网、接口慢响应和应用短暂中断时仍向用户提供明确的状态反馈，避免静默丢失消息。

### 3. WebSocket 接收与本地持久化

WebSocket 运行在 Electron 主进程侧，负责心跳、重连、实时事件接收和批量落库：

- 对事件结构、嵌套深度和运行代次进行校验，异常事件不会直接进入页面状态。
- 消息先进入有界接收队列，再以事务批量写入 SQLite，维护会话摘要、未读数和同步游标。
- 重复事件由已处理事件记录去重；只在同一事务成功后推进游标，防止恢复时跳过数据。
- 写库成功后通过 IPC 批量通知渲染进程，减少高频消息造成的跨进程和 UI 刷新压力。
- 队列溢出、落库失败或连接异常时触发恢复信号；渲染进程通过增量事件或快照同步补齐状态。

### 4. 消息去重与一致性

消息可能来自历史分页、本地 pending、WebSocket 推送和同步恢复。项目以 `messageId` 为主要唯一标识，并在本地临时 ID 替换期间保持可合并状态：

- 历史分页、搜索结果和实时消息进入列表时进行去重合并。
- pending 消息被服务端确认后，替换为正式 `messageId`，避免 echo 产生重复节点。
- 会话摘要、未读数、消息状态和同步游标在主进程事务中协同更新，并按当前用户隔离查询。
- 快速切换会话和搜索时通过代次保护丢弃过期结果，避免旧异步回包覆盖当前视图。

### 5. 长列表渲染优化

聊天记录包含文本、图片、视频和文件消息，直接渲染全部 DOM 会影响滚动体验。项目通过虚拟列表处理长历史：

- 仅渲染当前视口及 overscan 范围内的消息节点。
- 缓存动态高度消息的测量结果，并计算顶部和底部占位高度。
- 加载更早历史时使用滚动锚点维持视口位置，避免内容插入后突然跳动。
- 消息集合按唯一 ID 合并，减少实时事件和历史分页叠加时的重复渲染。

### 6. 媒体文件处理

媒体能力覆盖图片、视频和普通文件：

- 选择文件后由 Preload 注册受控上传源，渲染进程不直接读取 Node.js 文件系统。
- 小文件走普通上传；大于等于 8MB 的文件走 4MB 分片上传，支持进度、重试、取消和服务端状态协调。
- 上传任务本地持久化，限制并发数，并在用户切换、任务完成或失败后清理上传源和临时封面资源。
- 视频支持缩略图生成和本地预览；文件下载支持进度回调、取消、预览、本地打开和在文件夹中定位。
- 下载任务按用户、运行代次和消息 ID 隔离，并校验下载源与重定向，避免旧会话任务向新窗口推送状态。

## 安全与进程边界

- `BrowserWindow` 保持 `sandbox: true` 和 `contextIsolation: true`。
- Preload 仅暴露命名业务 API、受控订阅与取消订阅方法，不暴露完整 `ipcRenderer` 或任意 channel 调用能力。
- 渲染进程不能直接访问 SQLite、文件系统或 Node.js API；文件、上传源和下载操作均经主进程 IPC 执行。
- IPC 使用可信来源注册和参数校验，关键的用户、会话、消息、路径和 URL 在主进程再次验证。
- SQLite 写入统一经过写队列或事务，并按当前 `userId` 隔离；跨表状态更新不在渲染层拼接补偿逻辑。
- 运行时地址默认使用本地开发服务：HTTP 为 `http://localhost:5050`，WebSocket 为 `ws://localhost:5051/ws`；可在启动或构建前通过 `VITE_API_ORIGIN` 与 `VITE_WS_ORIGIN` 覆盖。非本机地址须使用 HTTPS/WSS。

## 运行方式

项目代码位于 `EasyChat/` 目录：

```bash
cd EasyChat
npm install
npm run dev
```

如需指定本地或受控环境的服务地址，可在执行命令前设置 `VITE_API_ORIGIN` 与 `VITE_WS_ORIGIN`。

常用验证命令：

```bash
npm test
npm run lint
npm run build
```

端到端验证和各平台构建命令：

```bash
npm run test:e2e
npm run test:all
npm run build:win
npm run build:mac
npm run build:linux
```

## 项目价值

EasyChat 不只是聊天页面展示项目，而是围绕桌面端即时通讯中的消息可靠性、状态一致性、本地恢复、受控系统权限、文件传输和长列表性能进行工程化实践。项目将 Electron 主进程能力、Preload 最小权限边界、Vue 组合式状态拆分、SQLite 事务持久化、WebSocket 批处理和同步补偿结合起来，覆盖消息从发送、接收、存储、恢复到展示的完整链路。
