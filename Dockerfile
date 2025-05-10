# 多阶段构建 Dockerfile

# 阶段 1: 构建前端
FROM node:18-alpine AS frontend-builder
WORKDIR /app

# 复制并安装依赖
COPY package*.json ./
COPY postcss.config.js tailwind.config.js .env* ./
RUN npm install

# 复制源代码并构建
COPY public/ ./public/
COPY src/ ./src/
RUN npm run build

# 阶段 2: 构建后端并整合
FROM node:18-alpine
WORKDIR /app

# 安装后端依赖
COPY server/package.json ./package.json
RUN npm install --production
# 确保安装了所需的认证模块
RUN npm install jsonwebtoken bcryptjs

# 复制server文件
COPY server/ ./

# 为前端创建client/build目录 (服务器代码中期望的路径)
RUN mkdir -p ./client/build

# 从前一阶段复制构建好的前端文件
COPY --from=frontend-builder /app/build/ ./client/build/

# 环境变量
ENV NODE_ENV=production
ENV PORT=3001

# 暴露端口
EXPOSE 3001

# 启动命令
CMD ["node", "index.js"]