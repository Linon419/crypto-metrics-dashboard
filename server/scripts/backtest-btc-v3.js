// BTC回测脚本 V3 - 根据bodong文档优化
// 策略: 爆破从负转正时买入,进场期内爆破破200时卖出
const db = require('../models');
const { Coin, DailyMetric, sequelize } = db;
const { Op } = require('sequelize');

/**
 * 回测策略V3 (根据bodong文档第九章核心策略):
 *
 * 买入时机:
 * 1. 爆破指数从负数转为正数(做多信号)
 * 2. 或进场期第1天(进场期开始)
 *
 * 卖出时机:
 * 1. 进场期内爆破指数第一次跌破200(阶段高点)
 *
 * 根据bodong文档:
 * - "每次爆破转正和进场开始都是抄底和加仓的好时机"
 * - "爆破指数跌回200以下,都一定是阶段的行情高点"
 */
async function backtestBTCV3() {
  try {
    console.log('========== BTC回测V3开始 ==========\n');
    console.log('策略说明(根据bodong文档):');
    console.log('  买入: 1)爆破从负转正 或 2)进场期第1天');
    console.log('  卖出: 进场期内爆破第一次破200');
    console.log('  依据: "每次爆破转正和进场开始都是抄底好时机"');
    console.log('       "爆破跌回200都是阶段行情高点"\n');

    // 1. 获取BTC数据
    const btcCoin = await Coin.findOne({ where: { symbol: 'BTC' } });
    if (!btcCoin) {
      console.error('错误: 数据库中找不到BTC币种');
      return;
    }

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

    console.log(`获取到${btcMetrics.length}条BTC数据记录`);
    console.log(`数据范围: ${btcMetrics[0]?.date} 至 ${btcMetrics[btcMetrics.length - 1]?.date}\n`);

    // 2. 执行回测
    const trades = [];
    let position = null;
    let totalProfit = 0;
    let totalProfitPercent = 0;
    let winCount = 0;
    let lossCount = 0;

    for (let i = 1; i < btcMetrics.length; i++) {
      const metric = btcMetrics[i];
      const prevMetric = btcMetrics[i - 1];

      // === 买入逻辑 ===
      if (!position) {
        let buySignal = null;

        // 信号1: 爆破指数从负转正
        if (prevMetric.explosion_index < 0 && metric.explosion_index >= 0) {
          buySignal = '爆破从负转正';
        }
        // 信号2: 进场期第1天
        else if (metric.entry_exit_type === 'entry' && metric.entry_exit_day === 1) {
          buySignal = '进场期第1天';
        }

        if (buySignal) {
          position = {
            buyDate: metric.date,
            buyPrice: metric.schelling_point,
            buyIndex: i,
            buyExplosion: metric.explosion_index,
            buyOtc: metric.otc_index,
            buySignal: buySignal,
            entryType: metric.entry_exit_type,
            entryDay: metric.entry_exit_day
          };
          console.log(`\n📈 买入信号 [${metric.date}] - ${buySignal}:`);
          console.log(`   价格: $${metric.schelling_point.toFixed(0)}`);
          console.log(`   爆破指数: ${metric.explosion_index}`);
          console.log(`   场外指数: ${metric.otc_index}`);
          console.log(`   状态: ${metric.entry_exit_type} 第${metric.entry_exit_day}天`);
        }
      }

      // === 卖出逻辑 ===
      // 只在进场期内,爆破破200时卖出
      else if (position &&
               metric.entry_exit_type === 'entry' &&  // 确保在进场期
               metric.explosion_index < 200) {         // 爆破破200

        const sellPrice = metric.schelling_point;
        const profit = sellPrice - position.buyPrice;
        const profitPercent = ((profit / position.buyPrice) * 100).toFixed(2);
        const holdDays = i - position.buyIndex;

        console.log(`\n📉 卖出信号 [${metric.date}] - 进场期爆破破200:`);
        console.log(`   价格: $${sellPrice.toFixed(0)}`);
        console.log(`   爆破指数: ${metric.explosion_index}`);
        console.log(`   场外指数: ${metric.otc_index}`);
        console.log(`   持仓天数: ${holdDays}天`);
        console.log(`   盈亏: $${profit.toFixed(0)} (${profitPercent}%)`);

        // 计算持仓期间的最高价格
        let maxPrice = position.buyPrice;
        let maxPriceDate = position.buyDate;
        for (let j = position.buyIndex; j <= i; j++) {
          if (btcMetrics[j].schelling_point > maxPrice) {
            maxPrice = btcMetrics[j].schelling_point;
            maxPriceDate = btcMetrics[j].date;
          }
        }

        const trade = {
          buyDate: position.buyDate,
          buyPrice: position.buyPrice,
          buySignal: position.buySignal,
          buyExplosion: position.buyExplosion,
          buyOtc: position.buyOtc,
          sellDate: metric.date,
          sellPrice: sellPrice,
          sellExplosion: metric.explosion_index,
          sellOtc: metric.otc_index,
          profit: profit,
          profitPercent: parseFloat(profitPercent),
          holdDays: holdDays,
          maxPriceInPeriod: maxPrice,
          maxPriceDate: maxPriceDate,
          maxProfit: maxPrice - position.buyPrice,
          maxProfitPercent: parseFloat(((maxPrice - position.buyPrice) / position.buyPrice * 100).toFixed(2))
        };

        trades.push(trade);

        totalProfit += profit;
        totalProfitPercent += parseFloat(profitPercent);
        if (profit > 0) winCount++;
        else lossCount++;

        position = null;
      }
    }

    // 处理未平仓
    if (position) {
      const lastMetric = btcMetrics[btcMetrics.length - 1];
      const currentPrice = lastMetric.schelling_point;
      const unrealizedProfit = currentPrice - position.buyPrice;
      const unrealizedProfitPercent = ((unrealizedProfit / position.buyPrice) * 100).toFixed(2);
      const holdDays = btcMetrics.length - 1 - position.buyIndex;

      console.log(`\n⚠️  当前持仓未平仓:`);
      console.log(`   买入信号: ${position.buySignal}`);
      console.log(`   买入: ${position.buyDate} @ $${position.buyPrice.toFixed(0)}`);
      console.log(`   当前: ${lastMetric.date} @ $${currentPrice.toFixed(0)}`);
      console.log(`   持仓: ${holdDays}天`);
      console.log(`   浮盈: $${unrealizedProfit.toFixed(0)} (${unrealizedProfitPercent}%)`);
      console.log(`   状态: ${lastMetric.entry_exit_type} 第${lastMetric.entry_exit_day}天`);
    }

    // 3. 输出回测结果
    console.log('\n========== 回测结果汇总 ==========\n');
    console.log(`总交易次数: ${trades.length}次`);
    console.log(`盈利次数: ${winCount}次`);
    console.log(`亏损次数: ${lossCount}次`);
    console.log(`胜率: ${trades.length > 0 ? ((winCount / trades.length) * 100).toFixed(2) : 0}%`);

    console.log(`\n累计收益率: ${totalProfitPercent.toFixed(2)}%`);
    console.log(`平均每次收益率: ${trades.length > 0 ? (totalProfitPercent / trades.length).toFixed(2) : 0}%`);

    if (trades.length > 0) {
      const totalMaxProfitPercent = trades.reduce((sum, t) => sum + t.maxProfitPercent, 0);
      console.log(`理论最大收益率: ${totalMaxProfitPercent.toFixed(2)}%`);
      console.log(`收益捕获率: ${(totalProfitPercent / totalMaxProfitPercent * 100).toFixed(2)}%`);
    }

    const avgHoldDays = trades.length > 0
      ? (trades.reduce((sum, t) => sum + t.holdDays, 0) / trades.length).toFixed(1)
      : 0;
    console.log(`\n平均持仓天数: ${avgHoldDays}天`);

    // 4. 详细交易记录
    if (trades.length > 0) {
      console.log('\n========== 详细交易记录 ==========\n');
      trades.forEach((trade, index) => {
        const profitEmoji = trade.profit > 0 ? '✅' : '❌';
        console.log(`${profitEmoji} 交易 #${index + 1}:`);
        console.log(`  买入: ${trade.buyDate} @ $${trade.buyPrice.toFixed(0)} [${trade.buySignal}]`);
        console.log(`        爆破${trade.buyExplosion} | 场外${trade.buyOtc}`);
        console.log(`  卖出: ${trade.sellDate} @ $${trade.sellPrice.toFixed(0)} [爆破破200]`);
        console.log(`        爆破${trade.sellExplosion} | 场外${trade.sellOtc}`);
        console.log(`  实际: $${trade.profit.toFixed(0)} (${trade.profitPercent}%) | ${trade.holdDays}天`);
        console.log(`  最高: ${trade.maxPriceDate} @ $${trade.maxPriceInPeriod.toFixed(0)} (${trade.maxProfitPercent}%)`);
        console.log('');
      });
    }

    // 5. 策略分析
    console.log('========== 策略分析 ==========\n');

    // 按买入信号分类统计
    const signalStats = {};
    trades.forEach(trade => {
      if (!signalStats[trade.buySignal]) {
        signalStats[trade.buySignal] = { count: 0, totalProfit: 0, wins: 0 };
      }
      signalStats[trade.buySignal].count++;
      signalStats[trade.buySignal].totalProfit += trade.profitPercent;
      if (trade.profit > 0) signalStats[trade.buySignal].wins++;
    });

    console.log('按买入信号分类:');
    Object.keys(signalStats).forEach(signal => {
      const stats = signalStats[signal];
      const avgProfit = (stats.totalProfit / stats.count).toFixed(2);
      const winRate = ((stats.wins / stats.count) * 100).toFixed(2);
      console.log(`  ${signal}:`);
      console.log(`    交易次数: ${stats.count}, 胜率: ${winRate}%, 平均收益: ${avgProfit}%`);
    });

    console.log('\n========== 回测结束 ==========\n');

  } catch (error) {
    console.error('回测过程中发生错误:', error);
    console.error(error.stack);
  } finally {
    await sequelize.close();
  }
}

backtestBTCV3();
