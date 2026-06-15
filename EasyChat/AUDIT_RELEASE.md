# EasyChat 发布前全面审批与工程收尾 — 审计文档

**审计日期**：2026-06-14  
**审计范围**：完整项目（聊天链路、SQLite、WebSocket、IPC、文件生命周期、并发一致性、前端交互）  
**当前基线**：`ab975e7` (main)，已同步 `origin/main`

---

## 一、审批结论

**结论：✅ 批准发布（条件性）**

项目当前状态满足发布基本条件。所有阻断性检查通过，无安全漏洞，无数据完整性风险。以下警告和残余风险为已知项，不影响核心功能，建议在后续迭代中处理。

| 检查项 | 状态 | 详情 |
|--------|------|------|
| 全量测试 | ✅ 281 passed / 0 failed / 0 skipped | 26 个测试文件 |
| 生产构建 | ✅ 通过 | 三目标构建成功（main/preload/renderer） |
| ESLint 错误 | ✅ 0 errors | 11,625 个 prettier CRLF 警告（仅格式） |
| Git 工作区 | ✅ 干净 | 无未跟踪变更，与 origin/main 同步 |
| 构建产物 | ✅ 未跟踪 | `out/` 在 `.gitignore` 中 |
| 安全隔离 | ✅ 通过 | sandbox + contextIsolation + 白名单完整 |
| 数据一致性 | ✅ 通过 | 事务/写队列/代次保护/去重均正确 |
| IPC 校验 | ✅ 通过 | 所有 handler 有输入校验 |

---

## 二、近期提交修复项（P0–P3 已合入）

| 提交 | 说明 |
|------|------|
| `f06c9e2` | P1 可靠性与安全加固 |
| `2366abb` | P2 工程可靠性修复 |
| `9bce3c8` | 文档更改 |
| `c8118c2` | P3 工程优化与可靠性修复 |
| `aab18ef` | 可靠性收拢 |
| `ab975e7` | 样式修复 (当前 HEAD) |

**本轮修复要点（已确认合入并验证）：**

1. **INIT 未读数修复** — `wsClient.js:673`：`saveMessageBatch(chatMessageList, { incrementUnread: false })`。服务端 INIT 推送的权威 `noReadCount` 不再被 `saveMessageBatch` 重复累加。附带回归测试 `wsClient.spec.js:165-201`。

2. **delChatSessionCallback 补齐** — preload 新增 `onDelChatSessionCallback` 订阅（`src/preload/index.js:204-206`），renderer 端实现失败回滚（`useChatSessions.js:494-541`），含 5000ms 超时保护。

3. **主进程安全收紧**：
   - 外部窗口仅允许 HTTP(S)：`windowLifecycle.js:23`
   - 文件读取/打开/定位必须属于当前用户消息记录或下载目录：`isCurrentUserMessageFilePath` + `isPathWithinFolder`
   - 视频读取大小限制

4. **IPC 测试恢复** — 4 个被跳过测试已恢复：`loadSessionData`、`delChatSession`、`topChatSession`、`markSessionRead` 的回调路径。

5. **ESLint error 清零** — 移除未使用导入，测试 mock class fields 改为构造器初始化。

6. **日志清理** — 清理遗留 FIXME、高频生产调试日志。

---

## 三、逐系统审计详情

### 3.1 聊天消息链路

**发送链路**（renderer → preload → IPC → SQLite → HTTP → replace）：
- ✅ pending-then-replace 模式一致应用于文本和媒体消息
- ✅ 消息状态 0/1/2 在 IPC 校验、DB 写入、UI 三层统一
- ✅ 串行发送队列（`useChatMessageSender.js:157-178`），上限 100
- ✅ 媒体上传并发上限 3（`useChatMessageSender.js:35-61`）
- ✅ HTTP 成功但 replace 失败时有重试队列（最多 3 次，指数退避）
- ✅ 跨重启恢复：`recoverLocalReplaceQueue` + `recoverStalePendingMessages`

**接收链路**（WebSocket → 批量落库 → IPC 推送 → renderer 去重）：
- ✅ `saveMessageBatch` 事务内完成：可见性过滤 → 去重 → 会话 upsert → 未读增量 → 消息插入 → FTS
- ✅ `filterNewMessages` 双去重：本地 Set + DB SELECT（事务内）
- ✅ `wsRuntimeGeneration` 代次保护：8 处检查点
- ✅ 溢出保护：`RECEIVE_QUEUE_MAX=2000`，超限写 JSONL 恢复文件
- ✅ 失败重试：`RECEIVE_SAVE_MAX_RETRY=3`，耗尽触发重连
- ✅ renderer 去重：`messageIdSet` + `loadSeq`/`searchSeq` 代次守卫

**会话管理**：
- ✅ 清空：`chat_session_clear` 表存储 `clear_message_id` 游标，消息被物理删除但游标持久
- ✅ 软删除：`delChatSession` 设置 `status=0`，不删消息
- ✅ 置顶：`top_type` 排序，乐观更新含 5 秒超时回滚
- ✅ 未读数：增量累加 + 读标记乐观清零 + 失败回滚含代次保护

### 3.2 SQLite 基础设施

- ✅ WAL 模式 + `synchronous=NORMAL` + 5000ms busy timeout
- ✅ 写入队列（`enqueueDbWrite`）：事务内直通，事务外串行
- ✅ Promise 链压缩（>1000 时重置计数器）
- ✅ `runInTransaction`：AsyncLocalStorage 防嵌套，`BEGIN IMMEDIATE`
- ✅ camelCase 映射 + 列白名单校验 + `MAX_SQL_IN_PARAMS=500` 分批
- ✅ 所有查询含 `userId` 过滤，无跨用户数据泄漏
- ✅ FTS5 搜索含 LIKE 降级路径
- ✅ 迁移幂等设计（`PRAGMA table_info` 检查）
- ⚠️ `idx_session_id` 索引仅 `(session_id)` 无 `user_id` 前缀，实际查询均含 `user_id`，为僵尸索引（低影响）

### 3.3 WebSocket 客户端

- ✅ 心跳：10s ping / 20s pong timeout，阻塞重复 ping
- ✅ 重连：互斥锁保护，最多 5 次，5s 间隔
- ✅ 消息校验：`isValidWsMessage` 检查 messageType、messageId、sessionId
- ✅ `normalizeWsMessages`：递归深度限制 10，防恶意嵌套
- ✅ 批量刷盘：阈值 100 条或 50ms 延迟
- ✅ `buildWsUrl`：域名来自受保护 store key，仅允许 `ws:`/`wss:`
- ⚠️ 11 处 `console.log` 应改用 `electron-log` 分级（中影响，不影响功能）

### 3.4 IPC 与安全

- ✅ BrowserWindow：`sandbox: true` + `contextIsolation: true`
- ✅ preload 白名单：send 12 通道、invoke 19 通道、listen 12 通道
- ✅ `contextIsolation` 禁用时完全不暴露 API（`process.contextIsolated` 守卫）
- ✅ 所有 IPC handler 有输入校验，无一绕过
- ✅ IpcRendererEvent 被剥离（`(_event, ...args) => listener(...args)`）
- ✅ 返回 unsubscribe 函数
- ✅ 错误格式统一：`{ success: false, channel, kind, error }`
- ⚠️ `onGetLocalStore` 用裸 `ipcMain.on` 而非 `registerSafeIpcOn`（仅影响 4 个受限制 key，低影响）

### 3.5 文件与媒体

- ✅ 小文件（<8MB）走兼容上传；大文件走 4MB 分片
- ✅ 分片上传含 init → chunk → complete 流程 + 断点续传（`uploadedChunks`）
- ✅ init 失败回退到 legacy endpoint
- ✅ `validateFileSize` 含 `Number.isNaN` 防护
- ✅ 下载路径校验：`isCurrentUserMessageFilePath` + `isPathWithinFolder` + `realpath` 解析
- ✅ 上传源注册含 UUID + 文件存在性 + 大小匹配校验
- ✅ 临时资源清理：`before-quit` 钩子清理 temp video
- ✅ 文件消息重试：区分已获 server ID（直接重上传）和本地 only（完整重发）

### 3.6 前端与状态管理

- ✅ Pinia store 管理用户信息和联系人重载信号
- ✅ 会话状态通过 composable `ref()` 作用域隔离（非全局 Pinia）
- ✅ 未读数跨组件广播：自定义 `window` 事件（`chatUnreadCountChange`）
- ✅ router guard 检查 localStorage token 存在性
- ✅ 登录过期（code=901）：清 store → 关 WebSocket → 跳转登录
- ✅ 各组件含 loading / empty / error 状态处理
- ⚠️ 空状态无文字提示（Chat.vue:113-117，仅图标）
- ⚠️ router guard 仅检查 localStorage 存在性，不验证 token 有效性

---

## 四、测试覆盖评估

### 当前覆盖

| 层 | 测试文件数 | 主要覆盖 |
|----|-----------|----------|
| main | 12 | IPC handlers, WebSocket, DB 模型, 上传, 日志, 存储迁移, temp 文件, 校验, 压力 |
| renderer | 12 | Request/Utils, useChatSessions, useChatMessages, useChatMessageSender, useFileTransfer, useVirtualMessageList, mediaUploadTransport, ChatMessageSearchDialog |
| preload | 1 | API bridge 契约, context isolation, File 注册 |

### 已知测试缺口（非阻断）

| 缺口 | 影响 |
|------|------|
| `useMessageScroll` 无测试 | 滚动行为未覆盖 |
| `useGroupChatDrawer` / `useUserChatDrawer` 无测试 | 群组/用户抽屉未覆盖 |
| `useVirtualMessageList` 仅 1 个测试 | 虚拟列表核心逻辑未充分覆盖 |
| `useFileTransfer` 仅 1 个测试 | 下载错误路径未覆盖 |
| Login.vue / Chat.vue 无组件测试 | 关键页面无集成测试 |
| 901 过期无专项测试 | 登录过期流程仅手动验证 |

---

## 五、ESLint 与代码质量

### ESLint 状态
- **0 errors** — 所有 5 个原有 error 已在近期提交中修复
- **11,625 warnings** — 全部为 `prettier/prettier: Delete ␍`（CRLF 换行符不匹配）。这是 Windows 环境下 Git 未配置 `core.autocrlf` 导致的已知问题，不影响功能。
- 建议后续配置 `.gitattributes` 或 `git config core.autocrlf true` 以消除此类警告

### 遗留生产日志（wsClient.js，11 处）
- `console.log('WebSocket connected')` line 754
- `console.log('WebSocket closed, reconnecting')` line 780
- `console.log('WebSocket error', ...)` line 788
- `console.log('WebSocket closed intentionally')` line 800
- `console.log('prepare reconnect...')` line 816
- `console.log('WebSocket reconnect timeout')` line 828
- 建议后续统一改用 `electron-log` 并设置适当日志级别

### 请求调试日志（Request.js）
- `console.log('[Request调试]...')` line 156, 256：已用 `import.meta.env.DEV` 守卫，但会打印 URL（可能含敏感参数）。建议改为 `electron-log.debug`

### FIXME/TODO
- ✅ **零个遗留** — 代码库中无 FIXME/TODO/HACK/XXX 标记

---

## 六、既有警告与新增警告

### 既有警告（非本轮引入）

| 警告 | 来源 | 影响 |
|------|------|------|
| Sass legacy JS API deprecation (27x) | Element Plus / vite | 仅为第三方依赖弃用提示，不影响构建 |
| Sass `if()` function deprecation (4x) | Element Plus `col.scss` | CSS `if()` 语法变化，上游需修复 |
| wsClient 动态/静态导入混用 | electron-vite | 已知设计选择（preload 需静态导入，`before-quit` 需动态导入） |
| CRLF 换行符警告 (11,625x) | prettier | 仅格式警告，Git 换行符配置问题 |
| `idx_session_id` 僵尸索引 | Tables.js:81 | 仅 `session_id` 无 `user_id`，实际不会被查询命中 |

### 新增警告（本轮修复引入）

- **无新增警告** — 本轮修改未引入新的 lint 警告、构建警告或测试失败

---

## 七、残余联调风险

| 风险 | 等级 | 说明 |
|------|------|------|
| 无后端联调验证 | 🟡 中 | 所有测试基于 mock，未与真实服务端对联。HTTP/WebSocket 协议字段假设可能与服务端实际实现有偏差 |
| `electron-builder` 配置缺失 | 🟡 中 | `package.json` 无 `"build"` 字段，无 `electron-builder.yml`。`build:win` 脚本可能无法生成安装包 |
| delChatSession 5000ms 超时回滚 | 🟢 低 | 慢 DB 写入可能导致 UI 回滚但 DB 操作最终成功，下次加载时自愈 |
| `reLogin` 火后不管 | 🟢 低 | renderer 跳转可能与主进程清理竞速，但实际影响极小 |
| `saveMessage` 非严格模式 | 🟢 低 | INIT 路径插入失败时可能产生孤立 FTS 条目，概率极低 |
| `recoverStalePendingMessages` 60s 窗口 | 🟢 低 | 大文件长时上传可能被误标为失败，下次登录时触发 |
| 无 electron 端到端测试 | 🟡 中 | 所有测试均为单元/集成级别，无完整 Electron 窗口测试 |
| `console.log` 泄露到生产 | 🟢 低 | wsClient 日志可能暴露连接时序，不泄露用户数据 |

---

## 八、工作区与环境

```
当前分支：   main
HEAD：       ab975e7 样式修复
远程同步：   origin/main（未领先，已同步）
工作区：     干净（无未暂存或未跟踪变更）
构建产物：   out/（在 .gitignore 中，未跟踪）
依赖：       未发生无关变化
锁文件：     未发生无关变化
```

---

## 九、发布前最终检查清单

- [x] `npm test` — 281 passed, 0 failed, 0 skipped（26 files）
- [x] `npm run build` — 三目标构建成功
- [x] `npx eslint src test --no-fix` — 0 errors
- [x] `git diff --check` — 无空白错误
- [x] 构建产物未被跟踪
- [x] 无硬编码密钥/Token/密码
- [x] 无 FIXME/TODO 遗留
- [x] 安全隔离 intact（sandbox + contextIsolation + 白名单）
- [x] 消息状态语义一致（0=failed, 1=success, 2=pending）
- [x] IPC 输入校验全覆盖
- [x] 文件路径越权防护完整
- [x] 数据隔离：所有查询含 userId

---

## 十、建议后续工作（不阻断本次发布）

1. **配置 electron-builder** — 补齐打包配置以生成可分发的安装包
2. **CRLF 修复** — 添加 `.gitattributes` 或配置 `core.autocrlf=true`
3. **wsClient 日志升级** — `console.log` → `electron-log` 分级
4. **测试补充** — `useVirtualMessageList`、`useFileTransfer`、`useMessageScroll`、Login/Chat 组件
5. **901 过期测试** — Request.js 的登录过期路径
6. **router guard 增强** — 考虑服务端 token 校验或定时刷新
7. **僵尸索引清理** — 移除 `idx_session_id`
8. **后端联调** — 在真实服务端环境中验证所有协议假设

---

*审计基于 `D:\weChat2\EasyChat\CLAUDE.md` 规范要求，覆盖聊天链路、SQLite、WebSocket、IPC、文件生命周期、并发一致性和前端交互全部领域。*
