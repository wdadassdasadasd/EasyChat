# CLAUDE.md

本文件是 EasyChat 桌面聊天客户端的长期协作规范。开发者或 AI 修改代码前必须阅读并遵守。

## 项目说明
EasyChat 是基于 Electron、Vue 3、SQLite 和 WebSocket 的桌面即时通信客户端，优先保证消息可靠、状态一致、故障可恢复和桌面端安全。
- 登录注册、窗口控制、用户资料与本地设置
- 单聊群聊、会话排序、置顶、未读数、搜索与聊天记录
- 文本及媒体收发、大文件分片上传、下载与打开
- 本地消息持久化、离线恢复、清空与失败重试

## 修改前必读
- `package.json` 与 `electron.vite.config.js`
- `src/main/index.js`、`ipc.js`、`wsClient.js`、`constants.js`
- `src/main/db/ADB.js`、`Tables.js` 与各数据模型
- `src/preload/index.js`
- `src/renderer/src/main.js`、`router/` 与 `stores/`
- `src/renderer/src/utils/Request.js`、`Api.js`、`ChatConstants.js`
- `src/renderer/src/views/chat/`
- `test/main/`、`test/preload/` 与 `test/renderer/`
涉及聊天消息时，必须同时追踪 renderer、preload、IPC、WebSocket 和 SQLite 两端契约。

## 技术栈
- 桌面壳：Electron 34、electron-vite、electron-builder
- 前端：Vue 3、JavaScript、Element Plus、Pinia、Vue Router、SCSS/Less
- 数据与通信：SQLite3、WebSocket `ws`、Axios、electron-store
- 测试与规范：Vitest、ESLint、Prettier
- 除非任务明确要求，不得引入新依赖或替换现有技术栈

## 目录与职责
```text
src/
├── main/                 # 主进程、窗口、IPC、WebSocket、SQLite
│   └── db/               # 表结构、数据库基础设施和数据模型
├── preload/              # contextBridge 白名单 API
└── renderer/src/
    ├── components/       # 公共组件和聊天组件
    ├── router|stores|utils/
    └── views/chat/       # 聊天页面与 composables
test/
└── main|preload|renderer/
```
- `main` 独占 SQLite、WebSocket、文件系统和系统能力。
- `preload` 只暴露命名业务方法，不暴露完整 `ipcRenderer`。
- `renderer` 负责界面、交互和短期状态，不直接访问 Node.js 或 SQLite。
- `Chat.vue` 只做编排，复杂行为放入 composable；数据库逻辑放在 `src/main/db/`。

## 聊天链路原则
- 发送消息必须先保存本地 pending，再请求 HTTP，成功后用服务端 `messageId` 替换。
- 消息状态固定为：`0` 失败、`1` 成功、`2` pending/发送中。
- HTTP 成功但本地 replace 失败时，必须保留重试和跨重启恢复能力。
- 文本、媒体发送不得因并发回包倒序或重复；媒体 replace 恢复后必须继续上传。
- 接收消息先由主进程批量落库，再通过 IPC 推送 renderer。
- `messageType=0` 表示初始化，`messageType=6` 表示文件或状态 ACK。
- 会话清空使用 clear cursor 语义；删除会话为软删除，不得误删历史消息。
- 未读数、会话摘要和消息写入保持事务或可补偿一致性，并覆盖失败、切换和重启恢复。

## IPC 与安全规范
- BrowserWindow 必须保持 `sandbox: true` 和 `contextIsolation: true`。
- preload 仅通过 `contextBridge.exposeInMainWorld('api', ...)` 暴露 API。
- renderer 禁止使用 `window.electron`、`window.ipcRenderer` 或任意 channel 调用。
- 新 IPC 能力必须同时修改 main handler、preload 白名单、renderer 调用和测试。
- 订阅必须返回 unsubscribe 并及时清理；回调只传业务数据，不暴露 `IpcRendererEvent`。
- IPC 错误统一返回可判断的 `success`、`kind`、`error` 和必要上下文。
- 主进程校验关键 ID、路径和类型，不得关闭安全隔离来绕过 API 问题。

## 数据库规范
- 所有 SQLite 写操作必须经过 `enqueueDbWrite` 或 `runInTransaction`。
- 多表一致性操作使用事务，不得在 renderer 侧拼接补偿 SQL。
- 查询必须带当前 `userId`，避免不同用户本地数据串线。
- 批量 `IN` 查询遵守 `MAX_SQL_IN_PARAMS=500`。
- 保持 WAL、busy timeout、写队列和 camelCase 映射；错误必须显式传播。
- 新增字段或表时同步检查 `Tables.js`、模型、迁移兼容和测试。

## HTTP 与 WebSocket 规范
- renderer HTTP 请求统一使用 `src/renderer/src/utils/Request.js`。
- 接口路径统一维护在 `src/renderer/src/utils/Api.js`，不得在组件硬编码生产地址。
- HTTP 请求当前统一使用 POST；文件参数由 Request 自动切换为 FormData。
- 登录过期 `code=901` 必须清理用户状态、关闭 WebSocket 并返回登录页。
- 可取消请求传递 `AbortController.signal`，并区分 timeout、canceled、HTTP 和 API code。
- WebSocket 心跳、重连、处理超时、批量刷盘参数统一维护在 `src/main/constants.js`。
- 不得绕过消息队列和运行代次保护；溢出、刷盘失败或超时必须触发恢复信号。

## 文件与媒体规范
- 图片、视频、普通文件统一遵守 `ChatConstants` 和 `FileLimits`。
- 小文件走兼容上传；大于等于 8MB 使用 4MB 分片上传流程。
- 上传并发上限由发送 composable 管理，不在组件内另建无界队列。
- 文件系统操作经 main IPC 执行；路径需校验，临时资源和控制器必须清理。
- 文件失败状态应允许用户重试，并给出可操作的中文提示。

## Vue 与状态规范
- Vue 使用 Composition API 和 JavaScript，保持现有 `<script setup>` 或组件风格。
- 页面组件保持轻量，可复用状态和副作用放入 composable。
- 快速切换会话、联系人或群聊时使用 `loadSeq`、`searchSeq` 或等价代次保护。
- 列表和 WebSocket echo 按 `messageId` 去重；乐观更新提供回滚并清理副作用。
- 用户可见状态必须包含加载、空数据、失败和重试反馈，避免白屏或静默失败。

## 代码规范
- 文件使用 UTF-8，新增中文不得乱码。
- 优先复用已有组件、composable、模型、常量和错误结构。
- 函数职责单一，避免一个函数同时处理请求、持久化、UI 和文件清理。
- 复杂并发、事务和恢复逻辑注释设计意图，不留无用 import、调试日志或空 catch。
- 修改范围应贴合任务，不用大规模重构夹带小修复。

## 禁止事项
- renderer 直接访问 SQLite、文件系统、`ipcRenderer` 或 Node.js API
- 绕过白名单新增通用 `send(channel)`、`invoke(channel)` 接口
- 未经评估改变消息状态、messageType、会话清空或软删除语义
- 在没有本地 pending 的情况下先发送网络消息
- 忽略 DB、IPC、WebSocket 或上传失败并返回成功
- 随意修改依赖、锁文件、构建配置或安全配置
- 硬编码 Token、密码、密钥、用户目录或生产服务地址
- 未运行验证就声称通过，或为通过检查而跳过测试

## 运行与验收
命令在 `EasyChat/` 目录执行：
```bash
npm run dev
npm run lint
npm test
npm run build
```
- 修改生产逻辑至少运行相关 Vitest；跨进程或共享逻辑运行全量 `npm test`。
- 修改 Electron、Vue、preload 或构建相关代码必须运行 `npm run build`。
- `npm run lint` 当前带 `--fix`，执行前确认不会产生无关格式化。
- 涉及 UI 时验证登录、会话加载、发送接收、错误提示和窗口缩放。
- 涉及消息时验证文本、媒体、失败重试、重连、分页、搜索和未读数。
- 无法执行的检查必须说明原因，不得声称已经通过。

## 提交规范
使用中文 Conventional Commit，例如：
```text
fix: 修复消息本地恢复异常
perf: 优化批量消息落库
refactor: 整理聊天会话状态
test: 补充 IPC 错误回归测试
docs: 更新项目协作规范
```
除非用户明确要求，不得擅自提交、推送或创建 Pull Request。

## AI 输出要求
修改前输出：需求理解、计划修改文件、实现方案、风险点。
修改后输出：本次修改、修改文件、自测方式、注意事项。
发现工作区已有无关改动时必须保留并排除，不得覆盖、回滚或混入提交。
所有 AI 生成代码必须经过人工 Review 后才能合并。

## 演进方向
优先：消息可靠性、恢复闭环、IPC 输入校验、日志与诊断、WebSocket 补偿同步、测试自动化。
其次：大数据量会话性能、SQLite 批量写入、虚拟列表、上传下载体验和跨平台行为。
暂不优先：任意插件系统、重型框架迁移、脱离现有服务端协议的大规模重写。
