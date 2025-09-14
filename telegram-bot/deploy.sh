#!/bin/bash

# 部署脚本for 加密货币指标监控 Telegram 机器人

echo "🚀 开始部署 Telegram 机器人..."

# 检查是否存在 .env 文件
if [ ! -f .env ]; then
    echo "❌ 错误: 未找到 .env 文件"
    echo "请先复制 .env.example 到 .env 并填入配置信息"
    echo "cp .env.example .env"
    exit 1
fi

# 检查必要的环境变量
if ! grep -q "TELEGRAM_BOT_TOKEN=" .env || grep -q "your_telegram_bot_token_here" .env; then
    echo "❌ 错误: 请在 .env 文件中设置 TELEGRAM_BOT_TOKEN"
    exit 1
fi

if ! grep -q "BOT_API_USERNAME=" .env || ! grep -q "BOT_API_PASSWORD=" .env; then
    echo "⚠️  警告: 未找到 API 认证配置"
    echo "机器人需要 API 认证才能访问数据"
    echo ""
    echo "请运行以下命令设置 API 认证:"
    echo "npm run setup"
    echo ""
    read -p "是否要现在运行设置脚本? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        node setup-bot-user.js
        if [ $? -ne 0 ]; then
            echo "❌ API 认证设置失败"
            exit 1
        fi
    else
        echo "⚠️  跳过 API 认证设置，机器人可能无法正常工作"
    fi
fi

# 创建数据目录
mkdir -p data

echo "📦 安装依赖..."
npm install

echo "🧪 运行测试检查..."
# 这里可以添加测试命令
# npm test

echo "🔄 停止现有的机器人进程..."
# 使用 PM2 管理进程
if command -v pm2 &> /dev/null; then
    pm2 stop crypto-telegram-bot 2>/dev/null || true
    pm2 delete crypto-telegram-bot 2>/dev/null || true
    
    echo "🚀 启动机器人 (使用 PM2)..."
    pm2 start bot.js --name crypto-telegram-bot --restart-delay=5000
    pm2 save
    
    echo "📊 显示状态..."
    pm2 status crypto-telegram-bot
    
    echo "📝 查看日志..."
    echo "使用以下命令查看日志:"
    echo "pm2 logs crypto-telegram-bot"
    echo "pm2 logs crypto-telegram-bot --lines 100"
    
else
    # 如果没有 PM2，使用 nohup 后台运行
    echo "⚠️  未检测到 PM2，建议安装: npm install -g pm2"
    echo "🚀 使用 nohup 后台启动..."
    
    # 杀死现有进程
    pkill -f "node.*bot.js" || true
    
    # 后台启动
    nohup node bot.js > bot.log 2>&1 &
    
    echo "✅ 机器人已在后台启动"
    echo "📝 日志文件: ./bot.log"
    echo "查看日志: tail -f bot.log"
fi

echo ""
echo "🎉 部署完成！"
echo ""
echo "📋 接下来的步骤:"
echo "1. 在 Telegram 中找到你的机器人"
echo "2. 发送 /start 开始使用"
echo "3. 发送任意消息查看 Chat ID，然后添加到 ADMIN_CHAT_IDS"
echo "4. 使用 /admin_check 测试管理员功能"
echo ""
echo "🛠️  管理命令:"
if command -v pm2 &> /dev/null; then
    echo "启动: pm2 start crypto-telegram-bot"
    echo "停止: pm2 stop crypto-telegram-bot"  
    echo "重启: pm2 restart crypto-telegram-bot"
    echo "日志: pm2 logs crypto-telegram-bot"
else
    echo "停止: pkill -f 'node.*bot.js'"
    echo "日志: tail -f bot.log"
fi