# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run dev          # Start dev server with HMR (electron-vite dev)
npm run build        # Production build
npm run start        # Preview production build
npm run lint         # ESLint with auto-fix
npm run format       # Prettier format
npm run test         # Run vitest tests (environment: node, globals: true)
npm run build:win    # Build Windows installer
npm run build:mac    # Build macOS bundle
npm run build:linux  # Build Linux packages
```

- Dev server proxies `/api` → `http://localhost:5050` (configured in `electron.vite.config.js`)
- Backend API runs on port 5050; WebSocket on port 5051
- Dev DB file: `~/.weChattest/local.db`; Production DB: `~/.weChat/local.db`
- Vitest config in `vitest.config.js`: `@` alias maps to `src/renderer/src`, `environment: 'node'`, `globals: true`

## Architecture Overview

**Electron + Vue 3 desktop chat app (EasyChat)** using `electron-vite` as the build toolchain. Three-layer architecture:

### Main Process (`src/main/`)
- **`index.js`** — BrowserWindow creation, login/chat window size transitions, system tray, IPC registration. No `contextIsolation` (preload exposes `ipcRenderer` directly to the renderer global scope).
- **`ipc.js`** — All IPC handlers registered here via `ipcMain.on` / `ipcMain.handle`. Two patterns: fire-and-forget (`ipcMain.on`) for write operations like `delChatSession`, and request-response (`ipcMain.handle` or `registerSafeIpcOn`) for reads like `loadChatMessage`. Chat data flows (sessions, messages, search, clear) all go through the main process as the sole owner of SQLite.
  - `registerSafeIpcOn(channel, callbackChannel, handler)` — wraps handlers in try/catch, sends errors back to renderer via the callback channel with `{ success: false, error }`.
- **`wsClient.js`** — Persistent WebSocket connection with heartbeat (10s), reconnect (up to 5 times, 5s delay), and batched message persistence. Incoming messages are queued, flushed to SQLite in batches, then pushed to the renderer via IPC. Uses `wsRuntimeGeneration` to discard stale flushes after a reconnect/reset.
  - **WebSocket message types**: `0` = init (full session + recent message batch, flushed immediately), `6` = status update (single message status change, flushed immediately), default = regular chat message (enqueued for batch persistence).
- **`store.js`** — Thin wrapper around `electron-store` for per-user key-value persistence (token, user prefs).
- **`constants.js`** — Main-process constants: WebSocket heartbeat/reconnect/flush tuning, `WS_SYSTEM_CONTACT_FILTER = 'EasyChat'`, `MAX_SQL_IN_PARAMS = 500`.

### Database Layer (`src/main/db/`)
- **`ADB.js`** — Low-level SQLite3 wrapper. Key details:
  - Database at `~/.weChat/local.db` (dev: `~/.weChattest/local.db`)
  - WAL mode + 5s busy timeout
  - **Serialized write queue**: all writes go through `enqueueDbWrite()` which chains promises; `runInTransaction()` injects `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` into the queue
  - `column_map` → `camelCase` conversion on all read rows
  - `MAX_SQL_IN_PARAMS = 500` caps IN-clause batch size
- **`Tables.js`** — DDL for `chat_message`, `chat_session_user`, `user_setting`, `chat_session_clear`
- **`ChatMessageModel.js`** — Message CRUD with clear-cursor filtering (`chat_session_clear`), dedup via `messageId`, paginated queries (20/page context, 50 search limit)
- **`ChatSessionUserModel.js`** — Session list queries, soft-delete (status=0), top/unread management
- **`UserSettingModel.js`** — User-level settings including file download folder path

### Preload (`src/preload/index.js`)
- Exposes `window.ipcRenderer` globally (context isolation is off)
- Provides `window.api.getPathForFile()` via `webUtils`

### Renderer (`src/renderer/`)
- **Vue 3 + Element Plus + Pinia + Vue Router (hash mode)**
- **`main.js`** — Global component registration (`Layout`, `WinOp`, `ContactPanel`, `Avatar`, `AvatarBase`, `AvatarUpload`, `Dialog`, `ShowLocalImage`, `UserBaseInfo`) and global property injection:
  - `Utils` — formatting, file utilities
  - `Verify` — form validation helpers
  - `Request` — Axios wrapper (see below)
  - `Api` — URL constants for all backend endpoints
  - `Message` — toast notifications
  - `Confirm` — confirmation dialogs
- **Router** (`src/router/index.js`) — hash-mode: `/login` → `/main` with children `/chat`, `/contact/*` (Blank, Search, ContactApply, GroupEditForm, GroupDetail, UserDetail), `/setting/*` (UserInfo, FileManage, About)
- **`utils/Request.js`** — Axios wrapper. Key behaviors:
  - **All requests are POST** — params go in the body, serialized as `URLSearchParams` by default
  - **FormData auto-detection** — if any param value is a `File`/`Blob`, switches to `multipart/form-data`
  - **Token injection** — from `localStorage('userInfo').token`, sent as `token` header
  - **Account endpoints** (`/account/*`) skip auth token to avoid sending stale tokens during login/register
  - **Code 901** — triggers full re-login flow: clear user store, IPC `logout`, navigate to `/login`
  - **Loading spinner** — automatic `ElLoading` service management with reference counting for concurrent requests
  - **Config flags**: `showLoading` (default true), `showError` (default true), `errorCallback`, `signal` (AbortController)
- **`utils/Api.js`** — URL constants for all backend endpoints (account, contact, group, chat, userInfo, admin, update)
- **`utils/ChatConstants.js`** — Chat UI thresholds: scroll tolerance, virtual list overscan, page sizes, time separator gap, file size limits (`image: 20MB`, `video: 2GB`, `file: 2GB`), chunked upload config (4MB chunks, 8MB threshold)
- **`utils/FileLimits.js`** — Client-side file type/kind detection (image/video/file) and size validation against `ChatConstants.FILE_LIMITS`

### Chat Module Architecture (`src/renderer/src/views/chat/`)
The chat feature uses a **composables pattern** where `Chat.vue` orchestrates:

| Composable | File | Responsibility |
|---|---|---|
| `useChatSessions` | `useChatSessions.js` | Session list state, sorting (top → time), name hydration from server, mark-read with rollback |
| `useChatMessages` | `useChatMessages.js` | Message list state, pagination with `loadSeq` race protection, prepend/append dedup via `messageIdSet`, scroll position restoration on history load |
| `useChatMessageSender` | `useChatMessageSender.js` | Send pipeline: create pending message → HTTP send → replace local with server message → persist via IPC `saveSendMessage`. Media messages: HTTP send first, then async file upload (max 3 concurrent). Send tasks serialized; text messages skip the queue. |
| `useMessageComposer` | `useMessageComposer.js` | Pending media preview (images/videos/files), paste/drag-drop handlers, image/video cover generation |
| `useMessageScroll` | `useMessageScroll.js` | Scroll-to-bottom logic with multi-frame settling, near-bottom detection, initial bottom lock |
| `useVirtualMessageList` | `useVirtualMessageList.js` | Virtual scrolling using measured heights keyed by `messageId` (survives prepend). Binary search over accumulated heights for O(log n) visible range. |
| `useFileTransfer` | `useFileTransfer.js` | File download with progress, cancel, open file / show in folder via IPC |
| `mediaUploadTransport` | `mediaUploadTransport.js` | Chunked file upload: files < 8MB use legacy single-request upload; files >= 8MB use init/chunk/complete pipeline with resume support (skip already-uploaded chunks). Falls back to legacy endpoint if init returns null (backward compat). |
| `useGroupChatDrawer` / `useUserChatDrawer` | `useGroupChatDrawer.js` / `useUserChatDrawer.js` | Right-side detail panels for group/user info |

### Message Flow
1. **Send**: renderer → HTTP POST `/chat/sendMessage` → receive server `messageId` → IPC `saveSendMessage` (main process writes SQLite) → WebSocket delivers to other clients
2. **Receive**: WebSocket `onmessage` → enqueue → batch flush to SQLite (`saveMessageBatch` with dedup + clear filtering) → IPC `receiveMessageBatch` → renderer appends to `messageList`
3. **Init**: WebSocket `messageType=0` → full session + recent message batch → `saveOrUpdateChatSessionBatch4Init` + `saveMessageBatch`

### File Upload Flow
1. Small files (< 8MB): single HTTP POST to `/chat/uploadFile` with file + cover in FormData
2. Large files (≥ 8MB): init (`/chat/uploadFile/init`) → chunk loop (`/chat/uploadFile/chunk`, 4MB each, skips already-uploaded) → complete (`/chat/uploadFile/complete`). Cancel via `/chat/uploadFile/cancel`.
3. Max 3 concurrent uploads; `useChatMessageSender` manages the queue

### File Download Flow
- Renderer requests download via IPC `downloadChatFile` → main process streams file over HTTP(S) with progress events (`downloadChatFileProgress`) → saves to user-configured download folder with filename conflict resolution
- IPC handlers: `cancelDownloadChatFile`, `openDownloadedFile`, `showDownloadedFileInFolder`

### Key Design Decisions
- **Main process owns all data**: renderer never touches SQLite directly; all DB operations go through IPC
- **Message status codes**: `0` = failed, `1` = sent/success, `2` = pending/sending
- **Session soft-delete**: `delChatSession` sets `status=0`; messages are preserved
- **Clear ≠ delete**: clearing a session writes a `clear_message_id` cursor; messages below it are filtered from queries but remain in DB
- **Window title bar**: custom-drawn (frameless window), with minimize/maximize/close IPC handlers in `winTitleOp`
- **`loadSeq` race protection**: each history-load request carries a monotonically increasing `loadSeq`; renderer discards responses whose `loadSeq` doesn't match the current active one, preventing cross-session data corruption
- **`wsRuntimeGeneration`**: guards against pushing stale data to a destroyed renderer after WebSocket reconnect/reset
- **`searchSeq`**: same pattern as `loadSeq` but for message search — discards stale search results

### Stores
- **`useUserInfoStore`** (Pinia) — user info persisted to both Pinia state and `localStorage('userInfo')`, with token preservation logic
- **`useContactStateStore`** (Pinia) — contact/group list state

### `@` Alias
`@` resolves to `src/renderer/src` — configured in both `electron.vite.config.js` (renderer) and `vitest.config.js` (tests).
