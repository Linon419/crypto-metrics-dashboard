# Crypto Metrics Dashboard

加密指标看板，用于管理场外指数、爆破指数、K 线映射、期权策略和后台管理功能。前端基于 React，后端基于 Express + SQLite，生产部署使用 Docker 镜像。

## 快速启动

```bash
npm install
npm run dev
```

常用命令：

```bash
npm start      # 前端开发服务
npm run server # 后端 API
npm run build  # 前端生产构建
npm test       # 测试
```

## 目录结构

```text
.
├── Dockerfile
├── docker-compose.yml
├── package.json
├── package-lock.json
├── public/
├── src/                 # React 前端
├── server/              # Express API、数据库模型、路由
├── telegram-bot/        # Telegram 机器人
├── scripts/             # 构建和数据脚本
├── deploy/
│   ├── docker/          # Docker Compose 示例和环境变量模板
│   └── mcp/             # MCP Gateway 配置
└── docs/
    ├── deployment/      # 部署、OpenAI、服务说明
    ├── plans/           # 功能方案
    └── archive/         # 历史排障和旧文档
```

## 部署相关

- 主 Docker Compose 文件保留在根目录：`docker-compose.yml`
- 生产/备用 Compose 示例位于 `deploy/docker/`
- 环境变量模板位于 `deploy/docker/.env.example`
- 服务和 OpenAI 配置说明位于 `docs/deployment/`
- MCP 配置位于 `deploy/mcp/`

生产环境需要配置：

```text
JWT_SECRET
DB_STORAGE
OPENAI_API_KEY
API_PUBLIC_HOST
MCP_GATEWAY_TOKEN
```

## 数据文件

SQLite 数据库和本地日志属于运行产物，已经由 `.gitignore` 忽略。生产环境数据库通过 Docker volume 持久化。
