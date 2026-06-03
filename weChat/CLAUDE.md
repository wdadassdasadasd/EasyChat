# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run dev          # Start dev server with HMR (electron-vite dev)
npm run build        # Production build
npm run start        # Preview production build
npm run lint         # ESLint with auto-fix
npm run format       # Prettier format
npm run test         # Run vitest tests
npm run build:win    # Build Windows installer
npm run build:mac    # Build macOS bundle
npm run build:linux  # Build Linux packages
```

- Dev server proxies `/api` → `http://localhost:5050` (configured in `electron.vite.config.js`)
- Backend API runs on port 5050; WebSocket on port 5051
- Dev DB file: `~/.weChattest/local.db`; Production DB: `~/.weChat/local.db`

## Architecture Overview

**Electron + Vue 3 desktop chat app (EasyChat)** using `electron-vite` as the build toolchain. Three-layer architecture:

### Main Process (`src/main/`)
- **`index.js`** — BrowserWindow creation, login/chat window size transitions, system tray, IPC registration. No `contextIsolation` (preload exposes `ipcRenderer` directly to the renderer global scope).
- **`ipc.js`** — All IPC handlers registered here via `ipcMain.on` / `ipcMain.handle`. Chat data flows (sessions, messages, search, clear) all go through the main process as the sole owner of SQLite.
- **`wsClient.js`** — Persistent WebSocket connection with heartbeat (10s), reconnect (up to 5 times, 5s delay), and batched message persistence. Incoming messages are queued, flushed to SQLite in batches, then pushed to the renderer via IPC.
- **`store.js`** — Thin wrapper around `electron-store` for per-user key-value persistence (token, user prefs).
- **`constants.js`** — WebSocket and SQL tuning constants shared by `wsClient.js` and `ChatMessageModel.js`.

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

### Preload (`src/preload/index.js`)
- Exposes `window.ipcRenderer` globally (context isolation is off)
- Provides `window.api.getPathForFile()` via `webUtils`

### Renderer (`src/renderer/`)
- **Vue 3 + Element Plus + Pinia + Vue Router (hash mode)**
- **`main.js`** — Global component registration (`Layout`, `Avatar`, `Dialog`, etc.) and global property injection (`Utils`, `Verify`, `Request`, `Api`, `Message`, `Confirm`)
- **Router** (`src/router/index.js`) — `/login` → `/main` with children `/chat`, `/contact/*`, `/setting/*`
- **`utils/Request.js`** — Axios wrapper with token injection (from localStorage), login-state detection (code 901 triggers re-login), file upload support via FormData. Account endpoints (`/account/*`) skip auth.
- **`utils/Api.js`** — URL constants for all backend endpoints
- **`utils/ChatConstants.js`** — Chat UI thresholds (scroll tolerance, virtual list overscan, page sizes, time separator gap)

### Chat Module Architecture (`src/renderer/src/views/chat/`)
The chat feature uses a **composables pattern** where `Chat.vue` orchestrates:

| Composable | Responsibility |
|---|---|
| `useChatSessions` | Session list state, sorting (top → time), name hydration from server, mark-read with rollback |
| `useChatMessages` | Message list state, pagination with `loadSeq` race protection, prepend/append dedup via `messageIdSet`, scroll position restoration on history load |
| `useMessageSender` | Send pipeline: create pending message → HTTP send → replace local with server message → persist via IPC `saveSendMessage`. Media messages: HTTP send first, then async file upload (max 3 concurrent). Send tasks serialized; text messages skip the queue. |
| `useMessageScroll` | Scroll-to-bottom logic with multi-frame settling, near-bottom detection, initial bottom lock |
| `useVirtualMessageList` | Virtual scrolling using measured heights keyed by `messageId` (survives prepend). Binary search over accumulated heights for O(log n) visible range. |
| `useMessageComposer` (in `useMessageSender.js`) | Pending media preview (images/videos/files), paste/drag-drop handlers, image/video cover generation |
| `useFileTransfer` | File download with progress |
| `useGroupChatDrawer` / `useUserChatDrawer` | Right-side detail panels for group/user info |

### Message Flow
1. **Send**: renderer → HTTP POST `/chat/sendMessage` → receive server `messageId` → IPC `saveSendMessage` (main process writes SQLite) → WebSocket delivers to other clients
2. **Receive**: WebSocket `onmessage` → enqueue → batch flush to SQLite (`saveMessageBatch` with dedup + clear filtering) → IPC `receiveMessageBatch` → renderer appends to `messageList`
3. **Init**: WebSocket `messageType=0` → full session + recent message batch → `saveOrUpdateChatSessionBatch4Init` + `saveMessageBatch`

### Key Design Decisions
- **Main process owns all data**: renderer never touches SQLite directly; all DB operations go through IPC
- **Message status codes**: `0` = failed, `1` = sent/success, `2` = pending/sending
- **Session soft-delete**: `delChatSession` sets `status=0`; messages are preserved
- **Clear ≠ delete**: clearing a session writes a `clear_message_id` cursor; messages below it are filtered from queries but remain in DB
- **Window title bar**: custom-drawn (frameless window), with minimize/maximize/close IPC handlers in `winTitleOp`
- **`loadSeq` race protection**: each history-load request carries a monotonically increasing `loadSeq`; renderer discards responses whose `loadSeq` doesn't match the current active one, preventing cross-session data corruption

### Stores
- **`useUserInfoStore`** (Pinia) — user info persisted to both Pinia state and `localStorage('userInfo')`, with token preservation logic
- **`useContactStateStore`** (Pinia) — contact/group list state
