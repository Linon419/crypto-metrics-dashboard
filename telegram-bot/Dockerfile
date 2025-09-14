FROM node:18-alpine

WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装依赖
RUN npm ci --only=production

# 复制源码
COPY . .

# 创建数据目录
RUN mkdir -p /app/data

# 设置时区
ENV TZ=Asia/Shanghai

# 暴露端口（虽然这个机器人不需要端口，但保留以备将来使用）
EXPOSE 3000

# 启动应用
CMD ["npm", "start"]