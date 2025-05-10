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
RUN npm install
RUN npm run build

# 阶段 2: 设置API服务器
FROM node:18-alpine
WORKDIR /app

# 复制服务器代码
WORKDIR /app
COPY server/ ./server/

# 安装后端依赖
WORKDIR /app/server
COPY server/package.json ./
RUN npm install --production
# 安装认证所需模块
RUN npm install jsonwebtoken bcryptjs

# 创建数据目录
RUN mkdir -p /data/db

# 创建前端文件目录
# 注意：路径必须与后端代码中期望的路径匹配
RUN mkdir -p /client/build

# 从前一阶段复制构建好的前端文件
COPY --from=frontend-builder /app/build/ /client/build/

# 环境变量
ENV NODE_ENV=production
ENV PORT=3001

# 暴露端口
EXPOSE 3001

# 启动命令
CMD ["node", "index.js"]