// server/test-year-support.js
// 测试年份支持功能

const { sequelize } = require('./models');
const { Coin, DailyMetric } = require('./models');
const { parseFlexibleDateTime, validateTimePrecision } = require('./utils/timeParser');

async function testYearSupport() {
  console.log('=== 测试年份支持功能 ===\n');

  try {
    // 确保数据库连接
    await sequelize.authenticate();
    console.log('数据库连接成功');

    // 测试不同年份格式的数据
    const testCases = [
      {
        name: '当前年份省略格式',
        dateInput: '8.9',
        coinData: {
          symbol: 'BTC',
          name: 'Bitcoin',
          otcIndex: 1500
        }
      },
      {
        name: '完整年份格式',
        dateInput: '2024.8.9',
        coinData: {
          symbol: 'ETH',
          name: 'Ethereum',
          otcIndex: 1200
        }
      },
      {
        name: '简化年份格式',
        dateInput: '24.8.9',
        coinData: {
          symbol: 'SOL',
          name: 'Solana',
          otcIndex: 800
        }
      },
      {
        name: '带时间的完整年份',
        dateInput: '2024.8.9 14:30',
        coinData: {
          symbol: 'ADA',
          name: 'Cardano',
          otcIndex: 600
        }
      },
      {
        name: '跨年数据测试',
        dateInput: '2023.12.31 23:59',
        coinData: {
          symbol: 'DOT',
          name: 'Polkadot',
          otcIndex: 400
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
      console.log(`    年份: ${timeInfo.timestamp.getFullYear()}`);
      console.log(`    月份: ${timeInfo.timestamp.getMonth() + 1}`);
      console.log(`    日期: ${timeInfo.timestamp.getDate()}`);
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
      console.log(`  存储的年份: ${metric.timestamp.getFullYear()}`);
      console.log(`  ✅ 存储成功`);
    }

    // 验证不同年份的数据查询
    console.log('\n=== 验证年份数据查询 ===');
    
    // 查询2024年的数据
    const metrics2024 = await DailyMetric.findAll({
      include: [{
        model: Coin,
        as: 'coin',
        attributes: ['symbol', 'name']
      }],
      where: sequelize.where(
        sequelize.fn('strftime', '%Y', sequelize.col('timestamp')),
        '2024'
      ),
      order: [['timestamp', 'ASC']]
    });

    console.log(`找到 ${metrics2024.length} 条2024年的记录:`);
    metrics2024.forEach((metric, index) => {
      console.log(`  ${index + 1}. ${metric.coin.symbol}: ${metric.date} (${metric.timestamp.getFullYear()}年)`);
    });

    // 查询2025年的数据
    const metrics2025 = await DailyMetric.findAll({
      include: [{
        model: Coin,
        as: 'coin',
        attributes: ['symbol', 'name']
      }],
      where: sequelize.where(
        sequelize.fn('strftime', '%Y', sequelize.col('timestamp')),
        '2025'
      ),
      order: [['timestamp', 'ASC']]
    });

    console.log(`\n找到 ${metrics2025.length} 条2025年的记录:`);
    metrics2025.forEach((metric, index) => {
      console.log(`  ${index + 1}. ${metric.coin.symbol}: ${metric.date} (${metric.timestamp.getFullYear()}年)`);
    });

    console.log('\n=== 年份支持测试完成 ===');

  } catch (error) {
    console.error('测试过程中出现错误:', error);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  testYearSupport().then(() => {
    console.log('测试完成');
    process.exit(0);
  }).catch(error => {
    console.error('测试失败:', error);
    process.exit(1);
  });
}

module.exports = { testYearSupport };
