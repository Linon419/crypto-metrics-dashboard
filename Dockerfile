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
# 说明：原脚本用 `wait` 等待全部子进程，只要机器人还活着，
# API 崩溃后容器依然是 running 状态，restart 策略永远不会触发，
# 外部完全看不到这次故障。这里改成任一关键进程退出就让容器一起退出。
COPY <<'EOF' /app/start.sh
#!/bin/sh
echo "Starting Crypto Metrics Dashboard..."

API_PID=""
BOT_PID=""

terminate() {
    echo "Received termination signal, stopping child processes..."
    [ -n "$API_PID" ] && kill -TERM "$API_PID" 2>/dev/null
    [ -n "$BOT_PID" ] && kill -TERM "$BOT_PID" 2>/dev/null
    wait
    exit 0
}
trap terminate TERM INT

echo "Starting API server..."
cd /app/server && node index.js &
API_PID=$!

# 轮询服务就绪状态，让机器人在 API 就绪后启动
echo "Waiting for API server to become ready..."
i=0
API_READY=0
while [ "$i" -lt 60 ]; do
    if wget -q -O /dev/null "http://127.0.0.1:${PORT:-3001}/api/test" 2>/dev/null; then
        echo "API server is ready."
        API_READY=1
        break
    fi
    if ! kill -0 "$API_PID" 2>/dev/null; then
        echo "API server exited during startup."
        exit 1
    fi
    i=$((i + 1))
    sleep 1
done

if [ "$API_READY" -ne 1 ]; then
    echo "API server did not become ready within 60 seconds."
    kill -TERM "$API_PID" 2>/dev/null
    wait "$API_PID" 2>/dev/null
    exit 1
fi

# 未配置 Token 时不启动机器人，否则它会立即 exit(1) 并拖垮整个容器
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
    echo "Starting Telegram bot..."
    cd /app/telegram-bot && node bot.js &
    BOT_PID=$!
else
    echo "TELEGRAM_BOT_TOKEN not set, skipping Telegram bot."
fi

# 任一关键进程退出即退出容器，交给 restart 策略拉起
while true; do
    if ! kill -0 "$API_PID" 2>/dev/null; then
        echo "API server exited, shutting down container."
        [ -n "$BOT_PID" ] && kill -TERM "$BOT_PID" 2>/dev/null
        exit 1
    fi
    if [ -n "$BOT_PID" ] && ! kill -0 "$BOT_PID" 2>/dev/null; then
        echo "Telegram bot exited, shutting down container."
        kill -TERM "$API_PID" 2>/dev/null
        exit 1
    fi
    sleep 5
done
EOF

RUN chmod +x /app/start.sh

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3001}/api/test" || exit 1

# 启动命令
CMD ["/app/start.sh"]
