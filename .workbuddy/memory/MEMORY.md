# EasyChat 项目记忆

## 项目概况
- Electron 34 + Vue 3 + Pinia + SQLite 桌面 IM 客户端
- 目标对标微信桌面版聊天体验
- 当前阶段：从功能开发转向稳定性加固

## 关键文件
- 主进程: src/main/{index.js, ipc.js, wsClient.js, db/ADB.js, db/ChatMessageModel.js}
- Preload: src/preload/index.js — 白名单 API 模式，不暴露完整 ipcRenderer
- 渲染进程: src/renderer/src/views/chat/composables/{useChatMessageSender.js, useChatMessages.js, useChatSessions.js}
- 渲染进程IPC调用: 统一使用 `window.api.xxx()` 而非 `window.electron.ipcRenderer.xxx()`
- 测试: test/{main,renderer}/ 15个测试文件
- 配置: electron.vite.config.js, vitest.config.js

## 已修复 P0 问题 (2026-06-11)
- P0-1: sandbox:true + preload 白名单 API 模式 ✅
- P0-2: 移除 contextIsolation 回退路径 ✅
- P0-3: DB 读错误显式传播到 renderer (IPC handler try/catch + 中文错误提示) ✅
- P0-4: markMessageLocalSyncFailed 后台重试 (scheduleLocalSyncRetry, 指数退避3次) ✅
  - 新增 findOrphanedPendingMessages 方法 (ChatMessageModel)
  - 新增 onRecoverLocalSyncFailed IPC handler

## 已知问题 (P1+, 待修复)
- P1: receive queue溢出无补偿拉取
- P1: 无日志框架
- P1: Token通过WS URL参数传输
- P1: 上传任务无全局超时
- P1: 媒体重试依赖内存retryFile,重启后丢失

## 已修复问题 (2026-06-11 确认)
- WS pong超时检测 ✅
- messageProcessingQueue看门狗 ✅
- WAL checkpoint ✅
- pending启动恢复 ✅
- clearMessageAndSessionSummaryBySessionId 事务合并 ✅

## 审计报告
- 聊天链路架构稳定性评估-2026-06-11.md (390行)
- EasyChat-全面工程审计与优化建议-2026-06-11.md (完整审计)
