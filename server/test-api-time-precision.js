// server/test-api-time-precision.js
// 测试API端时间精度功能

const axios = require('axios');

const API_BASE = 'http://localhost:3001/api';

async function testTimePrecisionAPI() {
  console.log('=== 测试API时间精度功能 ===\n');

  try {
    // 测试用例1: 日精度数据
    console.log('1. 测试日精度数据提交...');
    const dayPrecisionData = `8.9
BTC 场外指数1500场外进场期第1天
爆破指数200
谢林点 95000`;

    const response1 = await axios.post(`${API_BASE}/data/input`, {
      rawData: dayPrecisionData
    });
    
    console.log('   日精度数据提交结果:', response1.data.success ? '✅ 成功' : '❌ 失败');
    if (response1.data.success) {
      console.log('   处理的日期:', response1.data.date);
    }

    // 测试用例2: 小时精度数据
    console.log('\n2. 测试小时精度数据提交...');
    const hourPrecisionData = `8.9 14
BTC 场外指数1520场外进场期第1天
爆破指数210
谢林点 95500`;

    const response2 = await axios.post(`${API_BASE}/data/input`, {
      rawData: hourPrecisionData
    });
    
    console.log('   小时精度数据提交结果:', response2.data.success ? '✅ 成功' : '❌ 失败');
    if (response2.data.success) {
      console.log('   处理的日期:', response2.data.date);
    }

    // 测试用例3: 分钟精度数据
    console.log('\n3. 测试分钟精度数据提交...');
    const minutePrecisionData = `8.9 14:30
BTC 场外指数1530场外进场期第1天
爆破指数220
谢林点 96000`;

    const response3 = await axios.post(`${API_BASE}/data/input`, {
      rawData: minutePrecisionData
    });
    
    console.log('   分钟精度数据提交结果:', response3.data.success ? '✅ 成功' : '❌ 失败');
    if (response3.data.success) {
      console.log('   处理的日期:', response3.data.date);
    }

    // 验证数据库中的时间精度字段
    console.log('\n4. 验证数据库中的时间精度字段...');
    const { DailyMetric } = require('./models');
    
    const metrics = await DailyMetric.findAll({
      where: {
        date: ['8.9', '8.9 14', '8.9 14:30']
      },
      order: [['createdAt', 'DESC']],
      limit: 3
    });

    console.log('   找到的记录数:', metrics.length);
    metrics.forEach((metric, index) => {
      console.log(`   记录 ${index + 1}:`);
      console.log(`     日期: ${metric.date}`);
      console.log(`     时间戳: ${metric.timestamp}`);
      console.log(`     时间精度: ${metric.time_precision}`);
      console.log(`     创建时间: ${metric.createdAt}`);
    });

    console.log('\n=== API时间精度测试完成 ===');

  } catch (error) {
    console.error('测试过程中出现错误:', error.message);
    if (error.response) {
      console.error('响应数据:', error.response.data);
    }
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  testTimePrecisionAPI().then(() => {
    console.log('测试完成');
    process.exit(0);
  }).catch(error => {
    console.error('测试失败:', error);
    process.exit(1);
  });
}

module.exports = { testTimePrecisionAPI };
