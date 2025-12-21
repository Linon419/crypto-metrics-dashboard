// 检查BTC数据的脚本
const db = require('../models');
const { Coin, DailyMetric, sequelize } = db;
const { Op } = require('sequelize');

async function checkBTCData() {
  try {
    console.log('========== 检查BTC数据 ==========\n');

    const btcCoin = await Coin.findOne({ where: { symbol: 'BTC' } });
    if (!btcCoin) {
      console.error('错误: 数据库中找不到BTC币种');
      return;
    }

    // 获取最近8个月的数据
    const eightMonthsAgo = new Date();
    eightMonthsAgo.setMonth(eightMonthsAgo.getMonth() - 8);
    const eightMonthsAgoStr = eightMonthsAgo.toISOString().split('T')[0];

    const btcMetrics = await DailyMetric.findAll({
      where: {
        coin_id: btcCoin.id,
        date: { [Op.gte]: eightMonthsAgoStr }
      },
      order: [['date', 'ASC']],
      raw: true
    });

    console.log(`总共${btcMetrics.length}条数据`);
    console.log(`日期范围: ${btcMetrics[0]?.date} 至 ${btcMetrics[btcMetrics.length - 1]?.date}\n`);

    // 检查period_quality字段
    const withQuality = btcMetrics.filter(m => m.period_quality);
    console.log(`有period_quality字段的数据: ${withQuality.length}条`);

    // 检查高质量进场的数据
    const highQuality = btcMetrics.filter(m => m.period_quality && m.period_quality.includes('高质量进场'));
    console.log(`包含"高质量进场"的数据: ${highQuality.length}条`);

    // 检查爆破指数<200的数据
    const explosion200 = btcMetrics.filter(m => m.explosion_index !== null && m.explosion_index < 200);
    console.log(`爆破指数<200的数据: ${explosion200.length}条\n`);

    // 显示最近10条数据的详细信息
    console.log('========== 最近10条数据详情 ==========\n');
    const recent10 = btcMetrics.slice(-10);
    recent10.forEach(m => {
      console.log(`日期: ${m.date}`);
      console.log(`  价格(谢林点): ${m.schelling_point}`);
      console.log(`  爆破指数: ${m.explosion_index}`);
      console.log(`  场外指数: ${m.otc_index}`);
      console.log(`  进退场类型: ${m.entry_exit_type}`);
      console.log(`  进退场天数: ${m.entry_exit_day}`);
      console.log(`  周期质量: ${m.period_quality || '(无)'}`);
      console.log('');
    });

    // 显示所有不同的period_quality值
    const uniqueQualities = [...new Set(btcMetrics.map(m => m.period_quality).filter(q => q))];
    console.log('========== 所有period_quality取值 ==========\n');
    uniqueQualities.forEach(q => {
      const count = btcMetrics.filter(m => m.period_quality === q).length;
      console.log(`"${q}": ${count}条`);
    });

  } catch (error) {
    console.error('检查数据时发生错误:', error);
    console.error(error.stack);
  } finally {
    await sequelize.close();
  }
}

checkBTCData();
