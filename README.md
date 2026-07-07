# Crypto Metrics Dashboard

Crypto Metrics Dashboard 是一套面向加密市场日常数据录入、结构化解析、指标追踪和本地化分发的全栈应用。系统以 React 前端、Express API、SQLite 数据库和 AI 原文解析服务为核心，支持本地单机运行、开发调试、Docker 部署和 Windows/macOS 一键启动包分发。

## 功能范围

- **原文解析**：将日更原文解析为标准化 JSON，并写入 SQLite。
- **指标看板**：展示场外指数、爆破指数、进退场阶段、动能标记、谢林点位和历史变化。
- **流动性记录**：维护 BTC、ETH、SOL 和总市场资金变化及原文备注。
- **期权调参**：识别 `deltaTarget`、`vegaTarget`、`strategy` 和原文片段。
- **期权策略库**：按市场状态、策略属性、操作步骤和风险点检索策略内容。
- **K 线联动**：支持 K 线映射、回补、清理、WebSocket 更新和图表展示。
- **数据管理**：提供数据库 JSON 导出/导入、SQLite 文件备份和本地数据包分发。
- **管理后台**：支持用户、币种、K 线映射、K 线清理和 AI Prompt 设置。
- **扩展接口**：包含 Telegram Bot 和 MCP Gateway 集成入口。

## 系统架构

```text
Raw Text Input
  -> React Admin UI
  -> Express API
  -> AI Parsing Service
  -> Normalization / Validation
  -> SQLite
  -> Dashboard / Kline / Options Views
```

主要组成：

| 层级 | 技术与目录 | 职责 |
| --- | --- | --- |
| 前端 | `src/`，React + Ant Design + ECharts | 数据录入、指标看板、管理后台、图表展示 |
| 后端 | `server/`，Express + Sequelize | API、认证、数据入库、导出导入、MCP Gateway |
| 数据库 | SQLite | 指标、用户、流动性、期权调参、K 线数据 |
| 启动器 | `launchers/`、`scripts/start-local-dashboard.js` | Windows/macOS 本地一键启动 |
| 部署 | `docker-compose.yml`、`deploy/` | Docker Compose、环境变量、MCP 配置 |

## 运行模式

| 模式 | 使用对象 | 启动方式 | 访问地址 |
| --- | --- | --- | --- |
| 本地分发包 | 终端用户 | 双击启动器 | `http://localhost:3001` |
| 开发模式 | 开发者 | `npm run dev` | 前端 `3000`，后端 `3001` |
| API 调试 | 开发者 | `npm run server` | `http://localhost:3001/api/test` |
| Docker 部署 | 服务器环境 | `docker compose up -d` | 由 `API_PUBLIC_HOST` 配置 |

## 本地分发包

本地分发包用于在用户自己的电脑上运行完整服务。用户下载仓库或解压分发包后，复制根目录 `.env.example` 为 `.env`，再通过启动器运行。启动器会自动执行依赖安装、前端构建、后端启动和浏览器打开流程。

用户侧前置要求：

```text
Node.js LTS: https://nodejs.org/
```

配置入口：

```bash
cp .env.example .env
```

本地访问地址：

```text
http://localhost:3001
```

初始管理员账号：

```text
username: admin
password: 123456
```

该账号用于本地初始访问；正式分发前可在管理后台修改密码。

### 生成分发包

生成纯代码分发包：

```bash
npm run build:launchers
```

生成随附当前 `database.sqlite` 的数据分发包：

```bash
npm run build:launchers:with-data
```

输出目录：

```text
local-artifacts/launchers/
```

输出文件：

```text
crypto-dashboard-local-one-click.zip
crypto-dashboard-local-one-click-with-data.zip
```

### 启动入口

Windows：

```text
launchers/windows/Start Crypto Dashboard.bat
```

macOS：

```text
launchers/mac/Start Crypto Dashboard.command
```

终端窗口需要保持运行，服务生命周期与该窗口绑定。

本地启动器、后端服务和开发命令共用根目录 `.env`。AI 原文解析依赖真实 `OPENAI_API_KEY`；未配置时，历史数据查看、数据管理和本地看板仍可使用。

本地启动器说明见 [launchers/README.md](launchers/README.md)。

## 本地开发

### 环境要求

- Node.js LTS
- npm
- OpenAI API key 或兼容 OpenAI 的 API provider

### 初始化

```bash
npm install
cp .env.example .env
```

编辑根目录 `.env`：

```env
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o
DB_STORAGE=./database.sqlite
JWT_SECRET=local_dev_secret_change_me_please_32_chars
API_PUBLIC_HOST=http://localhost:3001
ADMIN_USERNAME=admin
ADMIN_PASSWORD=123456
```

启动前后端开发服务：

```bash
npm run dev
```

只启动后端 API：

```bash
npm run server
```

访问地址：

```text
Frontend: http://localhost:3000
Backend:  http://localhost:3001
Health:   http://localhost:3001/api/test
```

## 配置项

### 后端基础配置

| 变量 | 说明 | 示例 |
| --- | --- | --- |
| `PORT` | 后端监听端口 | `3001` |
| `DB_STORAGE` | SQLite 文件路径 | `./database.sqlite` |
| `JWT_SECRET` | JWT 签名密钥 | `local_dev_secret_change_me_please_32_chars` |
| `API_PUBLIC_HOST` | 前端运行时 API 主机 | `http://localhost:3001` |
| `ADMIN_USERNAME` | 首个管理员用户名 | `admin` |
| `ADMIN_PASSWORD` | 首个管理员密码 | `123456` |

### AI 解析配置

| 变量 | 说明 | 示例 |
| --- | --- | --- |
| `OPENAI_API_KEY` | OpenAI 或兼容服务密钥 | `sk-...` |
| `OPENAI_BASE_URL` | API Base URL | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | 解析模型 | `gpt-4o` |
| `OPENAI_SYSTEM_PROMPT` | 系统 Prompt 覆盖项 | 可选 |
| `OPENAI_PROMPT` | 用户 Prompt 模板覆盖项 | 可选，需包含 `{{processedText}}` |

### 生产部署配置

生产环境建议使用强随机密钥，并通过 `.env` 或平台 Secret 注入：

```env
JWT_SECRET=please_generate_a_strong_secret_at_least_32_chars
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5-mini
DB_STORAGE=/data/db/database.sqlite
API_PUBLIC_HOST=http://your-domain-or-ip:3080
MCP_GATEWAY_TOKEN=please_set_a_strong_gateway_token
```

部署模板：

```text
deploy/docker/.env.example
deploy/docker/docker-compose.prod.yml
docker-compose.yml
```

部署说明：

- [docs/deployment/server-deployment.md](docs/deployment/server-deployment.md)
- [docs/deployment/openai-config.md](docs/deployment/openai-config.md)

## 数据模型与持久化

默认数据库：

```text
database.sqlite
```

生产数据库建议路径：

```text
/data/db/database.sqlite
```

关键数据域：

| 数据域 | 内容 |
| --- | --- |
| `Coins` | 币种基础信息 |
| `DailyMetrics` | 场外指数、爆破指数、进退场、动能标记 |
| `LiquidityOverviews` | 流动性变化和备注 |
| `OptionTunings` | 期权调参结果和原文 |
| `TrendingCoins` | 今日潜力观察类数据 |
| `CoinKlines` / `CoinKlineMappings` | K 线数据和交易对映射 |
| `Users` | 用户和管理员账号 |

数据迁移方式：

- 页面内导出/导入数据库 JSON。
- 直接备份或替换 `database.sqlite`。
- 使用 `npm run build:launchers:with-data` 生成随附数据库的分发包。

运行产物已纳入 `.gitignore`：

```text
database.sqlite
*.sqlite
local-artifacts/
backups/
logs/
server/client/build/
```

## AI 解析与本地归一化

系统主流程使用 AI 解析整段原文，本地代码负责结构校验和高确定性字段归一化。

期权调参标准输出：

```json
{
  "deltaTarget": "neutral",
  "vegaTarget": "positive",
  "strategy": "gamma_squeeze",
  "rawText": "期权调参原文"
}
```

策略名归一化示例：

```text
组成 gamma squeeze -> gamma_squeeze
组成 iron condor   -> iron_condor
组成 long straddle -> long_straddle
```

管理员可在后台 `AI解析 Prompt` 页面维护解析规则、币种别名和特殊板块处理策略。

## 常用命令

```bash
npm start                         # React 前端开发服务
npm run server                    # Express 后端 API
npm run dev                       # 前后端开发服务
npm run dev-full                  # 前端 + 后端 + Telegram Bot
npm run build                     # 前端生产构建
npm test                          # React 测试
npm run build:launchers           # 生成本地分发包
npm run build:launchers:with-data # 生成随附数据库的本地分发包
npm run bot                       # 启动 Telegram Bot
```

## API 入口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/test` | 健康检查 |
| `POST` | `/api/data/input` | 原文解析并入库 |
| `GET` | `/api/data/latest` | 获取最新指标 |
| `GET` | `/api/data/export-all` | 导出数据库 JSON |
| `POST` | `/api/data/import-all` | 导入数据库 JSON |
| `GET` | `/api/docs` | API 文档入口 |
| `POST` | `/default/crypto/mcp` | MCP Gateway |

接口定义由 [server/routes/docs.js](server/routes/docs.js) 维护。

## Telegram Bot

根目录 `.env` 配置：

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
API_BASE_URL=http://localhost:3001/api
ADMIN_CHAT_IDS=123456789,987654321
```

启动：

```bash
npm run bot
```

完整配置参考 [telegram-bot/.env.example](telegram-bot/.env.example)。

## MCP Gateway

MCP Gateway 挂载路径：

```text
POST /default/crypto/mcp
```

鉴权方式：

```text
Authorization: Bearer <MCP_GATEWAY_TOKEN>
```

配置目录：

```text
deploy/mcp/
```

设计说明见 [docs/plans/2026-01-14-mcp-gateway-design.md](docs/plans/2026-01-14-mcp-gateway-design.md)。

## 目录结构

```text
.
├── public/                 # React 静态资源
├── src/                    # React 前端
├── server/                 # Express API、数据库模型、路由
├── telegram-bot/           # Telegram Bot
├── launchers/              # Windows/macOS 本地启动器
├── scripts/                # 构建、启动、数据脚本
├── deploy/
│   ├── docker/             # Docker Compose 示例和环境变量模板
│   └── mcp/                # MCP Gateway 配置
├── docs/
│   ├── deployment/         # 部署和 OpenAI 配置
│   ├── plans/              # 设计方案
│   └── archive/            # 历史文档
├── package.json
└── docker-compose.yml
```
