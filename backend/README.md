# EasyChat 后端

该目录是与 `EasyChat/` 桌面客户端共同维护的 Spring Boot 后端。它提供：

- `http://localhost:5050/api` REST API；
- `ws://localhost:5051/ws` Netty WebSocket；
- MySQL 的用户、会话、消息和可靠事件 outbox 持久化；
- Redis 的会话、在线状态、分布式协调与事件投递辅助能力；
- 本地媒体文件目录。

详细边界和迁移取舍见 [../docs/backend-architecture.md](../docs/backend-architecture.md)。

## 目录

```text
backend/
├── pom.xml                       # Maven / Spring Boot 构建
├── easychat.sql                  # 初始 MySQL 数据库结构
└── src/
    ├── main/java/com/easychat/   # HTTP、WebSocket、业务、持久化与 Redis
    ├── main/resources/           # 运行配置、Mapper XML、可靠事件迁移
    └── test/                     # 密码、接口安全与上传会话测试
```

`target/`、日志、RDB 文件和本机 `.env` 均为运行产物，已忽略，不得提交。

## 本地启动

前置条件：Java 8、Maven、MySQL 8 与 Redis。先创建数据库并导入 `easychat.sql`，再按 [迁移顺序](src/main/resources/MIGRATION_ORDER.md) 应用可靠事件 SQL。

后端只从环境变量读取敏感配置。以下示例不包含凭据：

```powershell
$env:EASYCHAT_DB_URL = 'jdbc:mysql://127.0.0.1:3306/easychat?serverTimezone=GMT%2B8&useUnicode=true&characterEncoding=utf8&useSSL=false&allowPublicKeyRetrieval=true'
$env:EASYCHAT_DB_USERNAME = '<数据库用户>'
$env:EASYCHAT_DB_PASSWORD = '<数据库密码>'
$env:EASYCHAT_REDIS_HOST = '127.0.0.1'
$env:EASYCHAT_REDIS_PORT = '6379'
$env:EASYCHAT_WS_HOST = '127.0.0.1'
$env:EASYCHAT_PROJECT_FOLDER = 'D:\EasyChat-data'
$env:EASYCHAT_INSTANCE_ID = 'easychat-local-dev'
$env:EASYCHAT_ADMIN_USER_IDS = 'U12345678901'

cd backend
mvn spring-boot:run
```

`EASYCHAT_INSTANCE_ID` 是可靠事件投递节点的唯一标识；本地单实例可使用稳定名称，部署多个节点时必须各不相同。`EASYCHAT_ADMIN_USER_IDS` 是逗号分隔的管理员用户 ID 白名单，默认为空；管理员接口每次请求都会依据该白名单重新授权。`EASYCHAT_WS_HOST` 控制 Netty WebSocket 的绑定地址，本地联调应使用 `127.0.0.1`，需要远程客户端连接的服务器可保留默认值 `0.0.0.0`。生产环境必须使用受控的密钥与配置管理，不得把账号或密码写回 `application.properties`。

## 验证

```powershell
cd backend
mvn test
mvn package
```

成功启动后，HTTP 监听 `5050`，WebSocket 监听 `5051`。客户端默认地址已经与此保持一致；更换地址时通过客户端的 `VITE_API_ORIGIN` 和 `VITE_WS_ORIGIN` 配置，而不是在页面中硬编码。
