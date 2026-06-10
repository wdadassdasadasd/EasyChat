# EasyChat — 桌面端即时通讯应用

## 一句话定位

**基于 Electron + Vue 3 的全功能桌面聊天应用，自研虚拟滚动、批量 I/O 削峰、SQLite 持久化链路，支持文本/图片/视频/文件的收发、会话管理、消息搜索等完整 IM 能力。**

---

## 技术栈

| 层 | 技术 | 版本 |
|---|------|------|
| 桌面框架 | Electron | 25 |
| 构建工具链 | electron-vite | 2.x |
| 前端框架 | Vue 3 + Composition API | 3.3 |
| 状态管理 | Pinia | 2.x |
| UI 组件库 | Element Plus | 2.x |
| 路由 | Vue Router (Hash 模式) | 4.x |
| 网络层 | Axios | 1.x |
| 实时通信 | WebSocket (ws 库, 自建心跳/重连/队列) | 8.x |
| 数据库 | SQLite3 (better-sqlite3 风格, WAL 模式) | 6.x |
| 本地存储 | electron-store | 8.x |
| 测试 | Vitest | 3.x |
| 代码规范 | ESLint + Prettier | — |

---

## 项目规模

- **源码文件**: 80+ 文件，覆盖主进程/渲染进程/预加载三层
- **总代码量**: ~8,000 行（不含 node_modules 和生成代码）
- **测试覆盖**: 5 个测试套件，覆盖 DB 层、WS 队列、消息链路、虚拟滚动
- **IPC 通道**: 16+ 通道，采用 `ipcMain.on` + `ipcMain.handle` 混合模式
- **DB 表**: 4 张核心表（chat_message、chat_session_user、user_setting、chat_session_clear），4 个索引

---

## 架构亮点（面试高频点）

### 1. 三层架构 + 数据主权归主进程

```
渲染进程（Vue 3 + Pinia + composables）
  ↕ IPC（单向事件 + 双向 invoker）
主进程（BrowserWindow + WebSocket + IPC 注册）
  ↕ 序列化写入队列
SQLite（WAL 模式, 5s busy timeout）
```

**核心决策**: 渲染进程从不直接操作 SQLite。所有数据库读写统一经过 IPC，由主进程的序列化写入队列（Promise 链）串行化所有写操作。杜绝了多窗口并发写入导致的 SQLITE_BUSY 和 TOCTOU 竞态。

### 2. 消息去重：数据库 + 前端两层幂等

- **DB 层**: 主键 `(user_id, message_id)` 物理防重 + `INSERT OR REPLACE` 幂等写入 + 事务内 `filterNewMessages` 预筛查
- **前端层**: `messageIdSet`（JS Set）在 `appendMessageIfMissing` 处拦截，保证 UI 列表里同一 `messageId` 永不出现两次
- **设计原则**: Defense in Depth（纵深防御）——DB 守住持久化底线，前端守住 UI 即时底线，两层互不信任

### 3. WebSocket 批量 flush 队列（削峰填谷）

```
onmessage → enqueue (O(1) 内存 push) → 触发器:
  ├─ 积压 ≥ 100 条 → 立即 flush
  └─ 距离第一条 < 50ms → 组合延迟 flush ┐
      新消息 50ms 内到达 → 自动拼车 ←———┘

flush → slice（安全取）→ 批量事务 → splice（成功才删）
```

**效果**: 100 条消息从 ~500-1500ms（逐条写入）降至 ~30-80ms（批量写入），效率提升 10-20 倍。带溢出保护（2000 条硬上限）、失败重试（3 次）、代际校验（重连后旧数据自动作废）。

### 4. 自研虚拟滚动（O(log n) 二分查找 + 高度缓存）

- **核心算法**: `upperBound` 在累积高度数组中二分查找可见起始索引
- **高度缓存**: 以 `messageId` 为 key（非 index），prepend 历史消息时高度映射不失效
- **增量更新**: `heightDirtyFrom` 标记脏区，只重算变更部分，避免全量重算
- **可配置**: `estimateHeight=76px`, `overscan=8`
- **滚动恢复**: prepend 历史消息后捕获 `scrollHeight` 差分，精确还原用户阅读位置

### 5. 发送链路：串行队列 + 三态消息

- **串行发送队列**: Promise 链保证本地消息顺序与服务端回包对齐
- **消息三态**: 0=失败, 1=已发送, 2=发送中（pending）
- **本地临时 ID**: `-Date.now()` 递减生成，在服务端 `messageId` 返回后原地替换
- **并发上传**: 媒体消息先建消息再上传文件，最大并发 3 路
- **完整的失败恢复**: 重试按钮 → 渐进式恢复（文件可重用已选文件，避免重复选择）

### 6. 聊天状态机：loadSeq 防竞态 + renderSeq 渲染控制

- **loadSeq**: 每次切换会话/翻页递增，回包时校验 `loadSeq === 当前活跃值`，不匹配则丢弃，防止快速切换会话时旧回包污染新会话
- **renderSeq**: 控制消息面板渲染时机，初始渲染阶段隐藏面板避免闪烁
- **bottomLockSeq**: 首屏 800ms 锁定贴底，防止图片加载期间滚动跳变

### 7. Pinia 状态管理：身份仓库 + 事件总线

- **UserInfoStore**: 全局用户身份，Pinia（内存热缓存）+ localStorage（持久化冷存储）双写，token 保护机制防止覆盖丢失
- **ContactStateStore**: 基于 Pinia 的响应式事件总线，替代 mitt/EventBus，7 个写入方 → 1 个读取方（Contact 列表），DevTools 可追踪

---

## 功能矩阵

| 模块 | 功能 |
|------|------|
| 登录 | 账号密码登录/注册、自动登录 |
| 会话管理 | 会话列表、置顶、软删除、未读计数、排序 |
| 聊天消息 | 文本/图片/视频/文件、表情、粘贴发送、拖拽发送 |
| 消息状态 | 发送中/已发送/失败、失败重试、文件上传进度 |
| 历史消息 | 上翻分页加载、搜索（Like 模糊匹配） |
| 已读管理 | 标记已读、未读累加、乐观更新 + 5s 超时回滚 |
| 清空消息 | 清除游标机制（消息可恢复，不是物理删除） |
| 联系人 | 搜索添加好友、好友申请/通过、删除好友 |
| 群组 | 创建群组、群详情、成员列表搜索、退出/解散 |
| 虚拟列表 | 大量消息流畅滚动，prepend 历史滚动位置恢复 |
| 文件管理 | 下载保存、更改存储目录、系统文件夹打开 |
| 右键菜单 | 会话右键（置顶/删除）、消息右键（复制/搜索） |
| 系统托盘 | 托盘图标、新消息闪烁提示 |
| 窗口管理 | 登录小窗 ↔ 主窗口切换、最小化/最大化/置顶/自定义标题栏 |
| 视频播放 | 内置视频播放器 + 系统播放器打开 |
| 多格式消息 | 图片（el-image 预览）、视频（封面帧生成）、文件（进度条+来源信息） |

---

## 数据库设计（SQLite）

```sql
-- 核心消息表（联合主键保证幂等）
CREATE TABLE chat_message (
    user_id VARCHAR NOT NULL,
    message_id BIGINT NOT NULL,
    session_id VARCHAR,
    message_type INTEGER,
    message_content VARCHAR,
    contact_type INTEGER,
    send_user_id VARCHAR,
    send_user_nick_name VARCHAR,
    send_time BIGINT,
    status INTEGER,               -- 0=失败 1=成功 2=发送中
    file_size BIGINT,
    file_name VARCHAR,
    file_path VARCHAR,
    file_type INTEGER,            -- 0=图片 1=视频 2=文件
    PRIMARY KEY (user_id, message_id)
);

-- 会话摘要表
CREATE TABLE chat_session_user (
    user_id VARCHAR,
    contact_id VARCHAR(11),
    contact_type INTEGER,
    session_id VARCHAR,
    status INTEGER DEFAULT 1,     -- 0=已删除
    contact_name VARCHAR,
    last_message VARCHAR,
    last_receive_time BIGINT,
    no_read_count INTEGER DEFAULT 0,
    member_count INTEGER,
    top_type INTEGER DEFAULT 0,   -- 0=无 1=置顶
    PRIMARY KEY (user_id, contact_id)
);

-- 清空游标表（逻辑清空，消息可恢复）
CREATE TABLE chat_session_clear (
    user_id VARCHAR,
    session_id VARCHAR,
    clear_message_id BIGINT DEFAULT 0,
    clear_time BIGINT DEFAULT 0,
    PRIMARY KEY (user_id, session_id)
);

-- 索引优化
CREATE INDEX idx_chat_message_user_session_message
    ON chat_message(user_id, session_id, message_id DESC);
CREATE INDEX idx_chat_session_user_sort
    ON chat_session_user(user_id, status, top_type DESC, last_receive_time DESC);
```

---

## 工程实践

- **WAL 模式 + 序列化写入**: 读并发、写串行，避免 SQLite 锁竞争
- **事务内去重**: `saveMessageBatch` 仅在事务内执行 `filterNewMessages`，防止 TOCTOU 竞态
- **IPC 类型分离**: 查询类 → `ipcMain.on` 单向回调；操作类 → `ipcMain.handle` Promise 风格
- **组件职责分层**: 全局持久态 → Pinia + localStorage；全局瞬时态 → Pinia；页面态 → Vue composables；组件态 → `ref`/`reactive`
- **内存安全**: Blob URL `URL.revokeObjectURL` 生命周期管理、消息预览列表切换时主动释放
- **本地开发体验**: electron-vite HMR、electron-store 按用户隔离、开发/生产数据库路径分离

---

## 可用面试话术

> "我独立开发了一款 Electron 桌面聊天应用，核心挑战有三个：一是大量实时消息涌入时的性能问题，我设计了基于 50ms/100 条双阈值的批量 flush 队列，在单事务内完成写入+去重+推送，效率提升 10-20 倍；二是消息列表的性能问题，我自己实现了一个虚拟滚动组件，用基于 `messageId` 的高度缓存和增量脏区更新，在 prepend 历史消息和 append 实时消息时都能保持流畅；三是分布式场景下的幂等问题——消息可能从 WebSocket 和 HTTP 两个通道到达，我在数据库和前端各做了一层去重，形成纵深防御，确保同一条消息永远不会在 UI 上出现两次。"

---

## 项目仓库

`D:\weChat2\weChat` — Electron + Vue 3 桌面即时通讯
