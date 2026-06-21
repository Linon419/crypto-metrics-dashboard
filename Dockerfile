# 多阶段构建 Dockerfile

# 阶段 1: 构建前端
FROM node:18-alpine AS frontend-builder
WORKDIR /app

# 复制前端文件
COPY package*.json ./
COPY postcss.config.js tailwind.config.js ./
COPY public/ ./public/
COPY src/ ./src/

# 安装依赖并构建前端
RUN npm ci
RUN npm run build

# 阶段 2: 设置API服务器和Telegram机器人
FROM node:18-alpine
WORKDIR /app

# 复制服务器代码
COPY server/ ./server/
# 复制期权策略目录，服务端运行时会引用它
COPY scripts/optionsStrategyCatalog.js ./scripts/optionsStrategyCatalog.js
# 复制Telegram机器人代码  
COPY telegram-bot/ ./telegram-bot/

# 安装后端依赖
WORKDIR /app/server
RUN npm ci --omit=dev

# 安装Telegram机器人依赖
WORKDIR /app/telegram-bot
RUN npm ci --omit=dev

# 回到根目录
WORKDIR /app

# 创建数据目录
RUN mkdir -p /data/db

# 创建前端文件目录 - 注意路径是 /app/server/client/build
RUN mkdir -p /app/server/client/build
# 创建机器人数据目录
RUN mkdir -p /app/telegram-bot/data

# 从前一阶段复制构建好的前端文件到正确路径
COPY --from=frontend-builder /app/build/ /app/server/client/build/

# 环境变量
ENV NODE_ENV=production
ENV PORT=3001

# 暴露端口
EXPOSE 3001

# 创建启动脚本
COPY <<'EOF' /app/start.sh
#!/bin/sh
echo "Starting Crypto Metrics Dashboard..."

# 启动API服务器（后台）
echo "Starting API server..."
cd /app/server && node index.js &

# 等待API服务器启动
sleep 10

# 启动Telegram机器人
echo "Starting Telegram bot..."
cd /app/telegram-bot && node bot.js &

# 等待所有进程
wait
EOF

RUN chmod +x /app/start.sh

# 启动命令
CMD ["/app/start.sh"]
