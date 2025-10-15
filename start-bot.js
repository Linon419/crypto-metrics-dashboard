#!/usr/bin/env node

// Telegram Bot 启动脚本 - 确保从正确的目录运行并加载环境变量
const path = require('path');
const { spawn } = require('child_process');

// 确保环境变量从根目录加载
require('dotenv').config();

// 检查关键环境变量
if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN 环境变量未设置！');
  console.log('请检查根目录的 .env 文件是否包含正确的 Bot Token');
  process.exit(1);
}

console.log('✅ 环境变量加载成功');
console.log('🤖 启动Telegram机器人...');

// 启动机器人进程
const botProcess = spawn('node', ['telegram-bot/bot.js'], {
  stdio: 'inherit',
  env: { ...process.env }, // 传递所有环境变量
  cwd: __dirname // 确保工作目录是项目根目录
});

botProcess.on('error', (error) => {
  console.error('❌ 机器人启动失败:', error);
  process.exit(1);
});

botProcess.on('exit', (code) => {
  console.log(`机器人进程退出，代码: ${code}`);
  process.exit(code);
});

// 优雅关闭处理
process.on('SIGINT', () => {
  console.log('\n🛑 收到中断信号，正在关闭机器人...');
  botProcess.kill('SIGINT');
});

process.on('SIGTERM', () => {
  console.log('\n🛑 收到终止信号，正在关闭机器人...');
  botProcess.kill('SIGTERM');
});