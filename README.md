# EasyChat 桌面即时通讯客户端

## 项目概览

EasyChat 是一款基于 Electron + Vue 3 开发的桌面端即时通讯客户端，围绕单聊、群聊、会话管理、消息收发、媒体文件传输和本地消息恢复等场景建设。

项目采用 Electron 主进程、Preload 安全桥接和 Vue 渲染进程分层设计：主进程负责 SQLite、本地文件、WebSocket、窗口控制和 IPC；渲染进程负责页面交互、消息展示和短期 UI 状态；Preload 通过白名单 API 暴露受控能力，避免渲染层直接访问 Node.js、SQLite 或任意 IPC channel。

## 技术栈

- 桌面端：Electron、electron-vite、electron-builder
- 前端：Vue 3、JavaScript、Pinia、Vue Router、Element Plus
- 通信与数据：WebSocket、Axios、SQLite3、electron-store
- 工程与测试：Vitest、ESLint、Prettier

## 架构设计

项目按 Electron 桌面应用的运行时边界拆分为主进程、Preload 安全桥接层和 Vue 渲染进程三层，核心目标是让系统能力、业务状态和页面展示各自收敛，降低聊天链路中的耦合度。

```text
用户操作
  ↓
Vue 渲染进程：页面交互、消息展示、Pinia 状态、HTTP 请求
  ↓ window.api
Preload：白名单 API、IPC 参数透传、事件订阅封装
  ↓ ipcRenderer / contextBridge
Electron 主进程：WebSocket、SQLite、文件系统、窗口控制、下载上传辅助能力
  ↓
本地 SQLite / 服务端 HTTP / WebSocket 服务
```

### 分层职责

- **主进程**：负责所有系统级能力，包括 SQLite 读写、WebSocket 连接、文件读写、窗口控制、下载打开文件和上传源管理。聊天消息接收后先在主进程侧完成校验、排队和落库，再通知渲染进程刷新。
- **Preload 层**：作为安全桥接层，只通过 `contextBridge.exposeInMainWorld('api', ...)` 暴露命名业务方法。渲染进程不能直接访问 `ipcRenderer`，也不能调用任意 channel。
- **渲染进程**：负责 Vue 页面、路由、Pinia 状态、Element Plus UI、聊天交互和短期状态维护。复杂聊天逻辑拆到 composable 中，页面组件只做组合和展示。
- **SQLite 本地存储**：保存会话、消息、未读数、消息状态和用户设置，为历史分页、离线恢复、失败重试和重启恢复提供基础。
- **WebSocket 实时链路**：负责服务端实时消息推送，配合主进程队列、批量写库和 IPC 批量通知，保证高频消息场景下的顺序和稳定性。

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
  → 更新消息状态和会话摘要
```

**接收消息流程：**

```text
WebSocket 收到消息
  → 主进程校验消息结构
  → 进入接收队列
  → 批量写入 SQLite
  → 维护会话摘要和未读数
  → 通过 IPC 批量推送给渲染进程
  → 渲染进程按 messageId 合并去重并刷新列表
```

**媒体文件流程：**

```text
用户选择文件
  → Preload 获取受控文件路径
  → 主进程注册上传源
  → 渲染进程按普通上传或分片上传发送
  → 上传进度回写 UI
  → 成功后完成消息 ID 替换和状态更新
  → 下载、预览、本地打开统一走主进程 IPC
```

### 架构取舍

- 将 SQLite 和文件系统能力放在主进程，避免渲染进程拥有过高权限，也便于统一处理数据库写队列、事务和错误。
- Preload 不暴露通用 `send` / `invoke`，而是暴露命名方法，减少 IPC channel 被误用或越权调用的风险。
- 聊天页面不把所有逻辑写在 `Chat.vue` 中，而是按会话、消息、发送、滚动、虚拟列表和文件传输拆分 composable，降低单文件复杂度。
- WebSocket 消息不直接推给页面更新，而是先落库再通知 UI，优先保证消息可靠性和跨重启恢复能力。
- 长消息列表使用自定义虚拟列表处理动态高度消息，避免大量 DOM 节点造成滚动卡顿。

## 目录设计

项目主体代码位于 `EasyChat/`，目录按 Electron 运行时和业务职责划分：

```text
EasyChat/
├── src/
│   ├── main/                         # Electron 主进程
│   │   ├── db/                       # SQLite 基础设施、表结构和数据模型
│   │   │   ├── ADB.js                # 数据库连接、写队列、事务封装
│   │   │   ├── Tables.js             # 本地表结构定义
│   │   │   ├── ChatMessageModel.js   # 消息记录读写、分页、去重和状态更新
│   │   │   ├── ChatSessionUserModel.js # 会话列表、摘要和未读数维护
│   │   │   └── UserSettingModel.js   # 用户本地设置
│   │   ├── ipc.js                    # 主进程 IPC handler
│   │   ├── ipcValidation.js          # IPC 入参校验
│   │   ├── wsClient.js               # WebSocket 心跳、重连、接收队列和批量落库
│   │   ├── constants.js              # WebSocket、批量刷盘和 SQL 参数常量
│   │   ├── uploadSourceRegistry.js   # 上传源注册、分片读取和资源释放
│   │   ├── tempVideoFiles.js         # 视频临时文件与预览辅助
│   │   └── index.js                  # Electron 应用入口和窗口创建
│   ├── preload/
│   │   └── index.js                  # contextBridge 白名单 API
│   ├── renderer/
│   │   └── src/
│   │       ├── views/chat/           # 聊天主页面和聊天 composable
│   │       ├── components/           # 公共组件和聊天展示组件
│   │       ├── stores/               # Pinia 用户、会话等全局状态
│   │       ├── router/               # Vue Router 路由
│   │       ├── utils/                # HTTP 请求、接口路径、聊天常量和工具函数
│   │       ├── App.vue               # 根组件
│   │       └── main.js               # 渲染进程入口
│   └── shared/
│       └── ipcChannels.js            # 主进程、Preload、渲染进程共享的 IPC channel 常量
├── test/                             # Vitest 测试
├── package.json                      # 脚本、依赖和工程配置
└── electron.vite.config.js           # Electron Vite 构建配置
```

### 聊天模块目录拆分

```text
src/renderer/src/views/chat/
├── Chat.vue
└── composables/
    ├── useChatSessions.js            # 会话加载、置顶、删除、未读状态
    ├── useChatMessages.js            # 消息分页、搜索、实时消息合并和去重
    ├── useChatMessageSender.js       # 文本/媒体发送、pending、替换和重试
    ├── useMessageComposer.js         # 输入框、表情、草稿和发送前组装
    ├── useMessageScroll.js           # 滚动到底、历史加载位置保持
    ├── useVirtualMessageList.js      # 动态高度虚拟列表
    ├── useFileTransfer.js            # 上传、下载、预览、取消和进度
    ├── useGroupChatDrawer.js         # 群聊资料抽屉
    └── useUserChatDrawer.js          # 用户资料抽屉
```

这样的目录设计让聊天页形成清晰的“页面编排 + 业务 composable + 主进程能力”结构：页面负责展示，composable 负责业务状态和副作用，主进程负责系统能力和持久化。

## 项目职责

1. 负责聊天核心页面开发，将会话列表、消息列表、消息发送、滚动控制、文件传输等逻辑拆分为多个 composable，降低 `Chat.vue` 单文件复杂度，提升代码复用性和维护性。
2. 实现消息发送闭环：发送前先创建本地 pending 消息，服务端返回后完成临时 ID 与 `messageId` 替换，并处理发送失败、重试和状态更新，保证弱网场景下消息状态展示一致。
3. 参与消息去重与一致性处理，基于 `messageId` 维护消息唯一性，解决历史分页加载、WebSocket 实时推送与本地 pending 消息替换过程中的重复消息问题。
4. 优化 WebSocket 消息接收链路，在 Electron 主进程侧引入消息队列、批量刷盘和串行处理机制，避免高频消息并发写入 SQLite 导致阻塞、顺序异常或状态错乱，提升消息接收稳定性。
5. 参与本地消息持久化能力建设，结合 SQLite 存储会话列表、消息记录、未读数和消息状态，支持应用重启后的数据恢复、历史消息分页加载和未读数同步。
6. 优化长消息列表渲染性能，基于虚拟列表仅渲染可视区域消息节点，并结合滚动位置维护与 DOM 高度测量处理动态高度消息，减少大量消息场景下的 DOM 渲染压力，提升列表滚动流畅度。
7. 实现媒体文件处理能力，支持普通上传、大文件分片上传、上传进度展示、`AbortController` 取消上传、超时处理、视频缩略图生成、文件下载预览及本地打开，并通过 Preload 白名单封装文件读写和 IPC 能力。

## 核心模块说明

### 1. 聊天页面模块化

聊天页将复杂逻辑拆分到 `src/renderer/src/views/chat/composables/` 下：

- `useChatSessions.js`：会话列表加载、置顶、删除、未读状态和当前会话切换。
- `useChatMessages.js`：历史消息分页、实时消息合并、消息去重和搜索结果处理。
- `useChatMessageSender.js`：文本和媒体消息发送、pending 状态、本地消息替换和失败重试。
- `useMessageScroll.js`：滚动到底部、加载历史时保持视口位置、未读位置维护。
- `useVirtualMessageList.js`：虚拟列表计算、动态高度缓存和可视区域渲染。
- `useFileTransfer.js`：文件上传、下载、打开、取消和进度管理。

这种拆分让 `Chat.vue` 更偏向页面编排，具体业务状态和副作用由 composable 承担，便于后续单独维护和测试。

### 2. 消息发送闭环

消息发送链路遵循“先落本地，再请求服务端，再替换 ID”的流程：

1. 用户发送文本、图片、视频或文件消息。
2. 渲染进程先创建本地 pending 消息并展示到消息列表。
3. 通过 Preload 白名单 API 调用主进程，将待发送消息写入本地 SQLite。
4. 请求服务端发送消息，成功后拿到正式 `messageId`。
5. 用正式 `messageId` 替换本地临时 ID，并更新消息状态为成功。
6. 失败时保留失败状态，支持用户重试，避免消息静默丢失。

这样可以在弱网、接口慢响应或应用短暂卡顿时，仍然给用户明确的发送状态反馈。

### 3. WebSocket 接收与本地持久化

WebSocket 运行在 Electron 主进程侧，主要处理心跳、重连、实时消息接收和批量落库：

- 使用心跳检测连接可用性，异常时触发重连。
- 收到消息后先进入主进程队列，避免多个消息同时写 SQLite。
- 对高频消息进行批量刷盘，减少数据库写入次数。
- 写库完成后再通过 IPC 批量通知渲染进程更新消息列表和会话摘要。
- 对重连、退出和刷新场景保留处理超时与恢复信号，降低消息丢失风险。

该链路重点解决桌面 IM 场景下“实时推送快、数据库写入慢、页面刷新频繁”带来的顺序和一致性问题。

### 4. 消息去重与一致性

项目中消息可能来自三个来源：历史分页、本地 pending 和 WebSocket 实时推送。为避免重复展示，消息列表以 `messageId` 作为主要唯一标识，并兼容本地临时 ID：

- 历史分页加载时，对已有消息做去重合并。
- pending 消息被服务端确认后，替换为正式 `messageId`。
- WebSocket echo 或实时推送到达时，优先合并已有消息状态，而不是新增重复节点。
- 会话摘要、未读数和消息表更新保持同一业务语义，避免列表和详情状态不一致。

### 5. 长列表渲染优化

聊天记录可能包含大量文本、图片、视频和文件消息，直接渲染全部 DOM 会导致滚动卡顿。项目中通过虚拟列表优化：

- 只渲染当前视口附近的消息节点。
- 对动态高度消息进行测量和缓存。
- 根据滚动位置计算可视范围和占位高度。
- 加载历史消息时维护滚动位置，避免内容突然跳动。

这部分优化能明显降低大量历史消息场景下的 DOM 压力，让聊天窗口保持更稳定的滚动体验。

### 6. 媒体文件处理

媒体能力覆盖图片、视频和普通文件：

- 小文件走普通上传流程。
- 大文件走分片上传，支持上传进度展示。
- 通过 `AbortController` 支持取消上传和超时控制。
- 视频文件支持缩略图生成和本地预览。
- 文件下载支持进度回调、取消、预览、本地打开和在文件夹中定位。
- 文件系统能力统一收敛到主进程，渲染进程只通过 Preload 暴露的白名单 API 调用。

## 安全与进程边界

- `BrowserWindow` 保持 `sandbox: true` 和 `contextIsolation: true`。
- Preload 只暴露命名业务 API，不暴露完整 `ipcRenderer`。
- 渲染进程不能直接访问 SQLite、文件系统或 Node.js API。
- IPC channel 使用白名单管理，并对文件、会话、消息等关键参数做校验。
- SQLite 写入统一由主进程串行化处理，避免渲染层直接拼接数据库操作。

## 运行方式

项目代码位于 `EasyChat/` 目录：

```bash
cd EasyChat
npm install
npm run dev
```

常用验证命令：

```bash
npm test
npm run lint
npm run build
```

## 项目价值

该项目不是简单的聊天页面展示，而是围绕桌面端即时通讯中的消息可靠性、状态一致性、本地恢复、文件传输和长列表性能进行工程化实践。通过 Electron 主进程能力、Preload 安全边界、Vue 组合式状态拆分、SQLite 本地持久化和 WebSocket 实时通信的结合，完整覆盖了 IM 客户端从发送、接收、存储、恢复到展示的核心链路。
