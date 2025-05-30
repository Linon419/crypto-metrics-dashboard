#!/usr/bin/env node

// 测试脚本 - 验证环境变量和OpenAI服务
const path = require('path');

// 确保从根目录运行
process.chdir('/Users/yang/crypto-metrics-dashboard');

// 加载环境变量
require('dotenv').config();

console.log('🔍 环境变量检查:');
console.log('- 当前工作目录:', process.cwd());
console.log('- OPENAI_API_KEY 存在:', !!process.env.OPENAI_API_KEY);
console.log('- API_KEY 前10位:', process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.substring(0, 10) + '...' : 'N/A');
console.log('- PORT:', process.env.PORT);
console.log('- API_PUBLIC_HOST:', process.env.API_PUBLIC_HOST);

// 测试OpenAI服务
try {
  console.log('\n🧪 测试OpenAI服务初始化...');
  const openaiService = require('./server/services/openaiService');
  console.log('✅ OpenAI服务加载成功');
  
  // 测试一个简单的数据处理
  console.log('\n🧪 测试数据处理功能...');
  const testData = "5.30\nBTC 1627 进场期第26天 爆量196 谢林点位96900\nETH 1450 退场期第105天 爆量180 谢林点位1850";
  
  openaiService.processRawData(testData)
    .then(result => {
      console.log('✅ 数据处理测试成功');
      console.log('结果样例:', {
        date: result.date,
        coinsCount: result.coins ? result.coins.length : 0,
        firstCoin: result.coins ? result.coins[0]?.symbol : 'N/A'
      });
    })
    .catch(error => {
      console.error('❌ 数据处理测试失败:', error.message);
    });
    
} catch (error) {
  console.error('❌ OpenAI服务加载失败:', error.message);
  process.exit(1);
}
