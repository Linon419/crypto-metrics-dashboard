// BTC回测脚本 V2 - 优化版
// 策略: 进场期第1天买入,持有到爆破破200卖出
const db = require('../models');
const { Coin, DailyMetric, sequelize } = db;
const { Op } = require('sequelize');

/**
 * 回测策略V2:
 * 1. 买入: 进场期第1天买入(entry_exit_day = 1)
 * 2. 卖出: 爆破指数第一次跌破200时卖出
 * 3. 谢林点: 当时的价格
 */
async function backtestBTCV2() {
  try {
    console.log('========== BTC回测V2开始 ==========\n');
    console.log('策略说明:');
    console.log('  买入: 进场期第1天');
    console.log('  卖出: 爆破指数第一次跌破200');
    console.log('  谢林点: 记录当时价格\n');

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
      order: [['date', 'ASC']],
      raw: true
    });

    console.log(`获取到${btcMetrics.length}条BTC数据记录`);
    console.log(`数据范围: ${btcMetrics[0]?.date} 至 ${btcMetrics[btcMetrics.length - 1]?.date}\n`);

    if (btcMetrics.length === 0) {
      console.error('错误: 没有找到BTC的历史数据');
      return;
    }

    // 3. 执行回测
    const trades = [];
    let position = null;
    let totalProfit = 0;
    let totalProfitPercent = 0;
    let winCount = 0;
    let lossCount = 0;

    for (let i = 0; i < btcMetrics.length; i++) {
      const metric = btcMetrics[i];

      // 买入逻辑: 进场期第1天
      if (!position && metric.entry_exit_type === 'entry' && metric.entry_exit_day === 1) {
        position = {
          buyDate: metric.date,
          buyPrice: metric.schelling_point,
          buyIndex: i,
          buyExplosion: metric.explosion_index,
          buyOtc: metric.otc_index,
          boughtInEntry: true // 标记在进场期内买入
        };
        console.log(`\n📈 买入信号 [${metric.date}]:`);
        console.log(`   价格(谢林点): ${metric.schelling_point}`);
        console.log(`   进场期第${metric.entry_exit_day}天`);
        console.log(`   爆破指数: ${metric.explosion_index}`);
        console.log(`   场外指数: ${metric.otc_index}`);
      }

      // 卖出逻辑: 有持仓 && 爆破指数第一次跌破200
      else if (position && position.boughtInEntry &&
               metric.explosion_index !== null && metric.explosion_index < 200) {
        const sellPrice = metric.schelling_point;
        const profit = sellPrice - position.buyPrice;
        const profitPercent = ((profit / position.buyPrice) * 100).toFixed(2);
        const holdDays = i - position.buyIndex;

        console.log(`\n📉 卖出信号 [${metric.date}]:`);
        console.log(`   价格(谢林点): ${sellPrice}`);
        console.log(`   爆破指数: ${metric.explosion_index}`);
        console.log(`   场外指数: ${metric.otc_index}`);
        console.log(`   持仓天数: ${holdDays}天`);
        console.log(`   盈亏: ${profit.toFixed(2)} (${profitPercent}%)`);

        const trade = {
          buyDate: position.buyDate,
          buyPrice: position.buyPrice,
          buyExplosion: position.buyExplosion,
          buyOtc: position.buyOtc,
          sellDate: metric.date,
          sellPrice: sellPrice,
          sellExplosion: metric.explosion_index,
          sellOtc: metric.otc_index,
          profit: profit,
          profitPercent: parseFloat(profitPercent),
          holdDays: holdDays,
          maxPriceInPeriod: 0,  // 稍后计算
          maxPriceDate: null
        };

        // 计算持仓期间的最高价格
        let maxPrice = position.buyPrice;
        let maxPriceDate = position.buyDate;
        for (let j = position.buyIndex; j <= i; j++) {
          if (btcMetrics[j].schelling_point > maxPrice) {
            maxPrice = btcMetrics[j].schelling_point;
            maxPriceDate = btcMetrics[j].date;
          }
        }
        trade.maxPriceInPeriod = maxPrice;
        trade.maxPriceDate = maxPriceDate;
        trade.maxProfit = maxPrice - position.buyPrice;
        trade.maxProfitPercent = ((trade.maxProfit / position.buyPrice) * 100).toFixed(2);

        trades.push(trade);

        totalProfit += profit;
        totalProfitPercent += parseFloat(profitPercent);
        if (profit > 0) winCount++;
        else lossCount++;

        position = null;
      }
    }

    // 如果最后还有持仓
    if (position) {
      const lastMetric = btcMetrics[btcMetrics.length - 1];
      const currentPrice = lastMetric.schelling_point;
      const unrealizedProfit = currentPrice - position.buyPrice;
      const unrealizedProfitPercent = ((unrealizedProfit / position.buyPrice) * 100).toFixed(2);
      const holdDays = btcMetrics.length - 1 - position.buyIndex;

      console.log(`\n⚠️  当前持仓未平仓:`);
      console.log(`   买入日期: ${position.buyDate}`);
      console.log(`   买入价格: ${position.buyPrice}`);
      console.log(`   当前日期: ${lastMetric.date}`);
      console.log(`   当前价格: ${currentPrice}`);
      console.log(`   持仓天数: ${holdDays}天`);
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

    // 计算理论最大收益(如果在最高点卖出)
    const totalMaxProfitPercent = trades.reduce((sum, t) => sum + parseFloat(t.maxProfitPercent), 0);
    console.log(`理论最大收益率: ${totalMaxProfitPercent.toFixed(2)}%`);
    console.log(`平均理论最大收益率: ${trades.length > 0 ? (totalMaxProfitPercent / trades.length).toFixed(2) : 0}%`);

    const avgHoldDays = trades.length > 0
      ? (trades.reduce((sum, t) => sum + t.holdDays, 0) / trades.length).toFixed(1)
      : 0;
    console.log(`\n平均持仓天数: ${avgHoldDays}天`);

    // 5. 详细交易记录
    if (trades.length > 0) {
      console.log('\n========== 详细交易记录 ==========\n');
      trades.forEach((trade, index) => {
        console.log(`交易 #${index + 1}:`);
        console.log(`  买入: ${trade.buyDate} @ $${trade.buyPrice.toFixed(0)}`);
        console.log(`        爆破${trade.buyExplosion} | 场外${trade.buyOtc}`);
        console.log(`  卖出: ${trade.sellDate} @ $${trade.sellPrice.toFixed(0)}`);
        console.log(`        爆破${trade.sellExplosion} | 场外${trade.sellOtc}`);
        console.log(`  实际收益: $${trade.profit.toFixed(0)} (${trade.profitPercent}%) | 持仓${trade.holdDays}天`);
        console.log(`  期间最高: ${trade.maxPriceDate} @ $${trade.maxPriceInPeriod.toFixed(0)}`);
        console.log(`  最大收益: $${trade.maxProfit.toFixed(0)} (${trade.maxProfitPercent}%)`);
        console.log('');
      });
    }

    // 6. 策略分析
    console.log('\n========== 策略分析 ==========\n');
    if (trades.length > 0) {
      // 计算实现的收益 vs 理论最大收益的比例
      const captureRatio = (totalProfitPercent / totalMaxProfitPercent * 100).toFixed(2);
      console.log(`收益捕获率: ${captureRatio}% (实际收益/理论最大收益)`);

      // 分析卖出时机
      const sellTooEarly = trades.filter(t => parseFloat(t.profitPercent) < parseFloat(t.maxProfitPercent) * 0.5).length;
      console.log(`过早卖出次数: ${sellTooEarly}次 (卖出时未达到理论最大收益的50%)`);
    }

    console.log('\n========== 回测结束 ==========\n');

  } catch (error) {
    console.error('回测过程中发生错误:', error);
    console.error(error.stack);
  } finally {
    await sequelize.close();
  }
}

backtestBTCV2();
