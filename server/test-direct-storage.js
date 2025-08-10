// server/test-direct-storage.js
// 直接测试数据存储功能，绕过OpenAI处理

const { sequelize } = require('./models');
const { Coin, DailyMetric } = require('./models');
const { parseFlexibleDateTime, validateTimePrecision } = require('./utils/timeParser');

async function testDirectStorage() {
  console.log('=== 测试直接数据存储功能 ===\n');

  try {
    // 确保数据库连接
    await sequelize.authenticate();
    console.log('数据库连接成功');

    // 测试数据
    const testCases = [
      {
        name: '日精度测试',
        dateInput: '8.9',
        coinData: {
          symbol: 'BTC',
          name: 'Bitcoin',
          otcIndex: 1500,
          explosionIndex: 200,
          schellingPoint: 95000,
          entryExitType: 'entry',
          entryExitDay: 1
        }
      },
      {
        name: '小时精度测试',
        dateInput: '8.9 14',
        coinData: {
          symbol: 'ETH',
          name: 'Ethereum',
          otcIndex: 1200,
          explosionIndex: 180,
          schellingPoint: 3500,
          entryExitType: 'entry',
          entryExitDay: 2
        }
      },
      {
        name: '分钟精度测试',
        dateInput: '8.9 14:30',
        coinData: {
          symbol: 'SOL',
          name: 'Solana',
          otcIndex: 800,
          explosionIndex: 150,
          schellingPoint: 180,
          entryExitType: 'neutral',
          entryExitDay: 0
        }
      }
    ];

    for (const testCase of testCases) {
      console.log(`\n${testCase.name}:`);
      
      // 解析时间
      const timeInfo = parseFlexibleDateTime(testCase.dateInput);
      console.log(`  时间解析结果:`);
      console.log(`    原始输入: ${testCase.dateInput}`);
      console.log(`    解析后日期: ${timeInfo.date}`);
      console.log(`    时间戳: ${timeInfo.timestamp}`);
      console.log(`    精度: ${timeInfo.precision}`);
      console.log(`    有效性: ${timeInfo.isValid}`);

      if (!timeInfo.isValid) {
        console.log(`  ❌ 时间解析失败，跳过存储测试`);
        continue;
      }

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

      // 创建指标记录
      const metricPayload = {
        coin_id: coin.id,
        date: timeInfo.date,
        timestamp: timeInfo.timestamp,
        time_precision: validateTimePrecision(timeInfo.precision),
        otc_index: testCase.coinData.otcIndex,
        explosion_index: testCase.coinData.explosionIndex,
        schelling_point: testCase.coinData.schellingPoint,
        entry_exit_type: testCase.coinData.entryExitType,
        entry_exit_day: testCase.coinData.entryExitDay,
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
      console.log(`  存储的时间精度: ${metric.time_precision}`);
      console.log(`  存储的时间戳: ${metric.timestamp}`);
      console.log(`  ✅ 存储成功`);
    }

    // 验证存储的数据
    console.log('\n=== 验证存储的数据 ===');
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

    console.log(`找到 ${storedMetrics.length} 条记录:`);
    storedMetrics.forEach((metric, index) => {
      console.log(`\n记录 ${index + 1}:`);
      console.log(`  币种: ${metric.coin.symbol} (${metric.coin.name})`);
      console.log(`  日期: ${metric.date}`);
      console.log(`  时间戳: ${metric.timestamp}`);
      console.log(`  时间精度: ${metric.time_precision}`);
      console.log(`  场外指数: ${metric.otc_index}`);
      console.log(`  爆破指数: ${metric.explosion_index}`);
      console.log(`  谢林点: ${metric.schelling_point}`);
    });

    console.log('\n=== 直接存储测试完成 ===');

  } catch (error) {
    console.error('测试过程中出现错误:', error);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  testDirectStorage().then(() => {
    console.log('测试完成');
    process.exit(0);
  }).catch(error => {
    console.error('测试失败:', error);
    process.exit(1);
  });
}

module.exports = { testDirectStorage };
