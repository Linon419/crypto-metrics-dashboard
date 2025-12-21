// BTC回测脚本 - 动态质量评估策略
// 策略: 高质量进场期买入，动态评估爆破破200节点质量决定是否卖出
const db = require('../models');
const { Coin, DailyMetric, sequelize } = db;
const { Op } = require('sequelize');

/**
 * 判断进场期第一天是否为高质量
 */
function isHighQualityEntryStart(metric, historicalData, currentIndex) {
  if (metric.entry_exit_type !== 'entry' || metric.entry_exit_day !== 1) {
    return { isHighQuality: false, reason: '不是进场期第一天' };
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
    return { isHighQuality: false, reason: '找不到之前的爆破跌破200节点' };
  }

  const prevOtcIndex = lastDipBelow200.otc_index;
  const currOtcIndex = entryStartOtcIndex;
  const otcChange = currOtcIndex - prevOtcIndex;
  const changePercent = (otcChange / prevOtcIndex) * 100;

  const result = {
    isHighQuality: false,
    prevNode: lastDipBelow200,
    prevOtc: prevOtcIndex,
    currOtc: currOtcIndex,
    otcChange: otcChange,
    changePercent: changePercent
  };

  if (Math.abs(changePercent) < 5) {
    result.reason = '场外指数持平';
  } else if (otcChange > 0) {
    result.isHighQuality = true;
    result.reason = '场外指数上升';
  } else {
    result.reason = '场外指数下降';
  }

  return result;
}

/**
 * 判断爆破破200节点是否为高质量
 * 根据bodong文档：比较当前破200节点与上一个破200节点的场外指数
 */
function isDipBelow200HighQuality(metric, lastDip200Node) {
  if (!lastDip200Node) {
    return { isHighQuality: false, reason: '没有上一个破200节点对比' };
  }

  const prevOtc = lastDip200Node.otc_index;
  const currOtc = metric.otc_index;
  const otcChange = currOtc - prevOtc;
  const changePercent = (otcChange / prevOtc) * 100;

  const result = {
    isHighQuality: false,
    prevNode: lastDip200Node,
    prevOtc: prevOtc,
    currOtc: currOtc,
    otcChange: otcChange,
    changePercent: changePercent
  };

  if (Math.abs(changePercent) < 5) {
    result.reason = '场外指数持平（波动收敛）';
  } else if (otcChange > 0) {
    result.isHighQuality = true;
    result.reason = '场外指数上升（波动展开）';
  } else {
    result.reason = '场外指数下降（波动收敛）';
  }

  return result;
}

/**
 * 动态质量评估策略:
 * 1. 买入: 高质量进场期第一天
 * 2. 持仓期间: 每次爆破破200时评估质量
 *    - 高质量: 继续持有
 *    - 低质量: 卖出
 * 3. 或退场期第一天卖出
 */
async function backtestBTCDynamicQuality() {
  try {
    console.log('========== BTC动态质量评估策略回测 ==========\n');
    console.log('策略说明:');
    console.log('  买入: 高质量进场期第一天');
    console.log('  持仓: 每次爆破破200时评估质量');
    console.log('       - 高质量: 继续持有');
    console.log('       - 低质量: 卖出');
    console.log('  或: 退场期第一天卖出');
    console.log('  依据: bodong文档第二章和第五章\n');

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
    let lastDip200InPosition = null; // 当前持仓期间最近的一个破200节点
    let hasSeenExplosion200 = false;
    let totalProfit = 0;
    let totalProfitPercent = 0;
    let winCount = 0;
    let lossCount = 0;
    let entrySignalCount = 0;
    let highQualityEntryCount = 0;
    let dip200EvaluationCount = 0; // 评估破200节点的次数

    for (let i = 0; i < btcMetrics.length; i++) {
      const metric = btcMetrics[i];
      const prevMetric = i > 0 ? btcMetrics[i - 1] : null;

      // === 买入逻辑 ===
      if (!position) {
        if (metric.entry_exit_type === 'entry' && metric.entry_exit_day === 1) {
          entrySignalCount++;
        }

        const entryQuality = isHighQualityEntryStart(metric, btcMetrics, i);

        if (entryQuality.isHighQuality) {
          highQualityEntryCount++;
          hasSeenExplosion200 = metric.explosion_index >= 200;

          position = {
            buyDate: metric.date,
            buyPrice: metric.schelling_point,
            buyIndex: i,
            buyExplosion: metric.explosion_index,
            buyOtc: metric.otc_index,
            entryQuality: entryQuality
          };

          // 初始化：进场期第一天也是一个关键节点
          lastDip200InPosition = {
            date: metric.date,
            otc_index: metric.otc_index,
            explosion_index: metric.explosion_index,
            schelling_point: metric.schelling_point
          };

          console.log(`\n📈 买入信号 [${metric.date}] - 高质量进场期第1天:`);
          console.log(`   价格: $${metric.schelling_point.toFixed(0)}`);
          console.log(`   爆破: ${metric.explosion_index} | 场外: ${metric.otc_index}`);
          console.log(`   质量: ${entryQuality.reason}`);
          console.log(`   对比: 上次破200(${entryQuality.prevNode.date}) 场外${entryQuality.prevOtc} -> 现在${entryQuality.currOtc} (${entryQuality.changePercent.toFixed(2)}%)`);

          if (!hasSeenExplosion200) {
            console.log(`   ⚠️  买入时爆破<200，等待爆破先升到>=200`);
          }
        }
      }

      // === 持仓期间逻辑 ===
      else if (position) {
        // 如果还在等待爆破升到200
        if (!hasSeenExplosion200 && metric.explosion_index >= 200) {
          hasSeenExplosion200 = true;
          console.log(`   ✓ ${metric.date}: 爆破升到${metric.explosion_index}>=200`);
        }

        // 检测爆破破200节点
        if (hasSeenExplosion200 &&
            prevMetric &&
            prevMetric.explosion_index >= 200 &&
            metric.explosion_index < 200) {

          dip200EvaluationCount++;

          console.log(`\n🔍 检测到爆破破200节点 [${metric.date}]:`);
          console.log(`   价格: $${metric.schelling_point.toFixed(0)}`);
          console.log(`   爆破: ${prevMetric.explosion_index} -> ${metric.explosion_index}`);
          console.log(`   场外: ${metric.otc_index}`);

          // 评估这个破200节点的质量
          const dip200Quality = isDipBelow200HighQuality(metric, lastDip200InPosition);

          console.log(`   质量评估: ${dip200Quality.reason}`);
          console.log(`   对比: 上次节点(${dip200Quality.prevNode.date}) 场外${dip200Quality.prevOtc} -> 现在${dip200Quality.currOtc} (${dip200Quality.changePercent.toFixed(2)}%)`);

          if (dip200Quality.isHighQuality) {
            // 高质量：继续持有，更新最近的破200节点
            console.log(`   ✅ 高质量破200节点，继续持有`);
            lastDip200InPosition = {
              date: metric.date,
              otc_index: metric.otc_index,
              explosion_index: metric.explosion_index,
              schelling_point: metric.schelling_point
            };
          } else {
            // 低质量：卖出
            console.log(`   ❌ 低质量破200节点，触发卖出`);

            const sellPrice = metric.schelling_point;
            const profit = sellPrice - position.buyPrice;
            const profitPercent = ((profit / position.buyPrice) * 100).toFixed(2);
            const holdDays = i - position.buyIndex;

            console.log(`\n📉 卖出信号 [${metric.date}] - 低质量破200:`);
            console.log(`   价格: $${sellPrice.toFixed(0)}`);
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
              sellReason: '低质量破200',
              sellExplosion: metric.explosion_index,
              sellOtc: metric.otc_index,
              profit: profit,
              profitPercent: parseFloat(profitPercent),
              holdDays: holdDays,
              maxPriceInPeriod: maxPrice,
              maxPriceDate: maxPriceDate,
              maxProfit: maxPrice - position.buyPrice,
              maxProfitPercent: parseFloat(((maxPrice - position.buyPrice) / position.buyPrice * 100).toFixed(2)),
              dip200Evaluations: dip200EvaluationCount
            };

            trades.push(trade);
            totalProfit += profit;
            totalProfitPercent += parseFloat(profitPercent);
            if (profit > 0) winCount++;
            else lossCount++;

            // 清空持仓
            position = null;
            lastDip200InPosition = null;
            hasSeenExplosion200 = false;
            dip200EvaluationCount = 0;
          }
        }

        // 检测退场期第一天
        if (position &&
            metric.entry_exit_type === 'exit' &&
            metric.entry_exit_day === 1) {

          const sellPrice = metric.schelling_point;
          const profit = sellPrice - position.buyPrice;
          const profitPercent = ((profit / position.buyPrice) * 100).toFixed(2);
          const holdDays = i - position.buyIndex;

          console.log(`\n📉 卖出信号 [${metric.date}] - 退场期第1天:`);
          console.log(`   价格: $${sellPrice.toFixed(0)}`);
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
            sellReason: '退场期第1天',
            sellExplosion: metric.explosion_index,
            sellOtc: metric.otc_index,
            profit: profit,
            profitPercent: parseFloat(profitPercent),
            holdDays: holdDays,
            maxPriceInPeriod: maxPrice,
            maxPriceDate: maxPriceDate,
            maxProfit: maxPrice - position.buyPrice,
            maxProfitPercent: parseFloat(((maxPrice - position.buyPrice) / position.buyPrice * 100).toFixed(2)),
            dip200Evaluations: dip200EvaluationCount
          };

          trades.push(trade);
          totalProfit += profit;
          totalProfitPercent += parseFloat(profitPercent);
          if (profit > 0) winCount++;
          else lossCount++;

          // 清空持仓
          position = null;
          lastDip200InPosition = null;
          hasSeenExplosion200 = false;
          dip200EvaluationCount = 0;
        }
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
      console.log(`   状态: ${lastMetric.entry_exit_type} 第${lastMetric.entry_exit_day}天`);
    }

    // 输出结果
    console.log('\n========== 回测结果汇总 ==========\n');
    console.log(`进场期第一天总次数: ${entrySignalCount}次`);
    console.log(`高质量进场次数: ${highQualityEntryCount}次`);
    console.log(`高质量占比: ${entrySignalCount > 0 ? ((highQualityEntryCount / entrySignalCount) * 100).toFixed(2) : 0}%\n`);

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
        console.log(`  买入: ${trade.buyDate} @ $${trade.buyPrice.toFixed(0)} [高质量进场期]`);
        console.log(`        爆破${trade.buyExplosion} | 场外${trade.buyOtc}`);
        console.log(`  卖出: ${trade.sellDate} @ $${trade.sellPrice.toFixed(0)} [${trade.sellReason}]`);
        console.log(`        爆破${trade.sellExplosion} | 场外${trade.sellOtc}`);
        console.log(`  实际: $${trade.profit.toFixed(0)} (${trade.profitPercent}%) | ${trade.holdDays}天`);
        console.log(`  最高: ${trade.maxPriceDate} @ $${trade.maxPriceInPeriod.toFixed(0)} (${trade.maxProfitPercent}%)`);
        console.log(`  评估: 持仓期间评估了${trade.dip200Evaluations}次破200节点`);
        console.log('');
      });

      // 卖出原因统计
      console.log('========== 卖出原因分析 ==========\n');
      const sellReasons = {};
      trades.forEach(trade => {
        sellReasons[trade.sellReason] = (sellReasons[trade.sellReason] || 0) + 1;
      });
      Object.keys(sellReasons).forEach(reason => {
        console.log(`  ${reason}: ${sellReasons[reason]}次`);
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

backtestBTCDynamicQuality();
