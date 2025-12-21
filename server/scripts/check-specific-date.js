// 检查特定日期的数据
const db = require('../models');
const { Coin, DailyMetric, sequelize } = db;
const { Op } = require('sequelize');

async function checkSpecificDate() {
  try {
    const btcCoin = await Coin.findOne({ where: { symbol: 'BTC' } });
    if (!btcCoin) {
      console.error('错误: 找不到BTC');
      return;
    }

    // 查询6.24前后的数据
    const metrics = await DailyMetric.findAll({
      where: {
        coin_id: btcCoin.id,
        date: {
          [Op.between]: ['2025-06-20', '2025-06-30']
        }
      },
      order: [['date', 'ASC']],
      raw: true
    });

    console.log('========== 6月20日-30日BTC数据 ==========\n');

    metrics.forEach(m => {
      const marker = m.date === '2025-06-24' || m.date === '2025-06-25' ? '👉 ' : '   ';
      console.log(`${marker}${m.date}:`);
      console.log(`   价格: $${m.schelling_point}`);
      console.log(`   爆破指数: ${m.explosion_index}`);
      console.log(`   场外指数: ${m.otc_index}`);
      console.log(`   状态: ${m.entry_exit_type} 第${m.entry_exit_day}天`);
      console.log('');
    });

    // 查找6.25之前最近的爆破跌破200节点
    const allMetrics = await DailyMetric.findAll({
      where: {
        coin_id: btcCoin.id,
        date: { [Op.lte]: '2025-06-25' }
      },
      order: [['date', 'DESC']],
      raw: true
    });

    console.log('\n========== 进场期质量分析 ==========\n');

    // 找到6.25（进场期第一天）
    const entry625 = metrics.find(m => m.date === '2025-06-25');
    if (!entry625) {
      console.log('未找到6.25数据');
      return;
    }

    console.log(`6.25 进场期第一天:`);
    console.log(`  场外指数: ${entry625.otc_index}`);
    console.log(`  爆破指数: ${entry625.explosion_index}`);

    // 查找之前的爆破跌破200节点
    let lastDip200 = null;
    for (let i = 0; i < allMetrics.length - 1; i++) {
      const curr = allMetrics[i];
      const next = allMetrics[i + 1];

      if (curr.date >= '2025-06-25') continue;

      if (curr.explosion_index >= 200 && next.explosion_index < 200) {
        lastDip200 = next;
        break;
      }
    }

    if (lastDip200) {
      const otcChange = entry625.otc_index - lastDip200.otc_index;
      const changePercent = (otcChange / lastDip200.otc_index) * 100;

      console.log(`\n上一次爆破跌破200节点: ${lastDip200.date}`);
      console.log(`  场外指数: ${lastDip200.otc_index}`);
      console.log(`\n质量评估:`);
      console.log(`  场外指数变化: ${otcChange.toFixed(0)} (${changePercent.toFixed(2)}%)`);

      let quality;
      if (Math.abs(changePercent) < 5) {
        quality = '低质量（持平）';
      } else if (otcChange > 0) {
        quality = '✅ 高质量（场外指数上升）';
      } else {
        quality = '❌ 低质量（场外指数下降）';
      }

      console.log(`  结论: ${quality}`);
    } else {
      console.log('\n未找到之前的爆破跌破200节点');
    }

    // 检查6.24
    const data624 = metrics.find(m => m.date === '2025-06-24');
    if (data624) {
      console.log(`\n========== 6.24数据 ==========`);
      console.log(`状态: ${data624.entry_exit_type} 第${data624.entry_exit_day}天`);
      console.log(`爆破指数: ${data624.explosion_index}`);
      console.log(`场外指数: ${data624.otc_index}`);

      if (data624.entry_exit_type !== 'entry' || data624.entry_exit_day !== 1) {
        console.log(`\n注意: 6.24不是进场期第一天`);
        console.log(`进场期第一天是: 6.25`);
      }
    }

  } catch (error) {
    console.error('错误:', error);
  } finally {
    await sequelize.close();
  }
}

checkSpecificDate();
