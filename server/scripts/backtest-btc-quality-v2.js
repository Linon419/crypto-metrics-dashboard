// BTC回测脚本 - 高质量进场期策略 V2（优化版）
// 策略: 高质量进场期买入，进场期内爆破第一次破200卖出
const db = require('../models');
const { Coin, DailyMetric, sequelize } = db;
const { Op } = require('sequelize');

/**
 * 判断是否为高质量进场期（根据bodong文档第五章）
 */
function isHighQualityEntryPeriod(metric, historicalData, currentIndex) {
  if (metric.entry_exit_type !== 'entry' || metric.entry_exit_day !== 1) {
    return false;
  }

  const entryStartOtcIndex = metric.otc_index;
  let lastDipBelow200 = null;

  // 从当前位置往前查找最近的爆破跌破200节点
  for (let i = currentIndex - 1; i >= 0; i--) {
    const prevMetric = historicalData[i];
    const nextMetric = historicalData[i + 1];

    if (prevMetric.explosion_index >= 200 && nextMetric.explosion_index < 200) {
      lastDipBelow200 = nextMetric;
      break;
    }
  }

  if (!lastDipBelow200) {
    console.log(`  [质量判断] ${metric.date}: 找不到之前的爆破跌破200节点`);
    return false;
  }

  const node2OtcIndex = lastDipBelow200.otc_index;
  const node3OtcIndex = entryStartOtcIndex;
  const otcIndexChange = node3OtcIndex - node2OtcIndex;
  const changePercent = (otcIndexChange / node2OtcIndex) * 100;

  console.log(`  [质量判断] ${metric.date}:`);
  console.log(`    上次爆破跌破200: ${lastDipBelow200.date}, 场外${node2OtcIndex}`);
  console.log(`    进场期第一天: ${metric.date}, 场外${node3OtcIndex}`);
  console.log(`    变化: ${otcIndexChange.toFixed(0)} (${changePercent.toFixed(2)}%)`);

  // 判断标准
  if (Math.abs(changePercent) < 5) {
    console.log(`    结论: 低质量（持平）`);
    return false;
  } else if (otcIndexChange > 0) {
    console.log(`    结论: ✅ 高质量（上升）`);
    return true;
  } else {
    console.log(`    结论: 低质量（下降）`);
    return false;
  }
}

/**
 * 回测策略V2:
 * 买入: 高质量进场期第一天（无论爆破指数多少）
 * 卖出: 进场期内，爆破第一次从>=200跌破200时
 *      （如果买入时爆破就<200，则等待爆破先升到>=200再跌破200）
 */
async function backtestBTCQualityV2() {
  try {
    console.log('========== BTC高质量进场期策略回测 V2 ==========\n');
    console.log('策略说明:');
    console.log('  买入: 高质量进场期第一天');
    console.log('  卖出: 进场期内爆破第一次跌破200');
    console.log('       (如果买入时爆破<200，等爆破先>=200再破200时卖出)');
    console.log('  谢林点: 当时价格\n');

    // 获取数据
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

    // 执行回测
    const trades = [];
    let position = null;
    let hasSeenExplosion200 = false; // 标记是否见过爆破>=200
    let totalProfit = 0;
    let totalProfitPercent = 0;
    let winCount = 0;
    let lossCount = 0;
    let entrySignalCount = 0;
    let highQualityCount = 0;

    for (let i = 0; i < btcMetrics.length; i++) {
      const metric = btcMetrics[i];

      // === 买入逻辑 ===
      if (!position) {
        if (metric.entry_exit_type === 'entry' && metric.entry_exit_day === 1) {
          entrySignalCount++;
        }

        if (isHighQualityEntryPeriod(metric, btcMetrics, i)) {
          highQualityCount++;

          // 检查买入时爆破是否>=200
          hasSeenExplosion200 = metric.explosion_index >= 200;

          position = {
            buyDate: metric.date,
            buyPrice: metric.schelling_point,
            buyIndex: i,
            buyExplosion: metric.explosion_index,
            buyOtc: metric.otc_index,
            waitingForExplosion200: !hasSeenExplosion200 // 如果买入时<200，需要等待
          };

          console.log(`\n📈 买入信号 [${metric.date}] - 高质量进场期第1天:`);
          console.log(`   价格: $${metric.schelling_point.toFixed(0)}`);
          console.log(`   爆破: ${metric.explosion_index}`);
          console.log(`   场外: ${metric.otc_index}`);
          if (position.waitingForExplosion200) {
            console.log(`   ⚠️  买入时爆破<200，等待爆破先升到>=200`);
          }
        }
      }

      // === 卖出逻辑 ===
      else if (position && metric.entry_exit_type === 'entry') { // 确保在进场期内
        // 如果还在等待爆破升到200
        if (position.waitingForExplosion200) {
          if (metric.explosion_index >= 200) {
            hasSeenExplosion200 = true;
            position.waitingForExplosion200 = false;
            console.log(`   ✓ ${metric.date}: 爆破升到${metric.explosion_index}>=200，开始等待卖出信号`);
          }
        }

        // 如果已经见过爆破>=200，现在跌破200，则卖出
        if (hasSeenExplosion200 && metric.explosion_index < 200) {
          const sellPrice = metric.schelling_point;
          const profit = sellPrice - position.buyPrice;
          const profitPercent = ((profit / position.buyPrice) * 100).toFixed(2);
          const holdDays = i - position.buyIndex;

          console.log(`\n📉 卖出信号 [${metric.date}] - 爆破破200:`);
          console.log(`   价格: $${sellPrice.toFixed(0)}`);
          console.log(`   爆破: ${metric.explosion_index}`);
          console.log(`   场外: ${metric.otc_index}`);
          console.log(`   持仓: ${holdDays}天`);
          console.log(`   盈亏: $${profit.toFixed(0)} (${profitPercent}%)`);

          // 计算最高价
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
          hasSeenExplosion200 = false;
        }
      }

      // 如果退出进场期，强制平仓
      else if (position && metric.entry_exit_type !== 'entry') {
        console.log(`\n⚠️  ${metric.date}: 退出进场期，强制平仓`);
        const sellPrice = metric.schelling_point;
        const profit = sellPrice - position.buyPrice;
        const profitPercent = ((profit / position.buyPrice) * 100).toFixed(2);
        const holdDays = i - position.buyIndex;

        console.log(`   价格: $${sellPrice.toFixed(0)}`);
        console.log(`   盈亏: $${profit.toFixed(0)} (${profitPercent}%)`);

        // 记录但不加入正式交易统计（因为不是按策略卖出的）
        position = null;
        hasSeenExplosion200 = false;
      }
    }

    // 未平仓处理
    if (position) {
      const lastMetric = btcMetrics[btcMetrics.length - 1];
      const currentPrice = lastMetric.schelling_point;
      const unrealizedProfit = currentPrice - position.buyPrice;
      const unrealizedProfitPercent = ((unrealizedProfit / position.buyPrice) * 100).toFixed(2);
      const holdDays = btcMetrics.length - 1 - position.buyIndex;

      console.log(`\n⚠️  当前持仓未平仓:`);
      console.log(`   买入: ${position.buyDate} @ $${position.buyPrice.toFixed(0)}`);
      console.log(`   当前: ${lastMetric.date} @ $${currentPrice.toFixed(0)}`);
      console.log(`   持仓: ${holdDays}天`);
      console.log(`   浮盈: $${unrealizedProfit.toFixed(0)} (${unrealizedProfitPercent}%)`);
      if (position.waitingForExplosion200) {
        console.log(`   状态: 等待爆破升到>=200`);
      }
    }

    // 输出结果
    console.log('\n========== 回测结果汇总 ==========\n');
    console.log(`进场期第一天总次数: ${entrySignalCount}次`);
    console.log(`高质量进场次数: ${highQualityCount}次`);
    console.log(`高质量占比: ${entrySignalCount > 0 ? ((highQualityCount / entrySignalCount) * 100).toFixed(2) : 0}%\n`);

    console.log(`完成交易次数: ${trades.length}次`);
    console.log(`盈利次数: ${winCount}次`);
    console.log(`亏损次数: ${lossCount}次`);
    console.log(`胜率: ${trades.length > 0 ? ((winCount / trades.length) * 100).toFixed(2) : 0}%`);

    console.log(`\n累计收益率: ${totalProfitPercent.toFixed(2)}%`);
    console.log(`平均每次收益率: ${trades.length > 0 ? (totalProfitPercent / trades.length).toFixed(2) : 0}%`);

    if (trades.length > 0) {
      const totalMaxProfitPercent = trades.reduce((sum, t) => sum + t.maxProfitPercent, 0);
      console.log(`理论最大收益率: ${totalMaxProfitPercent.toFixed(2)}%`);
      console.log(`收益捕获率: ${(totalProfitPercent / totalMaxProfitPercent * 100).toFixed(2)}%`);

      const avgHoldDays = (trades.reduce((sum, t) => sum + t.holdDays, 0) / trades.length).toFixed(1);
      console.log(`\n平均持仓天数: ${avgHoldDays}天`);

      // 详细交易记录
      console.log('\n========== 详细交易记录 ==========\n');
      trades.forEach((trade, index) => {
        const profitEmoji = trade.profit > 0 ? '✅' : '❌';
        console.log(`${profitEmoji} 交易 #${index + 1}:`);
        console.log(`  买入: ${trade.buyDate} @ $${trade.buyPrice.toFixed(0)}`);
        console.log(`        爆破${trade.buyExplosion} | 场外${trade.buyOtc}`);
        console.log(`  卖出: ${trade.sellDate} @ $${trade.sellPrice.toFixed(0)}`);
        console.log(`        爆破${trade.sellExplosion} | 场外${trade.sellOtc}`);
        console.log(`  实际: $${trade.profit.toFixed(0)} (${trade.profitPercent}%) | ${trade.holdDays}天`);
        console.log(`  最高: ${trade.maxPriceDate} @ $${trade.maxPriceInPeriod.toFixed(0)} (${trade.maxProfitPercent}%)`);
        console.log('');
      });
    }

    console.log('\n========== 回测结束 ==========\n');

  } catch (error) {
    console.error('回测错误:', error);
    console.error(error.stack);
  } finally {
    await sequelize.close();
  }
}

backtestBTCQualityV2();
