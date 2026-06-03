---
name: wechat-chat-link
description: End-to-end troubleshooting, fixing, and optimization for the weChat Electron/Vue chat message flow. Use when messages fail to send or receive, pending/sent/failed status is wrong, chat sessions or unread counts drift, SQLite message history is inconsistent, WebSocket batch receive breaks, IPC callbacks are mismatched, media upload/retry behavior fails, scrolling/pagination/search behaves incorrectly, or Codex needs to trace and improve the full chat path across renderer, main process, WebSocket, HTTP, IPC, and local database.
---

# WeChat Chat Link

## Start Here

Treat chat issues as an end-to-end chain, not as an isolated component bug. Map the failing user action to one of these paths before editing:

- Send path: composer -> sender composable -> local pending save -> HTTP send -> server message replacement -> media upload/status -> session patch.
- Receive path: WebSocket -> main-process parse/filter -> SQLite batch save -> IPC batch event -> renderer dedupe/append -> session/unread patch.
- History path: session click/search/locate -> IPC query -> SQLite pagination/context -> renderer render and scroll restoration.
- Session path: route/open chat -> local session hydration -> optimistic read/top/delete -> persisted session row -> callback reconciliation.

For a deeper project map, read `references/chat-link-map.md` only when the task needs exact files, channels, payloads, or invariants.

## Workflow

1. Confirm the symptom with a narrow reproduction: who sends, contact type, message type, whether it is current chat, and whether the failure is first load, live receive, retry, search, clear, or pagination.
2. Trace both sides of every boundary touched by the symptom. For renderer/main boundaries, inspect caller and IPC handler together. For network issues, inspect HTTP/WebSocket producer and local consumer together.
3. Identify the first broken invariant in the chain. Prefer root causes such as payload mismatch, stale session identity, duplicate listener, local/server message id replacement, missing transaction, unread delta drift, or scroll state loss.
4. Apply the smallest fix that preserves the current protocol and UI expectations. Avoid server contract changes unless the user explicitly asks for them.
5. Add or update focused tests when the changed logic is in a composable, model helper, dedupe path, batch receive path, retry path, or scroll/pagination state machine.
6. Validate from `weChat` with `npm run build`; run relevant Vitest specs when present, usually `npx vitest run src/renderer/src/views/chat/composables --reporter=dot`.

## Debug Checklist

For send failures:
- Start at `src/renderer/src/components/chat/MessageSend.vue` and `src/renderer/src/views/chat/composables/useMessageSender.js`.
- Verify local pending message id, `status`, `sessionId`, `contactId`, `contactType`, and `messageType`.
- Verify `window.ipcRenderer.invoke('saveSendMessage', ...)` returns a session patch and that `replacePendingMessage` deletes the local negative id after the server id arrives.
- For media, separate "message record created" from "file uploaded"; inspect retry fields, `uploading`, `filePath`, `localPreviewUrl`, and message type/status update.

For receive failures:
- Start at `src/main/wsClient.js`, then follow `receiveMessage` or `receiveMessageBatch` into `useChatMessages.js`.
- Verify message type handling: init `0`, file/status ack `6`, normal messages through the batch queue.
- Confirm SQLite save happens before renderer publish, and that saved messages are not filtered out by dedupe or clear-history cursors.
- Confirm renderer computes the receive contact id consistently for single chat vs group chat.

For session/unread drift:
- Inspect `useChatSessions.js`, `ChatSessionUserModel.js`, and session patches emitted by `wsClient.js` or `ChatMessageModel.js`.
- Check whether the current chat should clear unread, whether self-sent messages should increment unread, and whether optimistic mark-read has a callback or rollback path.
- Keep list ordering stable: top sessions first, then `lastReceiveTime`.

For history, search, or scroll issues:
- Inspect `useChatMessages.js`, `useMessageScroll.js`, `useVirtualMessageList.js`, and `ChatMessageModel.js`.
- Preserve `loadSeq`, `sessionId`, and `targetMessageId` checks so stale async callbacks do not write into the wrong session.
- When prepending older messages, preserve viewport position using virtual-list scroll state rather than raw DOM height if the virtual list is active.

## Fix Principles

- Keep renderer state and SQLite state synchronized through explicit session patches; do not reload the full session list after every message unless a broader init event requires it.
- Prefer idempotent writes and dedupe around `messageId`; handle local negative ids only as temporary pending ids.
- Keep receive batching ordered and bounded; never let reconnect, heartbeat, receive flush, or IPC listeners multiply.
- Use transactions for message/session writes that must stay consistent.
- Preserve clear-history filtering semantics when changing message queries or batch saves.
- Avoid swallowing IPC failures. Return `{ success: false, channel, error }` or emit the existing callback error shape.
- Respect existing tests and naming conventions; do not do broad UI refactors while fixing a chat-link bug.

## Reporting

In the final response, include:
- Broken link segment: send, receive, history, session/unread, media, or mixed.
- Files changed and the invariant restored.
- Tests/build commands run.
- Any manual checks still needed, such as real WebSocket receive, media upload, or reconnect behavior when no server is available.
