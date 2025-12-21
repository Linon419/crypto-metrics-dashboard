// BTC回测脚本 - 高质量进场期买入，爆破破200卖出策略
const db = require('../models');
const { Coin, DailyMetric, sequelize } = db;
const { Op } = require('sequelize');

/**
 * 判断是否为高质量进场期前期
 * 根据bodong文档的逻辑:
 * - 进场期第一天(entry_exit_type = 'entry' && entry_exit_day = 1)
 * - 或者进场期前几天(entry_exit_day <= 5)且爆破指数>=200
 */
function isHighQualityEntryPeriod(metric, previousMetrics) {
  // 必须是进场期
  if (metric.entry_exit_type !== 'entry') return false;

  // 进场期第1-5天,且爆破指数>=200(还未跌破)
  if (metric.entry_exit_day >= 1 && metric.entry_exit_day <= 5 && metric.explosion_index >= 200) {
    return true;
  }

  return false;
}

/**
 * 回测策略:
 * 1. 买入: 在进场期前期买入(entry_exit_type='entry', day<=5, explosion_index>=200)
 * 2. 卖出: 爆破指数跌破200时卖出(explosion_index < 200)
 * 3. 谢林点: 当时的价格(schelling_point)
 */
async function backtestBTC() {
  try {
    console.log('========== BTC回测开始 ==========\n');
    console.log('策略说明:');
    console.log('  买入: 进场期前期(第1-5天)且爆破指数>=200');
    console.log('  卖出: 爆破指数跌破200');
    console.log('  谢林点: 当时的价格\n');

    // 1. 获取BTC的coin_id
    const btcCoin = await Coin.findOne({ where: { symbol: 'BTC' } });
    if (!btcCoin) {
      console.error('错误: 数据库中找不到BTC币种');
      return;
    }
    console.log(`找到BTC币种, ID: ${btcCoin.id}\n`);

    // 2. 获取最近8个月的BTC数据
    const eightMonthsAgo = new Date();
    eightMonthsAgo.setMonth(eightMonthsAgo.getMonth() - 8);
    const eightMonthsAgoStr = eightMonthsAgo.toISOString().split('T')[0];

    const btcMetrics = await DailyMetric.findAll({
      where: {
        coin_id: btcCoin.id,
        date: { [Op.gte]: eightMonthsAgoStr }
      },
      order: [['date', 'ASC']], // 按日期升序排列
      raw: true
    });

    console.log(`获取到${btcMetrics.length}条BTC数据记录`);
    console.log(`数据范围: ${btcMetrics[0]?.date} 至 ${btcMetrics[btcMetrics.length - 1]?.date}\n`);

    if (btcMetrics.length === 0) {
      console.error('错误: 没有找到BTC的历史数据');
      return;
    }

    // 3. 执行回测
    const trades = []; // 记录所有交易
    let position = null; // 当前持仓 {buyDate, buyPrice, buyIndex}
    let totalProfit = 0;
    let totalProfitPercent = 0;
    let winCount = 0;
    let lossCount = 0;

    for (let i = 0; i < btcMetrics.length; i++) {
      const metric = btcMetrics[i];
      const previousMetrics = btcMetrics.slice(Math.max(0, i - 30), i); // 前30天数据

      // 买入逻辑: 没有持仓 && 进入高质量进场期前期
      if (!position && isHighQualityEntryPeriod(metric, previousMetrics)) {
        position = {
          buyDate: metric.date,
          buyPrice: metric.schelling_point,
          buyIndex: i,
          buyExplosion: metric.explosion_index,
          buyOtc: metric.otc_index,
          buyEntryDay: metric.entry_exit_day
        };
        console.log(`\n📈 买入信号 [${metric.date}]:`);
        console.log(`   价格(谢林点): ${metric.schelling_point}`);
        console.log(`   进场期第${metric.entry_exit_day}天`);
        console.log(`   爆破指数: ${metric.explosion_index}`);
        console.log(`   场外指数: ${metric.otc_index}`);
      }

      // 卖出逻辑: 有持仓 && 爆破指数跌破200
      else if (position && metric.explosion_index !== null && metric.explosion_index < 200) {
        const sellPrice = metric.schelling_point;
        const profit = sellPrice - position.buyPrice;
        const profitPercent = ((profit / position.buyPrice) * 100).toFixed(2);
        const holdDays = i - position.buyIndex;

        console.log(`\n📉 卖出信号 [${metric.date}]:`);
        console.log(`   价格(谢林点): ${sellPrice}`);
        console.log(`   爆破指数: ${metric.explosion_index}`);
        console.log(`   持仓天数: ${holdDays}天`);
        console.log(`   盈亏: ${profit.toFixed(2)} (${profitPercent}%)`);

        // 记录交易
        const trade = {
          buyDate: position.buyDate,
          buyPrice: position.buyPrice,
          buyEntryDay: position.buyEntryDay,
          buyExplosion: position.buyExplosion,
          buyOtc: position.buyOtc,
          sellDate: metric.date,
          sellPrice: sellPrice,
          sellExplosion: metric.explosion_index,
          profit: profit,
          profitPercent: parseFloat(profitPercent),
          holdDays: holdDays
        };
        trades.push(trade);

        totalProfit += profit;
        totalProfitPercent += parseFloat(profitPercent);
        if (profit > 0) winCount++;
        else lossCount++;

        // 清空持仓
        position = null;
      }
    }

    // 如果最后还有持仓未平仓
    if (position) {
      const lastMetric = btcMetrics[btcMetrics.length - 1];
      const currentPrice = lastMetric.schelling_point;
      const unrealizedProfit = currentPrice - position.buyPrice;
      const unrealizedProfitPercent = ((unrealizedProfit / position.buyPrice) * 100).toFixed(2);

      console.log(`\n⚠️  当前持仓未平仓:`);
      console.log(`   买入日期: ${position.buyDate}`);
      console.log(`   买入价格: ${position.buyPrice}`);
      console.log(`   当前价格: ${currentPrice}`);
      console.log(`   浮动盈亏: ${unrealizedProfit.toFixed(2)} (${unrealizedProfitPercent}%)`);
    }

    // 4. 输出回测结果
    console.log('\n========== 回测结果汇总 ==========\n');
    console.log(`总交易次数: ${trades.length}次`);
    console.log(`盈利次数: ${winCount}次`);
    console.log(`亏损次数: ${lossCount}次`);
    console.log(`胜率: ${trades.length > 0 ? ((winCount / trades.length) * 100).toFixed(2) : 0}%`);
    console.log(`\n累计收益率: ${totalProfitPercent.toFixed(2)}%`);
    console.log(`平均每次收益率: ${trades.length > 0 ? (totalProfitPercent / trades.length).toFixed(2) : 0}%`);

    const avgHoldDays = trades.length > 0
      ? (trades.reduce((sum, t) => sum + t.holdDays, 0) / trades.length).toFixed(1)
      : 0;
    console.log(`平均持仓天数: ${avgHoldDays}天`);

    // 5. 详细交易记录
    if (trades.length > 0) {
      console.log('\n========== 详细交易记录 ==========\n');
      trades.forEach((trade, index) => {
        console.log(`交易 #${index + 1}:`);
        console.log(`  买入: ${trade.buyDate} @ ${trade.buyPrice.toFixed(2)}`);
        console.log(`        进场期第${trade.buyEntryDay}天 | 爆破${trade.buyExplosion} | 场外${trade.buyOtc}`);
        console.log(`  卖出: ${trade.sellDate} @ ${trade.sellPrice.toFixed(2)}`);
        console.log(`        爆破跌破200: ${trade.sellExplosion}`);
        console.log(`  收益: ${trade.profit.toFixed(2)} (${trade.profitPercent}%) | 持仓${trade.holdDays}天`);
        console.log('');
      });
    }

    console.log('========== 回测结束 ==========\n');

  } catch (error) {
    console.error('回测过程中发生错误:', error);
    console.error(error.stack);
  } finally {
    // 关闭数据库连接
    await sequelize.close();
  }
}

// 运行回测
backtestBTC();
