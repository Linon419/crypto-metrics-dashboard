# 加密货币指标仪表板

## 快速启动

### 方法1：使用npm脚本（推荐）

```bash
# 安装依赖
npm install

# 只启动后端服务器
npm run server

# 同时启动前后端（开发模式）
npm run dev
```

### 方法2：直接运行

```bash
# 从项目根目录运行
node start-server.js
```

## 环境变量配置

确保根目录的 `.env` 文件包含以下配置：

```
OPENAI_API_KEY=你的OpenAI_API_Key
JWT_SECRET=your-secret-key-change-this-in-production
REACT_APP_API_URL=http://localhost:3001
API_PUBLIC_HOST=http://localhost:3001
PORT=3001
```

## 故障排除

如果遇到 OpenAI API Key 错误：
1. 确认 `.env` 文件在项目根目录
2. 确认 `OPENAI_API_KEY` 值正确
3. 使用 `npm run server` 而不是直接在 server 目录运行

## API 端点

- `GET /api/test` - 测试API连通性
- `POST /api/data/input` - 输入原始数据
- `GET /api/data/latest` - 获取最新数据
- `GET /api/data/export-all` - 导出所有数据

服务器运行在端口 3001。
