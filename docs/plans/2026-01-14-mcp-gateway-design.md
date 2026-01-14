# MCP Gateway 设计（HTTP）

## 目标

在现有 `crypto-metrics-dashboard` 后端之上增加一个 HTTP 形式的 MCP Gateway，通过 JSON-RPC 2.0 暴露 `tools/list` 与 `tools/call`，以便外部 Agent/客户端以“工具调用”的方式访问现有 REST API（`/api/*`）。

## 访问路径

- MCP 入口：`POST /default/crypto/mcp`

## 鉴权（公网/局域网）

采用网关级共享密钥，所有请求必须携带：

- `Authorization: Bearer <MCP_GATEWAY_TOKEN>`

若未配置 `MCP_GATEWAY_TOKEN`，网关将拒绝请求（避免误把未鉴权的网关暴露到公网）。

## 会话与 Token 传播

为解决“网关鉴权头 != 后端 JWT 头”的冲突，网关维护 `Mcp-Session-Id` 会话：

- 客户端可携带 `Mcp-Session-Id`；若不携带，服务端自动生成并返回该头。
- `auth_login`/`auth_register` 成功后，网关把后端 `token` 缓存到当前会话（`Bearer <token>`）。
- 后续需要后端鉴权的工具（如收藏/调试接口），可省略 `token` 参数，自动复用会话内 token；也可显式传 `token` 覆盖。
- 会话在内存中保存，默认 30 分钟无访问则过期清理。

## 工具映射策略

网关内置工具集合（从现有后端 API 派生），包括：

- 认证：`auth_login`、`auth_register`、`auth_verify`、`auth_change_password`
- 数据：`get_latest_data`、`get_historical_data`、`get_dashboard_data`
- 币种/指标：`get_coins`、`get_coin_by_symbol`、`get_coin_metrics`
- 流动性：`get_liquidity_data`、`get_liquidity_by_date`
- 收藏：`get_favorites`、`add_favorite`、`remove_favorite`
- 调试：`get_db_status`、`get_date_range`

工具执行方式：网关通过 HTTP 请求转发到 `CRYPTO_API_BASE_URL`（默认 `http://127.0.0.1:${PORT}/api`）。

## 风险与约束

- 公网暴露必须配置 `MCP_GATEWAY_TOKEN`，并建议配合反向代理做 TLS、IP 白名单与速率限制。
- 当前会话存储为内存态：重启会丢失会话 token；需要持久化可升级为 Redis 等外部存储。
