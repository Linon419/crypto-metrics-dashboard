#!/usr/bin/env node

// 启动脚本 - 确保从正确的目录运行服务器并加载环境变量
const path = require('path');
const { spawn } = require('child_process');

// 确保环境变量从根目录加载
require('dotenv').config();

// 环境变量可以作为 AI 配置回退；服务启动后也可在 Admin 中保存配置。
if (!process.env.OPENAI_API_KEY && !process.env.DEEPSEEK_API_KEY) {
  console.warn('⚠️ 环境变量中尚未配置 AI API Key，可在 Admin → AI模型 中完成配置');
}

console.log('✅ 环境变量加载成功');
console.log('🚀 启动加密货币指标仪表板服务器...');

// 启动服务器进程
const serverProcess = spawn('node', ['server/index.js'], {
  stdio: 'inherit',
  env: { ...process.env }, // 传递所有环境变量
  cwd: __dirname // 确保工作目录是项目根目录
});

serverProcess.on('error', (error) => {
  console.error('❌ 服务器启动失败:', error);
  process.exit(1);
});

serverProcess.on('exit', (code) => {
  console.log(`服务器进程退出，代码: ${code}`);
  process.exit(code);
});

// 优雅关闭处理
process.on('SIGINT', () => {
  console.log('\n🛑 收到中断信号，正在关闭服务器...');
  serverProcess.kill('SIGINT');
});

process.on('SIGTERM', () => {
  console.log('\n🛑 收到终止信号，正在关闭服务器...');
  serverProcess.kill('SIGTERM');
});
