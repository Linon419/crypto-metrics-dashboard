/**
 * 进退场期质量评估。
 *
 * 这组逻辑原先内联在 server/routes/data.js 中，占该文件约四分之一篇幅，
 * 且 coins.js 只能通过 dataRouter.__qualityTestUtils 这个测试用出口取用，
 * 业务代码依赖测试口袋。抽成独立模块后可直接引入。
 *
 * 对外只暴露 calculatePeriodQuality 与 calculatePeriodQualityForDate，
 * 其余 7 个函数是内部实现细节。
 */

const { Op } = require('sequelize');
const { DailyMetric } = require('../models');
const {
  QUALITY_LOOKBACK_DAYS,
  buildKeyNodeComparisons,
  classifyPeriodQuality,
} = require('./periodQuality');

function hasIncompleteEntryStart(metric) {
  const entryExitDay = Number(metric?.entry_exit_day);
  return Number.isFinite(entryExitDay) && entryExitDay > 1;
}

function detectWeakEntryWithinFirstWeek(historicalMetrics, entryStartDateMetric, targetMetric) {
  const entryStartDate = new Date(entryStartDateMetric.date);
  const oneWeekLater = new Date(entryStartDate);
  oneWeekLater.setDate(oneWeekLater.getDate() + 7);

  if (!targetMetric || new Date(targetMetric.date) < oneWeekLater) {
    return { triggered: false };
  }

  const oneWeekData = historicalMetrics
    .filter((metric) => {
      const metricDate = new Date(metric.date);
      return metricDate >= entryStartDate && metricDate <= oneWeekLater;
    })
    .sort((left, right) => new Date(left.date) - new Date(right.date));

  if (oneWeekData.length < 3) {
    return { triggered: false };
  }

  const hasBreak200 = oneWeekData.some((metric) => metric.explosion_index < 200);
  if (hasBreak200) {
    return { triggered: false };
  }

  const splitIndex = Math.ceil(oneWeekData.length / 2);
  const earlyWindow = oneWeekData.slice(0, splitIndex);
  const lateWindow = oneWeekData.slice(splitIndex);

  if (earlyWindow.length === 0 || lateWindow.length === 0) {
    return { triggered: false };
  }

  const earlyAverage = earlyWindow.reduce((sum, metric) => sum + (metric.explosion_index || 0), 0) / earlyWindow.length;
  const lateAverage = lateWindow.reduce((sum, metric) => sum + (metric.explosion_index || 0), 0) / lateWindow.length;

  return {
    triggered: lateAverage < earlyAverage,
    earlyAverage,
    lateAverage,
  };
}

function logKeyNodeComparisons(coinId, comparisons) {
  comparisons.forEach((comparison) => {
    const changePercent = Number.isFinite(comparison.changePercent)
      ? `${comparison.changePercent.toFixed(2)}%`
      : 'N/A';
    console.log(
      `[QualityCheck] CoinID ${coinId}: ${comparison.fromLabel}[${comparison.fromDate}](${comparison.fromOtcIndex}) -> ` +
      `${comparison.toLabel}[${comparison.toDate}](${comparison.toOtcIndex}), change=${changePercent}`
    );
  });
}

function getEntryComparisonsUpToTarget(comparisons, targetMetric) {
  if (!targetMetric?.date) {
    return comparisons;
  }

  const targetDate = new Date(targetMetric.date);
  return comparisons.filter((comparison) =>
    comparison.toRole !== 'after' || new Date(comparison.toDate) <= targetDate
  );
}

function getEntryQualityComparisons(comparisons, targetMetric, incompleteEntryStart) {
  const comparisonsUpToTarget = getEntryComparisonsUpToTarget(comparisons, targetMetric);

  if (!incompleteEntryStart) {
    return comparisonsUpToTarget;
  }

  return comparisonsUpToTarget.filter((comparison) =>
    comparison.fromRole === 'after' && comparison.toRole === 'after'
  );
}

/**
 * 根据 bodong 文档第五章评估进场期质量
 * @param {Array} historicalMetrics - 历史数据
 * @param {Object} entryStartDateMetric - 进场期第一天数据
 * @param {number} entryStartOtcIndex - 进场期第一天场外指数
 * @param {number} coinId - 币种ID
 * @returns {string} - 进场期质量评估结果
 */
function evaluateEntryQualityBodong(historicalMetrics, entryStartDateMetric, entryStartOtcIndex, coinId, targetMetric = entryStartDateMetric) {
  const incompleteEntryStart = hasIncompleteEntryStart(entryStartDateMetric);

  // 找到所有"爆破指数跌破200"的节点
  // 注意：historicalMetrics是按日期降序排列的，所以i=0是最新的数据
  let dipBelow200Nodes = [];
  for (let i = 1; i < historicalMetrics.length; i++) {
    const current = historicalMetrics[i];      // 较早的日期
    const previous = historicalMetrics[i-1];   // 较晚的日期
    // 检查从高于200跌破到低于200：前一天≥200，当天<200
    if (current.explosion_index >= 200 && previous.explosion_index < 200) {
      dipBelow200Nodes.push({
        date: previous.date,  // 跌破200的那一天
        otc_index: previous.otc_index,
        index: i-1
      });
      console.log(`[QualityCheck] CoinID ${coinId}: Found dip below 200 node: ${previous.date}, explosion: ${current.explosion_index} -> ${previous.explosion_index}, OTC: ${previous.otc_index}`);
    }
  }

  // 按时间排序（最早的在前）
  dipBelow200Nodes.sort((a, b) => new Date(a.date) - new Date(b.date));

  console.log(`[QualityCheck] CoinID ${coinId}: Found ${dipBelow200Nodes.length} dip below 200 nodes total.`);

  const firstWeekRisk = incompleteEntryStart
    ? { triggered: false }
    : detectWeakEntryWithinFirstWeek(historicalMetrics, entryStartDateMetric, targetMetric);
  if (firstWeekRisk.triggered) {
    console.log(
      `[QualityCheck] CoinID ${coinId}: 首周爆破均值走弱，前半段均值=${firstWeekRisk.earlyAverage.toFixed(2)}, ` +
      `后半段均值=${firstWeekRisk.lateAverage.toFixed(2)} -> 低质量进场（建议调仓）`
    );
    return '低质量进场';
  }

  // 构建关键节点序列 (bodong 文档 - 第五章)
  const entryStartDate = new Date(entryStartDateMetric.date);

  // 找到进场期第一天之前的跌破200节点（节点1、2等）
  const beforeEntryNodes = dipBelow200Nodes.filter(node =>
    new Date(node.date) < entryStartDate
  );

  // 找到进场期第一天之后的跌破200节点（节点4、5等）
  const afterEntryNodes = dipBelow200Nodes.filter(node =>
    new Date(node.date) > entryStartDate
  );

  console.log(`[QualityCheck] CoinID ${coinId}: Before entry nodes: ${beforeEntryNodes.length}, After entry nodes: ${afterEntryNodes.length}`);

  const beforeNode = beforeEntryNodes.length > 0
    ? {
        ...beforeEntryNodes[beforeEntryNodes.length - 1],
        nodeNum: beforeEntryNodes.length,
      }
    : null;

  const startNode = {
    date: entryStartDateMetric.date,
    otc_index: entryStartOtcIndex,
    nodeNum: beforeEntryNodes.length + 1,
  };

  const afterNodes = afterEntryNodes.map((node, index) => ({
    ...node,
    nodeNum: beforeEntryNodes.length + 2 + index,
  }));

  const comparisons = buildKeyNodeComparisons({
    phase: 'entry',
    beforeNode,
    startNode,
    afterNodes,
  });

  if (comparisons.length === 0) {
    console.log(`[QualityCheck] CoinID ${coinId}: No key-node comparison available. Returning '进场期 (待观察)'.`);
    return '进场期 (待观察)';
  }

  const comparisonsForTarget = getEntryQualityComparisons(comparisons, targetMetric, incompleteEntryStart);
  if (comparisonsForTarget.length === 0) {
    if (incompleteEntryStart) {
      console.log(
        `[QualityCheck] CoinID ${coinId}: Entry period starts from existing day ${entryStartDateMetric.entry_exit_day}; ` +
        `same-type key-node comparison unavailable. Returning '数据不足'.`
      );
      return '数据不足';
    }

    console.log(`[QualityCheck] CoinID ${coinId}: No target key-node comparison available. Returning '进场期 (待观察)'.`);
    return '进场期 (待观察)';
  }

  logKeyNodeComparisons(coinId, comparisonsForTarget);

  const quality = classifyPeriodQuality({
    phase: 'entry',
    comparisons: comparisonsForTarget,
  });

  console.log(
    `[QualityCheck] CoinID ${coinId}: Entry quality=${quality.label}, ` +
    `evidence=${quality.evidenceCount}, confidence=${quality.confidence}, reason=${quality.reason}`
  );

  return quality.label;
}

/**
 * 根据bodong文档第六章评估退场期质量
 * @param {Array} historicalMetrics - 历史数据
 * @param {Object} exitStartDateMetric - 退场期第一天数据
 * @param {number} exitStartOtcIndex - 退场期第一天场外指数
 * @param {number} coinId - 币种ID
 * @returns {string} - 退场期质量评估结果
 */
function evaluateExitQualityBodong(historicalMetrics, exitStartDateMetric, exitStartOtcIndex, coinId) {
  // 找到所有"爆破指数由负转正"的节点
  // 注意：historicalMetrics是按日期降序排列的，所以i=0是最新的数据
  let turnPositiveNodes = [];
  for (let i = 1; i < historicalMetrics.length; i++) {
    const current = historicalMetrics[i];      // 较早的日期
    const previous = historicalMetrics[i-1];   // 较晚的日期
    // 检查从负数变为正数：前一天是负数，当天是正数或零
    if (current.explosion_index < 0 && previous.explosion_index >= 0) {
      turnPositiveNodes.push({
        date: previous.date,  // 转正的那一天
        otc_index: previous.otc_index,
        index: i-1
      });
      console.log(`[QualityCheck] CoinID ${coinId}: Found turn positive node: ${previous.date}, explosion: ${current.explosion_index} -> ${previous.explosion_index}, OTC: ${previous.otc_index}`);
    }
  }

  // 按时间排序（最早的在前）
  turnPositiveNodes.sort((a, b) => new Date(a.date) - new Date(b.date));

  console.log(`[QualityCheck] CoinID ${coinId}: Found ${turnPositiveNodes.length} turn positive nodes total.`);

  // 构建关键节点序列 (bodong 文档 - 第六章)
  const exitStartDate = new Date(exitStartDateMetric.date);

  // 找到退场期第一天之前的转正节点（节点1、2等）
  const beforeExitNodes = turnPositiveNodes.filter(node =>
    new Date(node.date) < exitStartDate
  );

  // 找到退场期第一天之后的转正节点（节点4、5等）
  const afterExitNodes = turnPositiveNodes.filter(node =>
    new Date(node.date) > exitStartDate
  );

  console.log(`[QualityCheck] CoinID ${coinId}: Before exit nodes: ${beforeExitNodes.length}, After exit nodes: ${afterExitNodes.length}`);

  const beforeNode = beforeExitNodes.length > 0
    ? {
        ...beforeExitNodes[beforeExitNodes.length - 1],
        nodeNum: beforeExitNodes.length,
      }
    : null;

  const startNode = {
    date: exitStartDateMetric.date,
    otc_index: exitStartOtcIndex,
    nodeNum: beforeExitNodes.length + 1,
  };

  const afterNodes = afterExitNodes.map((node, index) => ({
    ...node,
    nodeNum: beforeExitNodes.length + 2 + index,
  }));

  const comparisons = buildKeyNodeComparisons({
    phase: 'exit',
    beforeNode,
    startNode,
    afterNodes,
  });

  if (comparisons.length === 0) {
    console.log(`[QualityCheck] CoinID ${coinId}: No key-node comparison available. Returning '退场期 (待观察)'.`);
    return '退场期 (待观察)';
  }

  logKeyNodeComparisons(coinId, comparisons);

  const quality = classifyPeriodQuality({
    phase: 'exit',
    comparisons,
  });

  console.log(
    `[QualityCheck] CoinID ${coinId}: Exit quality=${quality.label}, ` +
    `evidence=${quality.evidenceCount}, confidence=${quality.confidence}, reason=${quality.reason}`
  );

  return quality.label;
}

/**
 * 简化的质量判断（用于历史数据）
 * @param {Object} metric - 数据记录
 * @returns {string} - 简化的质量描述
 */
function getSimplifiedQuality(metric) {
  if (!metric.entry_exit_type || metric.entry_exit_type === 'neutral') {
    return '观望';
  }

  if (metric.entry_exit_type === 'entry') {
    // 简化的进场期质量判断
    if (metric.explosion_index < 200) {
      return '进场期 (爆破<200)';
    } else {
      return '进场期 (爆破≥200)';
    }
  }

  if (metric.entry_exit_type === 'exit') {
    // 简化的退场期质量判断
    if (metric.explosion_index < 0) {
      return '退场期 (爆破<0)';
    } else {
      return '退场期 (爆破≥0)';
    }
  }

  return '历史数据';
}

/**
 * 计算给定币种在特定日期的周期质量（用于历史数据）
 * @param {number} coinId - 币种的ID
 * @param {string} targetDate - 目标日期 (YYYY-MM-DD)
 * @param {Array} historicalMetrics - 预先获取的历史数据
 * @returns {Promise<string>} - 描述周期质量的字符串
 */
async function calculatePeriodQualityForDate(coinId, targetDate, historicalMetrics) {
  try {
    console.log(`[QualityCheck-Historical] CoinID ${coinId}: Calculating quality for date ${targetDate} with ${historicalMetrics.length} historical records.`);

    if (historicalMetrics.length < 2) {
      console.log(`[QualityCheck-Historical] CoinID ${coinId}: Insufficient historical data (${historicalMetrics.length} records). Returning '数据不足'.`);
      return '数据不足';
    }

    // 找到目标日期的数据
    const targetMetric = historicalMetrics.find(m => m.date === targetDate);
    if (!targetMetric) {
      console.log(`[QualityCheck-Historical] CoinID ${coinId}: No data found for target date ${targetDate}. Returning '数据不足'.`);
      return '数据不足';
    }

    console.log(`[QualityCheck-Historical] CoinID ${coinId}: Target metric on ${targetDate} is type '${targetMetric.entry_exit_type}'.`);

    // 进场期质量评估
    if (targetMetric.entry_exit_type === 'entry') {
      // 找到当前进场期的开始（从目标日期往前找，数据是按日期降序排列的）
      let entryStartDateMetric = null;
      for (let i = 0; i < historicalMetrics.length; i++) {
        const metric = historicalMetrics[i];
        if (metric.date > targetDate) continue; // 跳过目标日期之后的数据

        if (metric.entry_exit_type === 'entry') {
          // 检查是否是进场期的开始（下一条记录不是进场期或已到末尾）
          const nextMetric = historicalMetrics[i + 1];
          if (!nextMetric || nextMetric.entry_exit_type !== 'entry') {
            entryStartDateMetric = metric;
            break;
          }
        }
      }

      if (!entryStartDateMetric) {
        console.log(`[QualityCheck-Historical] CoinID ${coinId}: Could not find start of 'entry' period for date ${targetDate}. Returning '数据不足'.`);
        return '数据不足';
      }

      const entryStartOtcIndex = entryStartDateMetric.otc_index;
      console.log(`[QualityCheck-Historical] CoinID ${coinId}: Entry period started on ${entryStartDateMetric.date} with OTC Index ${entryStartOtcIndex}.`);

      if (!entryStartOtcIndex) return '数据不足';

      // 使用完整的进场期质量评估算法
      return evaluateEntryQualityBodong(historicalMetrics, entryStartDateMetric, entryStartOtcIndex, coinId, targetMetric);
    }

    // 退场期质量评估
    if (targetMetric.entry_exit_type === 'exit') {
      // 找到当前退场期的开始（从目标日期往前找，数据是按日期降序排列的）
      let exitStartDateMetric = null;
      for (let i = 0; i < historicalMetrics.length; i++) {
        const metric = historicalMetrics[i];
        if (metric.date > targetDate) continue; // 跳过目标日期之后的数据

        if (metric.entry_exit_type === 'exit') {
          // 检查是否是退场期的开始（下一条记录不是退场期或已到末尾）
          const nextMetric = historicalMetrics[i + 1];
          if (!nextMetric || nextMetric.entry_exit_type !== 'exit') {
            exitStartDateMetric = metric;
            break;
          }
        }
      }

      if (!exitStartDateMetric) {
        console.log(`[QualityCheck-Historical] CoinID ${coinId}: Could not find start of 'exit' period for date ${targetDate}. Returning '数据不足'.`);
        return '数据不足';
      }

      const exitStartOtcIndex = exitStartDateMetric.otc_index;
      console.log(`[QualityCheck-Historical] CoinID ${coinId}: Exit period started on ${exitStartDateMetric.date} with OTC Index ${exitStartOtcIndex}.`);

      if (!exitStartOtcIndex) return '数据不足';

      // 使用完整的退场期质量评估算法
      return evaluateExitQualityBodong(historicalMetrics, exitStartDateMetric, exitStartOtcIndex, coinId);
    }

    console.log(`[QualityCheck-Historical] CoinID ${coinId}: Not in entry/exit period on ${targetDate}. Returning '观望'.`);
    return '观望'; // 既不进场也不退场
  } catch (error) {
    console.error(`Error calculating historical period quality for coinId ${coinId} on ${targetDate}:`, error);
    return '计算出错';
  }
}

/**
 * 计算给定币种当前周期的质量
 * @param {number} coinId - 币种的ID
 * @returns {Promise<string>} - 描述周期质量的字符串
 */
async function calculatePeriodQuality(coinId) {
  try {
    // 获取该币种最近一年的历史指标，按日期降序
    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - QUALITY_LOOKBACK_DAYS);
    const lookbackDateStr = lookbackDate.toISOString().split('T')[0];

    const historicalMetrics = await DailyMetric.findAll({
      where: {
        coin_id: coinId,
        date: { [Op.gte]: lookbackDateStr }
      },
      order: [['date', 'DESC']],
      raw: true
    });

    if (historicalMetrics.length < 2) {
      console.log(`[QualityCheck] CoinID ${coinId}: Insufficient historical data (${historicalMetrics.length} records). Returning '数据不足'.`);
      return '数据不足';
    }

    const latestMetric = historicalMetrics[0];
    console.log(`[QualityCheck] CoinID ${coinId}: Latest metric on ${latestMetric.date} is type '${latestMetric.entry_exit_type}'.`);


    // 进场期质量评估 (bodong 文档 - 第二章 & 第三章)
    if (latestMetric.entry_exit_type === 'entry') {
      // 1. 找到当前进场期的开始
      let entryPeriodStartIndex = -1;
      for (let i = 0; i < historicalMetrics.length; i++) {
        const metric = historicalMetrics[i];
        if (metric.entry_exit_type === 'entry' && (historicalMetrics[i+1]?.entry_exit_type !== 'entry' || i === historicalMetrics.length - 1)) {
          entryPeriodStartIndex = i;
          break;
        }
      }

      if (entryPeriodStartIndex === -1) {
        console.log(`[QualityCheck] CoinID ${coinId}: Could not find start of 'entry' period. Returning '数据不足'.`);
        return '数据不足';
      }

      const entryStartDateMetric = historicalMetrics[entryPeriodStartIndex];
      const entryStartOtcIndex = entryStartDateMetric.otc_index;
      
      console.log(`[QualityCheck] CoinID ${coinId}: Entry period started on ${entryStartDateMetric.date} with OTC Index ${entryStartOtcIndex}.`);


      if (!entryStartOtcIndex) return '数据不足';

      // 2. 在进场期内，找到第一个“爆破指数跌回200”的节点
      // 从进场第一天开始，往更近的日期找
      // 按照bodong文档第五章实现进场期质量评估
      return evaluateEntryQualityBodong(historicalMetrics, entryStartDateMetric, entryStartOtcIndex, coinId, latestMetric);
    }
    
    // 退场期质量评估 (bodong 文档 - 第六章)
    if (latestMetric.entry_exit_type === 'exit') {
        // 1. 找到当前退场期的开始
        let exitPeriodStartIndex = -1;
        for (let i = 0; i < historicalMetrics.length; i++) {
            const metric = historicalMetrics[i];
            if (metric.entry_exit_type === 'exit' && (historicalMetrics[i+1]?.entry_exit_type !== 'exit' || i === historicalMetrics.length - 1)) {
                exitPeriodStartIndex = i;
                break;
            }
        }

        if (exitPeriodStartIndex === -1) {
          console.log(`[QualityCheck] CoinID ${coinId}: Could not find start of 'exit' period. Returning '数据不足'.`);
          return '数据不足';
        }

        const exitStartDateMetric = historicalMetrics[exitPeriodStartIndex];
        const exitStartOtcIndex = exitStartDateMetric.otc_index;
        console.log(`[QualityCheck] CoinID ${coinId}: Exit period started on ${exitStartDateMetric.date} with OTC Index ${exitStartOtcIndex}.`);
        
        if (!exitStartOtcIndex) return '数据不足';

        // 2. 在退场期内，找到第一个“爆破指数由负转正”的节点
        // 从退场期开始往前查找，找到的第一个转正节点就是上一次转正的节点
        // 按照bodong文档第六章实现退场期质量评估
        return evaluateExitQualityBodong(historicalMetrics, exitStartDateMetric, exitStartOtcIndex, coinId);
    }

    console.log(`[QualityCheck] CoinID ${coinId}: Not in entry/exit period. Returning '观望'.`);
    return '观望'; // 既不进场也不退场
  } catch (error) {
    console.error(`Error calculating period quality for coinId ${coinId}:`, error);
    return '计算出错';
  }
}

module.exports = {
  calculatePeriodQuality,
  calculatePeriodQualityForDate,
  __internals: {
    detectWeakEntryWithinFirstWeek,
    evaluateEntryQualityBodong,
    evaluateExitQualityBodong,
    getEntryQualityComparisons,
    getSimplifiedQuality,
  },
};
