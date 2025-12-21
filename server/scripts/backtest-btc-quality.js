// BTC回测脚本 - 高质量进场期策略
// 策略: 高质量进场期第一天买入，爆破破200卖出
const db = require('../models');
const { Coin, DailyMetric, sequelize } = db;
const { Op } = require('sequelize');

/**
 * 判断是否为高质量进场期（根据bodong文档第五章）
 * @param {Object} metric - 当前数据
 * @param {Array} historicalData - 历史数据（按日期升序）
 * @param {number} currentIndex - 当前数据在历史数组中的索引
 * @returns {boolean} - 是否为高质量进场期
 */
function isHighQualityEntryPeriod(metric, historicalData, currentIndex) {
  // 必须是进场期第一天
  if (metric.entry_exit_type !== 'entry' || metric.entry_exit_day !== 1) {
    return false;
  }

  const entryStartDate = new Date(metric.date);
  const entryStartOtcIndex = metric.otc_index;

  // 查找进场期第一天之前最近的一次"爆破跌破200"的节点
  let lastDipBelow200 = null;

  // 从当前位置往前查找
  for (let i = currentIndex - 1; i >= 0; i--) {
    const prevMetric = historicalData[i];
    const nextMetric = historicalData[i + 1];

    // 检查是否是爆破从>=200跌到<200的节点
    if (prevMetric.explosion_index >= 200 && nextMetric.explosion_index < 200) {
      lastDipBelow200 = nextMetric;
      break;
    }
  }

  // 如果找不到之前的爆破跌破200节点，返回false（数据不足）
  if (!lastDipBelow200) {
    console.log(`  [质量判断] ${metric.date}: 找不到之前的爆破跌破200节点，无法判断质量`);
    return false;
  }

  const node2OtcIndex = lastDipBelow200.otc_index;
  const node3OtcIndex = entryStartOtcIndex;

  // 计算场外指数变化
  const otcIndexChange = node3OtcIndex - node2OtcIndex;
  const changePercent = (otcIndexChange / node2OtcIndex) * 100;

  console.log(`  [质量判断] ${metric.date}:`);
  console.log(`    上次爆破跌破200: ${lastDipBelow200.date}, 场外指数: ${node2OtcIndex}`);
  console.log(`    进场期第一天: ${metric.date}, 场外指数: ${node3OtcIndex}`);
  console.log(`    场外指数变化: ${otcIndexChange.toFixed(0)} (${changePercent.toFixed(2)}%)`);

  // 根据bodong文档第五章的判断标准：
  // 1. 如果场外指数变化 < ±5%，认为持平 -> 低质量
  if (Math.abs(changePercent) < 5) {
    console.log(`    结论: 低质量进场（场外指数近乎持平）`);
    return false;
  }
  // 2. 如果场外指数上升 -> 高质量
  else if (otcIndexChange > 0) {
    console.log(`    结论: ✅ 高质量进场（场外指数上升）`);
    return true;
  }
  // 3. 如果场外指数下降 -> 低质量
  else {
    console.log(`    结论: 低质量进场（场外指数下降）`);
    return false;
  }
}

/**
 * 回测策略:
 * 买入: 高质量进场期第一天
 * 卖出: 爆破指数跌破200
 */
async function backtestBTCQuality() {
  try {
    console.log('========== BTC高质量进场期策略回测 ==========\n');
    console.log('策略说明:');
    console.log('  买入: 高质量进场期第一天');
    console.log('       (场外指数比上次爆破跌破200时上升)');
    console.log('  卖出: 爆破指数跌破200');
    console.log('  依据: bodong文档第五章 - 进场期质量评估\n');

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

    if (btcMetrics.length === 0) {
      console.error('错误: 没有找到BTC的历史数据');
      return;
    }

    // 2. 执行回测
    const trades = [];
    let position = null;
    let totalProfit = 0;
    let totalProfitPercent = 0;
    let winCount = 0;
    let lossCount = 0;
    let entrySignalCount = 0; // 统计进场期第一天的总次数
    let highQualityCount = 0;  // 统计高质量进场的次数

    for (let i = 0; i < btcMetrics.length; i++) {
      const metric = btcMetrics[i];

      // === 买入逻辑 ===
      if (!position) {
        // 统计所有进场期第一天
        if (metric.entry_exit_type === 'entry' && metric.entry_exit_day === 1) {
          entrySignalCount++;
        }

        // 判断是否为高质量进场期第一天
        if (isHighQualityEntryPeriod(metric, btcMetrics, i)) {
          highQualityCount++;
          position = {
            buyDate: metric.date,
            buyPrice: metric.schelling_point,
            buyIndex: i,
            buyExplosion: metric.explosion_index,
            buyOtc: metric.otc_index
          };

          console.log(`\n📈 买入信号 [${metric.date}] - 高质量进场期第1天:`);
          console.log(`   价格: $${metric.schelling_point.toFixed(0)}`);
          console.log(`   爆破指数: ${metric.explosion_index}`);
          console.log(`   场外指数: ${metric.otc_index}`);
        }
      }

      // === 卖出逻辑 ===
      // 爆破破200时卖出
      else if (position && metric.explosion_index < 200) {
        const sellPrice = metric.schelling_point;
        const profit = sellPrice - position.buyPrice;
        const profitPercent = ((profit / position.buyPrice) * 100).toFixed(2);
        const holdDays = i - position.buyIndex;

        console.log(`\n📉 卖出信号 [${metric.date}] - 爆破破200:`);
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
      console.log(`   买入: ${position.buyDate} @ $${position.buyPrice.toFixed(0)}`);
      console.log(`   当前: ${lastMetric.date} @ $${currentPrice.toFixed(0)}`);
      console.log(`   持仓: ${holdDays}天`);
      console.log(`   浮盈: $${unrealizedProfit.toFixed(0)} (${unrealizedProfitPercent}%)`);
      console.log(`   爆破指数: ${lastMetric.explosion_index}`);
    }

    // 3. 输出回测结果
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
        console.log(`  买入: ${trade.buyDate} @ $${trade.buyPrice.toFixed(0)} [高质量进场期第1天]`);
        console.log(`        爆破${trade.buyExplosion} | 场外${trade.buyOtc}`);
        console.log(`  卖出: ${trade.sellDate} @ $${trade.sellPrice.toFixed(0)} [爆破破200]`);
        console.log(`        爆破${trade.sellExplosion} | 场外${trade.sellOtc}`);
        console.log(`  实际: $${trade.profit.toFixed(0)} (${trade.profitPercent}%) | ${trade.holdDays}天`);
        console.log(`  最高: ${trade.maxPriceDate} @ $${trade.maxPriceInPeriod.toFixed(0)} (${trade.maxProfitPercent}%)`);
        console.log('');
      });
    }

    // 5. 策略对比
    console.log('========== 策略对比分析 ==========\n');
    console.log('如果在所有进场期第一天都买入（不筛选质量）:');
    console.log(`  会有 ${entrySignalCount} 次交易机会`);
    console.log('\n通过筛选高质量进场期:');
    console.log(`  实际交易 ${highQualityCount} 次`);
    console.log(`  过滤掉 ${entrySignalCount - highQualityCount} 次低质量机会`);
    console.log(`  提高了交易的成功率和风险控制`);

    console.log('\n========== 回测结束 ==========\n');

  } catch (error) {
    console.error('回测过程中发生错误:', error);
    console.error(error.stack);
  } finally {
    await sequelize.close();
  }
}

backtestBTCQuality();
