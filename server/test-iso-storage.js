// server/test-iso-storage.js
// 测试ISO格式的完整存储流程

const { sequelize } = require('./models');
const { Coin, DailyMetric } = require('./models');
const { parseFlexibleDateTime, validateTimePrecision } = require('./utils/timeParser');

async function testISOStorage() {
  console.log('=== 测试ISO格式存储流程 ===\n');

  try {
    // 确保数据库连接
    await sequelize.authenticate();
    console.log('数据库连接成功');

    // 测试不同格式输入，验证ISO格式存储
    const testCases = [
      {
        name: 'ISO格式存储测试 - 日精度',
        dateInput: '8.10',
        coinData: {
          symbol: 'BTC',
          name: 'Bitcoin',
          otcIndex: 1500
        }
      },
      {
        name: 'ISO格式存储测试 - 小时精度',
        dateInput: '2024.8.10 15',
        coinData: {
          symbol: 'ETH',
          name: 'Ethereum',
          otcIndex: 1200
        }
      },
      {
        name: 'ISO格式存储测试 - 分钟精度',
        dateInput: '24.8.10 15:45',
        coinData: {
          symbol: 'SOL',
          name: 'Solana',
          otcIndex: 800
        }
      }
    ];

    for (const testCase of testCases) {
      console.log(`\n${testCase.name}:`);
      
      // 解析时间（现在应该输出ISO格式）
      const timeInfo = parseFlexibleDateTime(testCase.dateInput);
      console.log(`  时间解析结果:`);
      console.log(`    原始输入: ${testCase.dateInput}`);
      console.log(`    ISO格式输出: ${timeInfo.date}`);
      console.log(`    时间戳: ${timeInfo.timestamp}`);
      console.log(`    精度: ${timeInfo.precision}`);
      console.log(`    有效性: ${timeInfo.isValid}`);

      if (!timeInfo.isValid) {
        console.log(`  ❌ 时间解析失败，跳过存储测试`);
        continue;
      }

      // 验证ISO格式
      const isoFormatRegex = /^\d{4}-\d{2}-\d{2}(\s+\d{2}:\d{2})?$/;
      const isValidISO = isoFormatRegex.test(timeInfo.date);
      console.log(`  ISO格式验证: ${isValidISO ? '✅ 有效' : '❌ 无效'}`);

      // 创建或查找币种
      const [coin, coinCreated] = await Coin.findOrCreate({
        where: { symbol: testCase.coinData.symbol },
        defaults: {
          name: testCase.coinData.name,
          current_price: null,
          logo_url: null
        }
      });

      console.log(`  币种处理: ${coinCreated ? '新创建' : '已存在'} (ID: ${coin.id})`);

      // 创建指标记录（使用ISO格式的date）
      const metricPayload = {
        coin_id: coin.id,
        date: timeInfo.date, // 现在是ISO格式
        timestamp: timeInfo.timestamp,
        time_precision: validateTimePrecision(timeInfo.precision),
        otc_index: testCase.coinData.otcIndex,
        explosion_index: 100,
        schelling_point: 50000,
        entry_exit_type: 'neutral',
        entry_exit_day: 0,
        near_threshold: false
      };

      const [metric, metricCreated] = await DailyMetric.findOrCreate({
        where: { coin_id: coin.id, date: timeInfo.date },
        defaults: metricPayload
      });

      if (!metricCreated) {
        await metric.update(metricPayload);
      }

      console.log(`  指标记录: ${metricCreated ? '新创建' : '已更新'} (ID: ${metric.id})`);
      console.log(`  存储的date字段: ${metric.date}`);
      console.log(`  存储的timestamp: ${metric.timestamp}`);
      console.log(`  存储的时间精度: ${metric.time_precision}`);
      console.log(`  ✅ 存储成功`);
    }

    // 验证存储的数据查询
    console.log('\n=== 验证ISO格式数据查询 ===');
    
    const storedMetrics = await DailyMetric.findAll({
      include: [{
        model: Coin,
        as: 'coin',
        attributes: ['symbol', 'name']
      }],
      where: {
        date: testCases.map(tc => parseFlexibleDateTime(tc.dateInput).date)
      },
      order: [['createdAt', 'DESC']]
    });

    console.log(`找到 ${storedMetrics.length} 条ISO格式记录:`);
    storedMetrics.forEach((metric, index) => {
      console.log(`\n记录 ${index + 1}:`);
      console.log(`  币种: ${metric.coin.symbol} (${metric.coin.name})`);
      console.log(`  date字段 (ISO格式): ${metric.date}`);
      console.log(`  timestamp字段: ${metric.timestamp}`);
      console.log(`  时间精度: ${metric.time_precision}`);
      console.log(`  场外指数: ${metric.otc_index}`);
      
      // 验证date字段确实是ISO格式
      const isoFormatRegex = /^\d{4}-\d{2}-\d{2}(\s+\d{2}:\d{2})?$/;
      const isValidISO = isoFormatRegex.test(metric.date);
      console.log(`  ISO格式验证: ${isValidISO ? '✅ 有效' : '❌ 无效'}`);
    });

    // 测试基于ISO格式的查询
    console.log('\n=== 测试ISO格式查询功能 ===');
    
    // 查询特定日期
    const specificDateMetrics = await DailyMetric.findAll({
      include: [{
        model: Coin,
        as: 'coin',
        attributes: ['symbol']
      }],
      where: {
        date: '2024-08-10 15:00'
      }
    });
    
    console.log(`查询 "2024-08-10 15:00" 的记录: ${specificDateMetrics.length} 条`);
    specificDateMetrics.forEach(metric => {
      console.log(`  - ${metric.coin.symbol}: ${metric.date}`);
    });

    // 查询日期范围（使用LIKE）
    const dateRangeMetrics = await DailyMetric.findAll({
      include: [{
        model: Coin,
        as: 'coin',
        attributes: ['symbol']
      }],
      where: {
        date: {
          [sequelize.Sequelize.Op.like]: '2024-08-10%'
        }
      }
    });
    
    console.log(`\n查询 "2024-08-10" 开头的记录: ${dateRangeMetrics.length} 条`);
    dateRangeMetrics.forEach(metric => {
      console.log(`  - ${metric.coin.symbol}: ${metric.date}`);
    });

    console.log('\n=== ISO格式存储测试完成 ===');

  } catch (error) {
    console.error('测试过程中出现错误:', error);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  testISOStorage().then(() => {
    console.log('测试完成');
    process.exit(0);
  }).catch(error => {
    console.error('测试失败:', error);
    process.exit(1);
  });
}

module.exports = { testISOStorage };
