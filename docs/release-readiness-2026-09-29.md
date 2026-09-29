# EasyChat 1.0.0 本机联调发布验收记录

日期：2026-09-29
目标：Windows 未签名本机联调安装包、Spring Boot JAR，以及客户端、后端和打包链路审查记录。

## 当前结论

客户端、后端单元测试、Electron 安全测试、打包后首次启动与重启、隔离安装和卸载均已通过。安装包只包含编译输出、运行依赖、图标和包元数据，固定连接 `http://localhost:5050` 与 `ws://localhost:5051/ws`。

隔离 MySQL/Redis 已在工作区忽略目录中启动并验证，基础 schema、六项迁移、受限数据库账号、后端 readiness 以及 HTTP/WS 端口探测均已通过。运行进程的存活依赖本机执行会话；提交产物不等于持续运行服务。双账号消息和文件授权场景完成前，产物状态为“构建、安装烟测与基础联调通过，完整业务联调验收待完成”。

## 审查发现与修复

| 编号 | 触发条件与影响 | 证据 | 修复与回归 |
| --- | --- | --- | --- |
| EC-001 | 渲染进程可写 `prodDomain`/`devDomain`，主进程又从可变 store 构造下载白名单；已登录页面若被利用，可把任意 HTTP(S) 地址加入下载与打开范围。新安装没有这些键时，合法的本机后端下载反而全部被拒绝。 | preload 暴露 `sendSetLocalStore`，下载校验读取相同 store 键。 | 删除通用 store IPC；下载来源只取经过校验的编译期 `runtimeConfig.apiOrigin`。IPC 回归覆盖空 store、本机后端允许和恶意 store 值不能扩展白名单。 |
| EC-002 | 新版仍使用 `wechat`、`.weChat` 和 `.weChattest`，会与旧版配置和数据混用。 | 应用标识和路径函数中的旧目录名。 | Electron 配置目录改为 `%APPDATA%/EasyChat`；生产数据为 `~/.EasyChat`，开发数据为 `~/.EasyChat-dev`；不读取或迁移旧目录。路径单测与打包后 SQLite 烟测通过。 |
| EC-003 | WebSocket 端口占用时，异步线程吞掉绑定异常，HTTP 仍表现为启动成功；启动探测取得的数据库连接也未关闭。 | `InitRun` 启动后台线程，starter 捕获异常后仅打印。 | WebSocket 同步绑定并向 Spring 传播失败；数据库探测使用 try-with-resources；新增成功与端口失败回归测试。 |
| EC-004 | 管理端上传机器人主头像但不上传封面时，先写主文件再空指针，形成部分更新。 | `robotCover.transferTo` 前没有校验。 | 写文件前拒绝空封面，并增加控制器回归测试。 |
| EC-005 | 无扩展名文件在上传或下载时调用后缀工具会越界；旧式上传还可用与消息记录不同的 multipart 文件名，导致写入名和下载名不一致。 | 文件后缀和落盘名直接取 multipart 原始文件名。 | 使用安全后缀解析；旧式上传要求记录文件名与 multipart 文件名一致；覆盖无扩展名下载及不一致文件名拒绝测试。 |
| EC-006 | 已执行 P1.3 outbox 排序规则迁移并不是启动条件，缺少迁移或列排序规则错误的节点仍可启动。 | schema readiness 只检查 P1.2。 | 要求 `p1-3-event-outbox-collation` 迁移记录及 `target_id=utf8mb4_general_ci`，增加通过和缺失场景测试。 |
| EC-007 | 管理端解散不存在的群返回成功码，调用端会误判操作完成。 | `AdminGroupController` 对空群抛出 `CODE_200`。 | 改为参数/资源错误码 `CODE_600` 并增加回归测试。 |
| EC-008 | 原打包规则把整个项目目录纳入 ASAR，连同 `.runtime` 中的旧安装包、MySQL 数据、Redis 数据、日志和本机凭据材料一起发布。 | 原安装包约 208 MB；构建规则只有少量排除项。 | 改为明确包含 `out/**`、`resources/icon.png` 和 `package.json`。新 ASAR 根目录只有 `node_modules`、`out`、`package.json`、`resources`，未发现项目运行目录或敏感文件名。 |
| EC-009 | 按文档在 MySQL 8.0.40 执行迁移时，三项 SQL 使用 MySQL 不支持的 `ADD COLUMN IF NOT EXISTS`；P1.3 修改排序规则后也没有写入迁移台账，导致 readiness 永远拒绝启动。 | 全新隔离库按六项顺序执行时先出现 SQL 1064；修正语法后后端因缺少 P1.3 版本记录退出。 | 改为 MySQL 8 支持的单次迁移语法，并在 P1.3 写入 `p1-3-event-outbox-collation`。全新隔离库成功导入基础 schema 和六项迁移，readiness 通过。 |
| EC-010 | 直接请求 `/userInfo/saveUserInfo` 可绕过客户端表单校验，提交空白或超长昵称以及非法枚举值，导致无效资料写入数据库并污染会话昵称。 | 控制器只筛选可编辑字段，没有校验其取值；`user_info.nick_name` 最多 20 字符。 | 在调用服务前拒绝空白或超过 20 字符的昵称，以及非法的 `joinType`/`sex`；回归测试确认异常请求不会调用持久化服务。 |

## 自动验证结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 客户端单元测试 | `npx vitest run --reporter=json` | 463/463 通过，0 跳过。 |
| 客户端 lint | `npx eslint --no-ignore "src/**/*.js" "test/**/*.js" -f json` | 0 错误，14,808 条既有 Prettier 警告；低于 14,937 条基线。 |
| Electron 开发构建安全测试 | `npx playwright test --config=playwright.electron.config.mjs` | preload 沙箱、上下文隔离、导航限制通过。 |
| Windows 构建 | `npm run build:win` | electron-vite 与 electron-builder 成功；输出 NSIS x64 安装包。 |
| 打包后/已安装版本烟测 | 设置 `EASYCHAT_PACKAGED_EXE` 后运行同一 Playwright 配置 | 2/2 通过；验证 packaged 标志、名称、版本、首次 SQLite 初始化及重启。 |
| 后端全套测试与打包 | `mvn -q '-Djava.io.tmpdir=D:\\weChat2\\backend\\target' package` | 32 项，0 失败，1 项跳过；JAR 成功。跳过项依赖 Windows 当前不可用的符号链接能力。 |
| 差异检查 | `git diff --check` | 通过；只有 Git 的 LF/CRLF 转换提示。 |
| 隔离安装/卸载 | NSIS `/S /D=<工作区隔离目录>`，再运行卸载器 `/S` | 安装退出码 0；安装后两次启动通过；卸载退出码 0，程序文件全部移除。 |

## 产物

| 产物 | 大小 | SHA-256 | 状态 |
| --- | ---: | --- | --- |
| `EasyChat/dist/easychat-1.0.0-setup.exe` | 103,048,213 字节 | `72FF3DCCB3E69AA59872AA36AAC023C2798CB6082856F3777BB462C874D4813D` | `NotSigned`，本机联调包 |
| `backend/target/easychat-1.0.jar` | 52,452,111 字节 | `D35F964888E1E2CE364B7237CE4607AA38CA1F95ABE103B28E15339EBA44514A` | Spring Boot 可执行 JAR |

Windows 可执行文件元数据为 `EasyChat` / `1.0.0`，公司名为 `EasyChat`。编译输出中未发现旧端口 `15050/15051`；HTTP 和 WebSocket 地址分别为 `localhost:5050` 与 `localhost:5051/ws`。

## 待完成联调与剩余风险

1. 隔离 MySQL `13306`、Redis `16379`、测试库 `easychat_codex_test`、受限临时账号和应用数据目录已创建；凭据只通过后端进程环境变量传入，没有写入仓库或报告。
2. 本次用隔离库重新启动后端，日志显示 schema readiness 通过，`localhost:5050/5051` 均能连接；执行会话被中断后需重新启动服务。仍需完成双账号注册登录、WebSocket 收发与恢复、文件上传下载、越权下载拒绝的实机验证。
3. 安装包按要求未签名，Windows SmartScreen 可能显示未知发布者；该包不用于公开分发。
