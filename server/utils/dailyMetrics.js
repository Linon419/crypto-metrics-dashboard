/**
 * 每日指标的归一化、序列化、版本查询与持久化。
 *
 * 原先内联在 routes/data.js 中，由各路由与 storeProcessedData 共用。
 * 抽出后 data.js 只保留路由编排。
 */

const db = require('../models');
const { Coin, DailyMetric, LiquidityOverview, OptionTuning, TrendingCoin, sequelize } = db;
const { Op } = require('sequelize');
const { parseFlexibleDateTime, parseWallClockInOffset, validateTimePrecision } = require('./timeParser');
const { evaluateStrategySignal } = require('./strategySignals');

// --- 辅助函数：计算百分比变化 ---
function calculateChangePercent(current, previous) {
  if (typeof current !== 'number' || typeof previous !== 'number') return null;
  if (previous === 0) {
    return current === 0 ? 0 : Infinity; // 从0到非0是无限大，0到0是0%
  }
  return ((current - previous) / previous) * 100;
}

function normalizeMomentumIndicators(value) {
  if (Array.isArray(value)) {
    return value
      .map(indicator => String(indicator).trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    if (!trimmedValue) return [];

    try {
      const parsedValue = JSON.parse(trimmedValue);
      return normalizeMomentumIndicators(parsedValue);
    } catch (error) {
      return [trimmedValue];
    }
  }

  return [];
}

function serializeMomentumIndicators(value) {
  const indicators = normalizeMomentumIndicators(value);
  return indicators.length > 0 ? JSON.stringify(indicators) : null;
}

function normalizeOptionEnum(value, rules) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  for (const rule of rules) {
    if (rule.patterns.some(pattern => normalized.includes(pattern))) {
      return rule.value;
    }
  }

  return normalized.replace(/[\s-]+/g, '_');
}

function normalizeOptionStrategy(value) {
  if (typeof value !== 'string') return null;

  const strategyValue = value
    .trim()
    .replace(/^(组成|构成|compose|build)\s*[:：]?\s*/i, '');

  return normalizeOptionEnum(strategyValue, [
    { value: 'iron_condor', patterns: ['iron condor', 'iron_condor', '铁鹰'] },
    { value: 'gamma_squeeze', patterns: ['gamma squeeze', 'gamma_squeeze', '伽马挤压', 'gamma挤压'] },
  ]);
}

function normalizeOptionTuning(value) {
  if (!value || typeof value !== 'object') return null;

  const rawText = value.rawText ?? value.raw_text ?? null;
  const deltaSource = value.deltaTarget ?? value.delta_target ?? '';
  const vegaSource = value.vegaTarget ?? value.vega_target ?? '';
  const strategySource = value.strategy || rawText || '';

  const normalized = {
    delta_target: normalizeOptionEnum(deltaSource, [
      { value: 'neutral', patterns: ['neutral', '中性'] },
    ]),
    vega_target: normalizeOptionEnum(vegaSource, [
      { value: 'positive', patterns: ['positive', '正数', '为正', '正'] },
      { value: 'negative', patterns: ['negative', '负数', '为负', '负'] },
    ]),
    strategy: normalizeOptionStrategy(strategySource),
    raw_text: typeof rawText === 'string' && rawText.trim() ? rawText.trim() : null,
  };

  const hasValue = normalized.delta_target
    || normalized.vega_target
    || normalized.strategy
    || normalized.raw_text;

  return hasValue ? normalized : null;
}

function serializeOptionTuning(value) {
  const normalized = normalizeOptionTuning(value);
  if (!normalized) return null;

  return {
    deltaTarget: normalized.delta_target,
    vegaTarget: normalized.vega_target,
    strategy: normalized.strategy,
    rawText: normalized.raw_text,
  };
}

function parseRecordTime(date, timestamp, precision) {
  const parsedTime = parseFlexibleDateTime(date);
  const explicitTimestamp = timestamp ? new Date(timestamp) : null;
  const hasExplicitTimestamp = explicitTimestamp && !Number.isNaN(explicitTimestamp.getTime());

  return {
    date: parsedTime.date,
    timestamp: hasExplicitTimestamp ? explicitTimestamp : parsedTime.timestamp,
    precision: validateTimePrecision(precision || parsedTime.precision),
  };
}

function buildVersionWhere(baseWhere, timeInfo) {
  const where = { ...baseWhere, date: timeInfo.date };

  if (timeInfo.timestamp) {
    where.timestamp = timeInfo.timestamp;
  }

  return where;
}

async function getLatestMetricVersionForDate(date) {
  if (!date) return null;

  return DailyMetric.findOne({
    where: { date },
    attributes: ['date', 'timestamp', 'time_precision'],
    order: [['timestamp', 'DESC'], ['id', 'DESC']],
    raw: true,
  });
}

function buildDateVersionWhere(date, version) {
  const where = { date };

  if (version?.timestamp) {
    const parsedTimestamp = new Date(version.timestamp);
    where.timestamp = Number.isNaN(parsedTimestamp.getTime())
      ? version.timestamp
      : parsedTimestamp;
  }

  return where;
}

async function getRecentMetricHistoryMap(coinIds, date, limitPerCoin = 4) {
  if (!Array.isArray(coinIds) || coinIds.length === 0 || !date) {
    return new Map();
  }

  const rows = await DailyMetric.findAll({
    where: {
      coin_id: { [Op.in]: coinIds },
      date: { [Op.lte]: date },
    },
    order: [
      ['coin_id', 'ASC'],
      ['date', 'DESC'],
      ['timestamp', 'DESC'],
      ['id', 'DESC'],
    ],
    raw: true,
  });

  const historyMap = new Map();
  const seenDateMap = new Map();

  rows.forEach(row => {
    const coinId = row.coin_id;
    if (!historyMap.has(coinId)) {
      historyMap.set(coinId, []);
      seenDateMap.set(coinId, new Set());
    }

    const history = historyMap.get(coinId);
    const seenDates = seenDateMap.get(coinId);
    if (history.length >= limitPerCoin || seenDates.has(row.date)) {
      return;
    }

    history.push(row);
    seenDates.add(row.date);
  });

  return historyMap;
}

function buildStrategyInput(metric, history = []) {
  return {
    symbol: metric.symbol || metric.coin?.symbol,
    date: metric.date,
    timestamp: metric.timestamp,
    otcIndex: metric.otcIndex ?? metric.otc_index,
    explosionIndex: metric.explosionIndex ?? metric.explosion_index,
    entryExitType: metric.entryExitType ?? metric.entry_exit_type,
    entryExitDay: metric.entryExitDay ?? metric.entry_exit_day,
    period_quality: metric.period_quality,
    previousDayData: metric.previousDayData || metric.previous_day_data || null,
    riskNotes: metric.riskNotes || metric.risk_notes || [],
    history,
  };
}

function attachStrategySignal(metric, history = []) {
  return {
    ...metric,
    strategy_signal: evaluateStrategySignal(buildStrategyInput(metric, history)),
  };
}

// --- 辅助函数：存储 OpenAI 处理后的数据 ---
async function storeProcessedData(data, clientTimezoneOffsetMinutes = null) {
  console.log('======== [STORE_DATA] STARTING DATA STORAGE ========');
  // console.log('[STORE_DATA] Received data:', JSON.stringify(data, null, 2));

  const { date, coins = [], liquidity, trendingCoins = [], optionTuning } = data;
  const storageResult = {
    coins: [],
    liquidityUpdated: false,
    optionTuningUpdated: false,
    trendingCoins: [],
  };
  const transaction = await sequelize.transaction(); // 使用事务

  try {
    // 解析时间信息
    const timeInfo = parseWallClockInOffset(date, clientTimezoneOffsetMinutes);
    console.log(`[STORE_DATA] Processing data for date: ${date}`);
    console.log(`[STORE_DATA] Parsed time info:`, timeInfo);
    console.log(`[STORE_DATA] Number of coins to process: ${coins.length}`);

    for (const coinData of coins) {
      if (!coinData || !coinData.symbol) {
        console.warn('[STORE_DATA] Skipping coin data due to missing symbol:', coinData);
        continue;
      }
      const symbolUpper = coinData.symbol.toUpperCase();
      // console.log(`\n[STORE_DATA] Processing coin: ${symbolUpper}`);

      try {
        const [coinInstance, coinCreated] = await Coin.findOrCreate({
          where: { symbol: symbolUpper },
          defaults: {
            name: coinData.name || symbolUpper,
            current_price: typeof coinData.current_price === 'number' ? coinData.current_price : null, // OpenAI 可能不提供价格
            logo_url: coinData.logo_url || null,
          },
          transaction
        });

        // 如果 Coin 已存在，且 OpenAI 提供了新的 name/logo (通常OpenAI不提供价格)
        // Coin 的 current_price 通常由其他服务（如 CoinGecko）更新，OpenAI 主要提供指标
        if (!coinCreated) {
          let needsUpdate = false;
          const updatePayload = {};
          if (coinData.name && coinInstance.name !== coinData.name) {
            updatePayload.name = coinData.name;
            needsUpdate = true;
          }
          if (coinData.logo_url && coinInstance.logo_url !== coinData.logo_url) {
            updatePayload.logo_url = coinData.logo_url;
            needsUpdate = true;
          }
          // 注意：不轻易用 OpenAI 的数据覆盖 current_price，除非这是明确的来源
          // if (typeof coinData.current_price === 'number' && coinInstance.current_price !== coinData.current_price) {
          //   updatePayload.current_price = coinData.current_price;
          //   needsUpdate = true;
          // }
          if (needsUpdate) {
            await coinInstance.update(updatePayload, { transaction });
            // console.log(`[STORE_DATA] Updated existing coin: ${symbolUpper}`);
          }
        }
        // console.log(`[STORE_DATA] Coin ${symbolUpper} ${coinCreated ? 'created' : 'found/updated'}. ID: ${coinInstance.id}`);

        const metricPayload = {
          coin_id: coinInstance.id,
          date: timeInfo.date,
          timestamp: timeInfo.timestamp,
          time_precision: validateTimePrecision(timeInfo.precision),
          otc_index: typeof coinData.otcIndex === 'number' ? coinData.otcIndex : null,
          explosion_index: typeof coinData.explosionIndex === 'number' ? coinData.explosionIndex : null,
          schelling_point: typeof coinData.schellingPoint === 'number' ? coinData.schellingPoint : null,
          entry_exit_type: coinData.entryExitType || 'neutral',
          entry_exit_day: typeof coinData.entryExitDay === 'number' ? coinData.entryExitDay : 0,
          near_threshold: !!coinData.nearThreshold,
          momentum_indicators: serializeMomentumIndicators(coinData.momentumIndicators)
        };
        // console.log('[STORE_DATA] Metric payload:', JSON.stringify(metricPayload, null, 2));

        const [metricInstance, metricCreated] = await DailyMetric.findOrCreate({
          where: buildVersionWhere({ coin_id: coinInstance.id }, timeInfo),
          defaults: metricPayload,
          transaction
        });

        if (!metricCreated) {
          await metricInstance.update(metricPayload, { transaction });
          // console.log(`[STORE_DATA] Updated existing metric for ${symbolUpper} on ${date}.`);
        }
        storageResult.coins.push({
          symbol: coinInstance.symbol,
          metricId: metricInstance.id,
          action: metricCreated ? 'created' : 'updated'
        });
      } catch (coinError) {
        console.error(`[STORE_DATA] Error processing coin ${symbolUpper}:`, coinError.message);
        // 考虑是否要因为单个币种错误而回滚整个事务，或记录错误并继续
      }
    }

    if (liquidity && typeof liquidity === 'object') {
      // console.log('\n[STORE_DATA] Processing liquidity data...');
      const liquidityPayload = {
        date: timeInfo.date,
        timestamp: timeInfo.timestamp,
        time_precision: validateTimePrecision(timeInfo.precision),
        btc_fund_change: typeof liquidity.btcFundChange === 'number' ? liquidity.btcFundChange : null,
        eth_fund_change: typeof liquidity.ethFundChange === 'number' ? liquidity.ethFundChange : null,
        sol_fund_change: typeof liquidity.solFundChange === 'number' ? liquidity.solFundChange : null,
        total_market_fund_change: typeof liquidity.totalMarketFundChange === 'number' ? liquidity.totalMarketFundChange : null,
        comments: liquidity.comments || null
      };

      // 处理 dailyReminder 字段
      if (data.dailyReminder) {
        liquidityPayload.daily_reminder = data.dailyReminder;
      }
      const [liqInstance, liqCreated] = await LiquidityOverview.findOrCreate({
        where: buildVersionWhere({}, timeInfo),
        defaults: liquidityPayload,
        transaction
      });
      if (!liqCreated) {
        await liqInstance.update(liquidityPayload, { transaction });
      }
      storageResult.liquidityUpdated = true;
    }

    const normalizedOptionTuning = normalizeOptionTuning(optionTuning);
    if (normalizedOptionTuning && OptionTuning) {
      const optionTuningPayload = {
        date: timeInfo.date,
        timestamp: timeInfo.timestamp,
        time_precision: validateTimePrecision(timeInfo.precision),
        ...normalizedOptionTuning,
      };

      const [optionTuningInstance, optionTuningCreated] = await OptionTuning.findOrCreate({
        where: buildVersionWhere({}, timeInfo),
        defaults: optionTuningPayload,
        transaction,
      });

      if (!optionTuningCreated) {
        await optionTuningInstance.update(optionTuningPayload, { transaction });
      }

      storageResult.optionTuningUpdated = true;
    }

    if (Array.isArray(trendingCoins) && trendingCoins.length > 0) {
      // console.log('\n[STORE_DATA] Processing trending coins data...');
      for (const trendData of trendingCoins) {
        if (!trendData || !trendData.symbol) {
            console.warn('[STORE_DATA] Skipping trending coin due to missing symbol:', trendData);
            continue;
        }
        const trendSymbolUpper = trendData.symbol.toUpperCase();
        try {
            const trendPayload = {
                date: timeInfo.date,
                timestamp: timeInfo.timestamp,
                time_precision: validateTimePrecision(timeInfo.precision),
                symbol: trendSymbolUpper,
                otc_index: typeof trendData.otcIndex === 'number' ? trendData.otcIndex : null,
                explosion_index: typeof trendData.explosionIndex === 'number' ? trendData.explosionIndex : null,
                schelling_point: typeof trendData.schellingPoint === 'number' ? trendData.schellingPoint : null,
                entry_exit_type: trendData.entryExitType || 'neutral',
                entry_exit_day: typeof trendData.entryExitDay === 'number' ? trendData.entryExitDay : 0,
            };
            const [trendInstance, trendCreated] = await TrendingCoin.findOrCreate({
                where: buildVersionWhere({ symbol: trendSymbolUpper }, timeInfo),
                defaults: trendPayload,
                transaction
            });
            if (!trendCreated) {
                await trendInstance.update(trendPayload, { transaction });
            }
            storageResult.trendingCoins.push({ symbol: trendSymbolUpper, action: trendCreated ? 'created' : 'updated' });
        } catch (trendError) {
            console.error(`[STORE_DATA] Error processing trending coin ${trendSymbolUpper}:`, trendError.message);
        }
      }
    }

    await transaction.commit();
    console.log('[STORE_DATA] Transaction committed successfully.');
    // console.log('[STORE_DATA] Result summary:', JSON.stringify(storageResult, null, 2));
    console.log('======== [STORE_DATA] DATA STORAGE COMPLETE ========');
    return storageResult;

  } catch (error) {
    await transaction.rollback();
    console.error('[STORE_DATA] Transaction rolled back due to error:', error);
    console.error('[STORE_DATA] Error name:', error.name);
    console.error('[STORE_DATA] Error message:', error.message);
    console.error('[STORE_DATA] Error stack:', error.stack);

    // 提供更详细的错误上下文
    if (error.name === 'SequelizeValidationError') {
      console.error('[STORE_DATA] Validation errors:', error.errors);
    } else if (error.name === 'SequelizeDatabaseError') {
      console.error('[STORE_DATA] Database error details:', error.parent);
    }

    throw error; // 重新抛出错误,让上层处理
  }
}

// --- 辅助函数：获取前一个有数据的日期字符串 ---
async function getPreviousDateWithData(currentDate) {
  try {
    // 查找小于当前日期的最近一条数据的日期
    const previousMetric = await DailyMetric.findOne({
      where: {
        date: { [Op.lt]: currentDate }
      },
      attributes: ['date'],
      order: [['date', 'DESC']],
      raw: true
    });

    return previousMetric ? previousMetric.date : null;
  } catch (error) {
    console.error('[GET_PREVIOUS_DATE] Error finding previous date:', error);
    return null;
  }
}

module.exports = {
  attachStrategySignal,
  buildDateVersionWhere,
  buildStrategyInput,
  buildVersionWhere,
  calculateChangePercent,
  getLatestMetricVersionForDate,
  getPreviousDateWithData,
  getRecentMetricHistoryMap,
  normalizeMomentumIndicators,
  normalizeOptionTuning,
  parseRecordTime,
  serializeMomentumIndicators,
  serializeOptionTuning,
  storeProcessedData,
};
