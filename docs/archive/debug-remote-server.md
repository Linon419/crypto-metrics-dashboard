# 远程服务器收藏功能500错误诊断指南

## 🔍 问题诊断步骤

### 1. 检查远程服务器代码版本
```bash
# SSH到您的远程服务器
ssh root@168.138.207.11

# 进入项目目录
cd /path/to/your/crypto-dashboard

# 检查当前Git版本
git log --oneline -5

# 拉取最新代码
git pull origin main
```

### 2. 检查数据库迁移状态
```bash
# 进入server目录
cd server

# 检查数据库迁移状态
npx sequelize-cli db:migrate:status

# 如果有未执行的迁移，执行它们
npx sequelize-cli db:migrate
```

### 3. 检查服务器日志
```bash
# 查看Docker容器日志
docker logs crypto-dashboard

# 或者如果是直接运行的Node.js
pm2 logs crypto-dashboard
# 或
journalctl -u crypto-dashboard -f
```

### 4. 检查收藏API端点
```bash
# 测试收藏API是否存在
curl -X GET http://168.138.207.11:3080/api/favorites \
  -H "x-device-id: test-device-123"

# 测试添加收藏
curl -X POST http://168.138.207.11:3080/api/favorites \
  -H "Content-Type: application/json" \
  -H "x-device-id: test-device-123" \
  -d '{"symbol": "BTC"}'
```

## 🚀 快速修复方案

### 方案1: 重新部署Docker容器
```bash
# 停止当前容器
docker stop crypto-dashboard
docker rm crypto-dashboard

# 拉取最新镜像
docker pull ghcr.io/linon419/crypto-metrics-dashboard:main

# 使用生产 Compose 示例重新启动
docker-compose -f deploy/docker/docker-compose.prod.yml up -d
```

### 方案2: 手动更新代码
```bash
# 拉取最新代码
git pull origin main

# 安装依赖
cd server && npm install

# 执行数据库迁移
npx sequelize-cli db:migrate

# 重启服务
pm2 restart crypto-dashboard
# 或重启Docker容器
docker restart crypto-dashboard
```

## 🔧 可能的问题和解决方案

### 问题1: 数据库迁移未执行
**症状**: 500错误，日志显示表或字段不存在
**解决**: 执行 `npx sequelize-cli db:migrate`

### 问题2: 环境变量配置问题
**症状**: 500错误，日志显示配置相关错误
**解决**: 检查 `.env.production` 文件或Docker环境变量

### 问题3: 代码版本不匹配
**症状**: API端点不存在或行为异常
**解决**: 确保远程服务器代码是最新版本

### 问题4: 权限问题
**症状**: 数据库操作失败
**解决**: 检查数据库文件权限和目录权限

## 📋 检查清单

- [ ] 远程服务器代码已更新到最新版本
- [ ] 数据库迁移已执行完成
- [ ] 服务器日志没有错误信息
- [ ] 收藏API端点可以正常访问
- [ ] 环境变量配置正确
- [ ] Docker容器或Node.js进程正常运行

## 🆘 如果问题仍然存在

请提供以下信息：
1. 远程服务器的详细错误日志
2. `git log --oneline -5` 的输出
3. `npx sequelize-cli db:migrate:status` 的输出
4. Docker容器或进程的状态
