# Chat Link Map

Use this reference when exact project paths, channels, or invariants matter.

## Core Files

- Chat shell: `weChat/src/renderer/src/views/chat/Chat.vue`
- Composer UI: `weChat/src/renderer/src/components/chat/MessageSend.vue`
- Send and retry logic: `weChat/src/renderer/src/views/chat/composables/useMessageSender.js`
- Message state, receive handlers, history loading: `weChat/src/renderer/src/views/chat/composables/useChatMessages.js`
- Session list, unread, route-open behavior: `weChat/src/renderer/src/views/chat/composables/useChatSessions.js`
- Scroll and virtual list: `weChat/src/renderer/src/views/chat/composables/useMessageScroll.js`, `useVirtualMessageList.js`, `weChat/src/renderer/src/components/chat/ChatMessageList.vue`
- HTTP API keys: `weChat/src/renderer/src/utils/Api.js`; request wrapper: `Request.js`
- IPC handlers: `weChat/src/main/ipc.js`
- WebSocket client: `weChat/src/main/wsClient.js`
- SQLite adapter and tables: `weChat/src/main/db/ADB.js`, `Tables.js`
- Message model: `weChat/src/main/db/ChatMessageModel.js`
- Session model: `weChat/src/main/db/ChatSessionUserModel.js`
- Constants: `weChat/src/main/constants.js`, `weChat/src/renderer/src/utils/ChatConstants.js`

## Send Path

1. `MessageSend.vue` emits `sendMessage`, `sendImageMessage`, `sendFileMessage`, or `sendVideoMessage`.
2. `useMessageSender.js` creates a pending local message with a negative id and `status: 2`.
3. The pending message is appended to `messageList` and persisted through `ipcRenderer.invoke('saveSendMessage', { mode: 'pending', ... })`.
4. Text messages call `Request({ url: Api.sendMessage, messageType: 2 })`.
5. Media messages call `Request({ url: Api.sendMessage, messageType: 5, fileType })`, then upload via `Api.uploadFile`.
6. Server message data replaces the local negative id through `mode: 'replace'`; failed sends update local status through `mode: 'status'`.
7. Session patches from the main process are applied through `patchChatSessions`.

Important invariants:
- A pending local id must be deleted once the positive server `messageId` is saved.
- `sessionId` should be derived from the server when available and from `${contactType}_${contactId}` only as a local fallback.
- Upload failure should fail only the media upload state, not erase the chat record.
- `retryFile` and `retryCover` are transient renderer-only fields and must not be persisted.

## Receive Path

1. `ipc.js:onLoginSuccess` calls `initWs(config, e.sender)` after login/open chat.
2. `wsClient.js` selects `devWsDomain` or `prodWsDomain`, appends `?token=...`, and creates a WebSocket.
3. Message type `0` initializes sessions/messages and publishes `receiveMessage`.
4. Message type `6` updates file/message status and publishes `receiveMessage`.
5. Normal messages enter `receiveQueue`, flush by `RECEIVE_FLUSH_DELAY` or `RECEIVE_FLUSH_MAX`, save through `saveMessageBatch`, and publish `receiveMessageBatch`.
6. `useChatMessages.js` listens for `receiveMessageBatch`, appends current-session messages, marks current chat read, and passes session patches to `useChatSessions.js`.

Important invariants:
- Save to SQLite before publishing to renderer.
- Keep batch message order stable.
- Do not increment unread for self-sent messages.
- Current chat receives should clear unread through `markSessionRead`.
- Dedupe must use string-normalized `messageId`.

## History And Search

Channels:
- `loadChatMessage` -> `loadChatMessageCallback`
- `searchChatMessage` -> `searchChatMessageCallback`
- `clearChatMessage` -> `clearChatMessageCallback`

Important invariants:
- Renderer sends `sessionId`, optional `beforeMessageId`, optional `targetMessageId`, and `loadSeq`.
- Main process echoes `sessionId` and `loadSeq`.
- Renderer must drop callbacks when `loadSeq` is stale or `sessionId` no longer matches.
- `selectMessageList` returns ascending messages to render, even though the SQL page query reads descending.
- Clear-history cursors in `chat_session_clear` must be respected by list, context, search, and batch-save filtering.

## Session And Unread

Channels:
- `loadSessionData` -> `loadSessionDataCallback`
- `markSessionRead` -> `markSessionReadCallback`
- `topChatSession`
- `delChatSession`

Important invariants:
- Session rows are upserted alongside message writes when a message changes the session summary.
- `markSessionRead` is optimistic in renderer and persisted in main; callback failure should roll back the local unread count.
- Deleting a session hides it with `status: 0`; it does not delete history.
- Clearing chat records clears local messages and session summary separately from deleting the session.

## Useful Searches

Run from `weChat`:

```powershell
rg -n "saveSendMessage|receiveMessageBatch|receiveMessage|loadChatMessage|markSessionRead" src/main src/renderer/src
rg -n "messageIdSet|replaceMessageById|appendMessageIfMissing|patchChatSessions" src/renderer/src/views/chat
rg -n "saveMessageBatch|replacePendingMessage|selectMessageList|clearMessageBySessionId" src/main/db
rg -n "HEARTBEAT|RECEIVE_FLUSH|RECONNECT|MAX_SQL_IN_PARAMS" src/main
```

## Verification Matrix

Use the smallest scenario that covers the changed path:

- Send text to current chat: pending -> sent -> local DB -> session summary.
- Send media: pending -> server id -> upload status -> preview/retry behavior.
- Receive one message in current chat: append once, unread remains zero.
- Receive one message in another chat: session moves, unread increments.
- Receive a batch across sessions: order and unread counts remain correct.
- Switch chats during history load: stale callback is dropped.
- Load older messages: viewport position is preserved.
- Clear current chat: old messages stay hidden after reconnect/backfill.
- Retry failed message: status and local/server ids stay coherent.
