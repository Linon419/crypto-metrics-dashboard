# 加密货币指标仪表板（后端/部署说明）

## 快速启动

### 本地开发（推荐）

```bash
# 安装依赖
npm install

# 只启动后端 API
npm run server

# 同时启动前后端（开发模式）
npm run dev
```

## 环境变量（重点）

### 生产环境必须配置

- `JWT_SECRET`：生产环境强制要求设置，且长度建议 `>=32`（服务启动时会做校验，不满足会直接退出）。
- `OPENAI_API_KEY`：用于 `POST /api/data/input` 的 AI 结构化解析。
- `DB_STORAGE`：SQLite 数据文件路径，例如：`/data/db/database.sqlite`。
- `API_PUBLIC_HOST`：后端用于生成 `/app-config.js`，供前端在运行时获取 `API_BASE_URL`，例如：`http://your-domain:3080`。
- `MCP_GATEWAY_TOKEN`：MCP 网关共享密钥（公网/局域网部署强烈建议开启，用于保护 MCP 接口）。

### 管理员初始化（首次启动）

后端启动时会检查数据库是否存在管理员账号：

- 若不存在，则创建管理员账号。
- 若未设置 `ADMIN_PASSWORD`，会自动生成随机强口令并输出到日志（请第一时间保存并尽快修改）。

可选配置：

- `ADMIN_USERNAME`（默认：`admin`）
- `ADMIN_EMAIL`（默认：`admin@example.com`）
- `ADMIN_PASSWORD`（建议生产环境显式设置）

### 开发环境认证绕过（仅开发用）

默认情况下（即使是开发环境），后端也会按 token 校验。

如需在本地开发时临时绕过认证，请显式开启：

```bash
DEV_AUTH_BYPASS=true
```

注意：生产环境（`NODE_ENV=production`）不会允许绕过。

## 常用 API

- `GET /api/test` - 测试 API 连通性
- `POST /api/data/input` - 输入原始数据并解析入库
- `GET /api/data/latest` - 获取最新数据
- `GET /api/data/export-all` - 导出所有数据

## MCP Gateway

本项目提供一个简化版 MCP Gateway（HTTP JSON-RPC），挂载在：

- `POST /default/crypto/mcp`

鉴权方式（网关级共享密钥）：

- 请求头：`Authorization: Bearer <MCP_GATEWAY_TOKEN>`
- 会话：可选 `Mcp-Session-Id`，用于在同一会话中复用 `auth_login` 获取的后端 JWT
- 可选：`CRYPTO_API_BASE_URL` 用于指定网关转发的后端 API 地址（默认 `http://127.0.0.1:${PORT}/api`）

快速自测示例（PowerShell）：

```powershell
$env:MCP='your_gateway_token'
$body = @{ jsonrpc='2.0'; id=1; method='tools/list'; params=@{} } | ConvertTo-Json -Depth 10
Invoke-RestMethod -Method Post -Uri http://localhost:3001/default/crypto/mcp -Headers @{ Authorization = \"Bearer $env:MCP\" } -ContentType 'application/json' -Body $body
```
