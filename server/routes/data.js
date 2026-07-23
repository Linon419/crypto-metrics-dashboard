// server/routes/data.js
const express = require('express');
const router = express.Router();
const db = require('../models');
const { Coin, DailyMetric, LiquidityOverview, OptionTuning, TrendingCoin, sequelize } = db; // 从 db 中获取 sequelize
const { Op } = require('sequelize');

const openaiService = require('../services/openaiService');
const {
  QUALITY_LOOKBACK_DAYS,
  buildKeyNodeComparisons,
  scoreBayesianPeriodQuality,
} = require('../utils/periodQuality');
const { buildPeriodRiskNotes } = require('../utils/periodRiskNotes');
const { parseFlexibleDateTime, parseWallClockInOffset, validateTimePrecision } = require('../utils/timeParser');
const { evaluateStrategySignal } = require('../utils/strategySignals');

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

// --- 路由：处理原始数据输入并存储 ---
router.post('/input', async (req, res) => {
  const { rawData, clientTimezoneOffsetMinutes } = req.body;
  if (!rawData || typeof rawData !== 'string' || rawData.trim() === '') {
    return res.status(400).json({ success: false, error: 'Raw data is required and must be a non-empty string' });
  }

  console.log(`[DATA_INPUT] Received raw data input request, length: ${rawData.length}`);
  const requestStartTime = Date.now();

  try {
    console.log('[DATA_INPUT] Calling OpenAI to process data...');
    const openaiStartTime = Date.now();
    const processedData = await openaiService.processRawData(rawData);
    const openaiEndTime = Date.now();
    console.log(`[DATA_INPUT] ⏱️ OpenAI处理总耗时: ${((openaiEndTime - openaiStartTime) / 1000).toFixed(2)} 秒`);
    console.log('[DATA_INPUT] OpenAI processing complete. Validating data structure...');

    if (!processedData || typeof processedData !== 'object' || !processedData.date || !Array.isArray(processedData.coins)) {
      console.error('[DATA_INPUT] OpenAI processed data validation failed. Structure:', JSON.stringify(processedData, null, 2));
      return res.status(400).json({
        success: false,
        error: 'Invalid processed data structure from OpenAI',
        details: 'Processed data must be an object including a date string and a coins array.'
      });
    }

    console.log('[DATA_INPUT] Storing processed data into database...');
    const dbStartTime = Date.now();
    const result = await storeProcessedData(processedData, clientTimezoneOffsetMinutes);
    const dbEndTime = Date.now();
    console.log(`[DATA_INPUT] ⏱️ 数据库存储耗时: ${((dbEndTime - dbStartTime) / 1000).toFixed(2)} 秒`);
    console.log('[DATA_INPUT] Data storage complete.');

    const totalEndTime = Date.now();
    console.log(`[DATA_INPUT] ⏱️ 总请求处理耗时: ${((totalEndTime - requestStartTime) / 1000).toFixed(2)} 秒`);

    res.json({
      success: true,
      message: 'Data processed and stored successfully.',
      date: processedData.date,
      processedSummary: {
        coinsProcessed: result.coins.length,
        liquidityUpdated: result.liquidityUpdated,
        trendingCoinsProcessed: result.trendingCoins.length
      }
    });

  } catch (processingError) {
    console.error('[DATA_INPUT] Error during data processing or storage:', processingError);
    console.error('[DATA_INPUT] Error stack:', processingError.stack);

    // 提供更详细的错误信息
    let errorDetails = {
      message: processingError.message,
      type: processingError.name || 'Unknown Error',
      timestamp: new Date().toISOString()
    };

    // 如果是OpenAI API错误
    if (processingError.message && processingError.message.includes('OpenAI')) {
      errorDetails.stage = 'OpenAI API Processing';
      errorDetails.suggestion = '请检查OpenAI API配置和网络连接';
    }
    // 如果是数据库错误
    else if (processingError.name === 'SequelizeError' || processingError.message.includes('database')) {
      errorDetails.stage = 'Database Storage';
      errorDetails.suggestion = '请检查数据库连接和表结构';
    }
    // 如果是数据验证错误
    else if (processingError.message.includes('Invalid') || processingError.message.includes('validation')) {
      errorDetails.stage = 'Data Validation';
      errorDetails.suggestion = '请检查输入数据格式';
    }
    else {
      errorDetails.stage = 'Unknown';
      errorDetails.suggestion = '请查看详细日志信息';
    }

    res.status(500).json({
      success: false,
      error: 'Error processing or storing data',
      details: errorDetails,
      rawError: processingError.message,
      stack: process.env.NODE_ENV !== 'production' ? processingError.stack : undefined
    });
  }
});

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

// --- 路由：获取最新数据 (增强版，包含前一天对比和百分比变化) ---
router.get('/latest', async (req, res) => {
  try {
    console.log('[LATEST_DATA] Request received for latest data (enhanced).');

    const latestMetricDateEntry = await DailyMetric.findOne({
      attributes: ['date', 'timestamp', 'time_precision'],
      order: [['date', 'DESC'], ['timestamp', 'DESC'], ['id', 'DESC']],
      raw: true, // 获取原始数据对象
    });

    if (!latestMetricDateEntry || !latestMetricDateEntry.date) {
      console.log('[LATEST_DATA] No metrics data found in database.');
      return res.status(404).json({ success: false, error: 'No metrics data found' });
    }

    const latestDate = latestMetricDateEntry.date;
    const previousDate = await getPreviousDateWithData(latestDate);
    const latestVersionWhere = buildDateVersionWhere(latestDate, latestMetricDateEntry);
    console.log(`[LATEST_DATA] Latest date: ${latestDate}, Previous date with data: ${previousDate}`);

    const commonIncludeCoin = {
      model: Coin,
      as: 'coin',
      attributes: ['id', 'symbol', 'name', 'current_price', 'logo_url']
    };

    const latestDayMetrics = await DailyMetric.findAll({
      where: latestVersionWhere,
      include: [commonIncludeCoin]
    });
    // console.log(`[LATEST_DATA] Found ${latestDayMetrics.length} metrics for ${latestDate}.`);

    let previousDayMetricsMap = new Map();
    if (previousDate) {
      const previousVersion = await getLatestMetricVersionForDate(previousDate);
      const previousDayMetricsRaw = await DailyMetric.findAll({
        where: buildDateVersionWhere(previousDate, previousVersion),
        // attributes: ['coin_id', 'otc_index', 'explosion_index', 'schelling_point'] // 只取需要对比的字段
      });
      // console.log(`[LATEST_DATA] Found ${previousDayMetricsRaw.length} metrics for ${previousDate}.`);
      previousDayMetricsRaw.forEach(metric => {
        previousDayMetricsMap.set(metric.coin_id, metric);
      });
    }

    const metricsWithComparison = latestDayMetrics.map(currentMetric => {
      const prevMetrics = previousDayMetricsMap.get(currentMetric.coin_id);
      return {
        id: currentMetric.id,
        coin_id: currentMetric.coin_id,
        date: currentMetric.date,
        otc_index: currentMetric.otc_index,
        explosion_index: currentMetric.explosion_index,
        schelling_point: currentMetric.schelling_point,
        entry_exit_type: currentMetric.entry_exit_type,
        entry_exit_day: currentMetric.entry_exit_day,
        near_threshold: currentMetric.near_threshold,
        momentum_indicators: currentMetric.momentum_indicators,
        timestamp: currentMetric.timestamp,
        time_precision: currentMetric.time_precision,
        coin: currentMetric.coin, // 包含完整的 coin 对象
        previous_day_data: prevMetrics ? {
          date: prevMetrics.date,
          otc_index: prevMetrics.otc_index,
          explosion_index: prevMetrics.explosion_index,
          schelling_point: prevMetrics.schelling_point,
          // ...可以添加更多前一天字段
        } : null,
        otc_index_change_percent: prevMetrics ? calculateChangePercent(currentMetric.otc_index, prevMetrics.otc_index) : null,
        explosion_index_change_percent: prevMetrics ? calculateChangePercent(currentMetric.explosion_index, prevMetrics.explosion_index) : null,
        period_quality: '数据不足', // 默认为数据不足
        risk_notes: buildPeriodRiskNotes(currentMetric),
      };
    });

    // 为每个指标异步计算周期质量
    await Promise.all(metricsWithComparison.map(async (metric) => {
        const calculatedQuality = await calculatePeriodQuality(metric.coin_id);
        metric.period_quality = calculatedQuality;
    }));

    const latestHistoryMap = await getRecentMetricHistoryMap(
      metricsWithComparison.map(metric => metric.coin_id),
      latestDate
    );
    metricsWithComparison.forEach(metric => {
      metric.strategy_signal = evaluateStrategySignal(buildStrategyInput(
        metric,
        latestHistoryMap.get(metric.coin_id) || []
      ));
    });

    let liquidity = await LiquidityOverview.findOne({
      where: buildDateVersionWhere(latestDate, latestMetricDateEntry),
      order: [['timestamp', 'DESC'], ['id', 'DESC']],
    });
    if (!liquidity) {
      liquidity = await LiquidityOverview.findOne({
        where: { date: latestDate },
        order: [['timestamp', 'DESC'], ['id', 'DESC']],
      });
    }

    let optionTuning = null;
    if (OptionTuning) {
      optionTuning = await OptionTuning.findOne({
        where: buildDateVersionWhere(latestDate, latestMetricDateEntry),
        order: [['timestamp', 'DESC'], ['id', 'DESC']],
      });
      if (!optionTuning) {
        optionTuning = await OptionTuning.findOne({
          where: { date: latestDate },
          order: [['timestamp', 'DESC'], ['id', 'DESC']],
        });
      }
    }

    let trendingCoinsRaw = await TrendingCoin.findAll({
      where: buildDateVersionWhere(latestDate, latestMetricDateEntry),
      order: [['timestamp', 'DESC'], ['symbol', 'ASC']],
    });
    if (trendingCoinsRaw.length === 0) {
      trendingCoinsRaw = await TrendingCoin.findAll({
        where: { date: latestDate },
        order: [['timestamp', 'DESC'], ['symbol', 'ASC']],
      });
    }
    // console.log(`[LATEST_DATA] Found ${trendingCoinsRaw.length} trending coins for ${latestDate}.`);
    
    // 确保 trendingCoins 也包含 coin 详细信息（如果前端需要）和变化百分比
    // 这需要 TrendingCoin 模型与 Coin 关联，或者在此处额外查询 Coin 信息
    // 为了简化，这里假设前端可以直接使用 TrendingCoin 的原始数据或其symbol
    // 如果需要像 metrics 那样详细，则需要对 trendingCoins 做类似的处理
    const trendingCoins = trendingCoinsRaw.map(tc => {
        // 查找对应的 Coin 信息 (如果 trendingCoin 没有直接关联)
        // const coinInfo = metricsWithComparison.find(m => m.coin.symbol === tc.symbol)?.coin;
        // const prevTrendData = ... // 如果热点币也有历史对比
        return {
            ...tc.toJSON(), // 包含id, date, symbol, otc_index等
            // coin: coinInfo, // 可选
            // otc_index_change_percent: ..., // 可选
        };
    });


    res.json({
      success: true,
      date: latestDate,
      metrics: metricsWithComparison,
      liquidity: liquidity || null, // 确保是 null 如果未找到
      optionTuning: serializeOptionTuning(optionTuning),
      trendingCoins: trendingCoins,
    });

  } catch (error) {
    console.error('[LATEST_DATA] Error fetching latest data:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch latest data', details: error.message });
  }
});


function formatProbability(probability) {
  return `${(probability * 100).toFixed(1)}%`;
}

const ENTRY_DIP_WEAKENING_THRESHOLD_PERCENT = -5;
const ENTRY_RECOVERY_NEAR_START_THRESHOLD_PERCENT = -2;
const ENTRY_HIGH_QUALITY_KEY_NODE_MIN_CHANGE_PERCENT = 5;

function hasIncompleteEntryStart(metric) {
  const entryExitDay = Number(metric?.entry_exit_day);
  return Number.isFinite(entryExitDay) && entryExitDay > 1;
}

function isMetricAfterNode(metric, nodeDate) {
  if (!metric?.date || !nodeDate) {
    return false;
  }

  return new Date(metric.date) > new Date(nodeDate);
}

function findConfirmedRecoveryDipComparisons(comparisons, weakDipComparison, targetMetric) {
  if (!weakDipComparison || !targetMetric?.date) {
    return [];
  }

  const weakDipDate = new Date(weakDipComparison.toDate);
  const targetDate = new Date(targetMetric.date);

  return comparisons.filter((comparison) =>
    comparison.fromRole === 'after'
    && comparison.toRole === 'after'
    && new Date(comparison.fromDate) >= weakDipDate
    && new Date(comparison.toDate) <= targetDate
  );
}

function hasConfirmedHighQualityRecovery(comparisons, weakDipComparison, targetMetric, entryStartOtcIndex) {
  const recoveryDipComparisons = findConfirmedRecoveryDipComparisons(comparisons, weakDipComparison, targetMetric);

  return recoveryDipComparisons.length >= 2
    && recoveryDipComparisons.every((comparison) =>
      Number.isFinite(comparison.changePercent)
      && comparison.changePercent >= ENTRY_HIGH_QUALITY_KEY_NODE_MIN_CHANGE_PERCENT
      && Number(comparison.toOtcIndex) >= entryStartOtcIndex
    );
}

function hasWeakRecoveryKeyNode(comparisons, weakDipComparison, targetMetric) {
  const recoveryDipComparisons = findConfirmedRecoveryDipComparisons(comparisons, weakDipComparison, targetMetric);

  return recoveryDipComparisons.some((comparison) =>
    Number.isFinite(comparison.changePercent)
    && comparison.changePercent < ENTRY_HIGH_QUALITY_KEY_NODE_MIN_CHANGE_PERCENT
  );
}

function classifyEntryRecoveryAfterWeakDip(targetMetric, latestDipComparison, entryStartOtcIndex, comparisons = []) {
  if (
    !targetMetric
    || !latestDipComparison
    || !Number.isFinite(latestDipComparison.changePercent)
    || latestDipComparison.changePercent > ENTRY_DIP_WEAKENING_THRESHOLD_PERCENT
    || !isMetricAfterNode(targetMetric, latestDipComparison.toDate)
  ) {
    return null;
  }

  const targetOtcIndex = Number(targetMetric.otc_index);
  const recoveredFromDipNode = targetOtcIndex >= Number(latestDipComparison.toOtcIndex);
  const changeFromEntryStart = calculateChangePercent(targetOtcIndex, entryStartOtcIndex);
  const recoveredNearEntryStart = Number.isFinite(changeFromEntryStart)
    && changeFromEntryStart >= ENTRY_RECOVERY_NEAR_START_THRESHOLD_PERCENT;

  if (!recoveredFromDipNode || !recoveredNearEntryStart) {
    return '低质量进场';
  }

  if (hasWeakRecoveryKeyNode(comparisons, latestDipComparison, targetMetric)) {
    return '低质量进场';
  }

  if (targetOtcIndex >= entryStartOtcIndex
    && hasConfirmedHighQualityRecovery(comparisons, latestDipComparison, targetMetric, entryStartOtcIndex)
  ) {
    return '高质量进场';
  }

  return '修复型进场';
}

function findLatestWeakEntryDipComparison(comparisons, targetMetric) {
  return [...comparisons].reverse().find(comparison =>
    comparison.toRole === 'after'
    && Number.isFinite(comparison.changePercent)
    && comparison.changePercent <= ENTRY_DIP_WEAKENING_THRESHOLD_PERCENT
    && isMetricAfterNode(targetMetric, comparison.toDate)
  );
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

function getLatestEntryKeyMetric(comparisons, targetMetric) {
  const latestAfterComparison = [...comparisons].reverse().find((comparison) =>
    comparison.toRole === 'after'
  );

  if (!latestAfterComparison) {
    return targetMetric;
  }

  return {
    ...targetMetric,
    date: latestAfterComparison.toDate,
    otc_index: latestAfterComparison.toOtcIndex,
  };
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
      `后半段均值=${firstWeekRisk.lateAverage.toFixed(2)} -> 低质量进场（需调仓）`
    );
    return '低质量进场（需调仓）';
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

  const effectiveTargetMetric = getLatestEntryKeyMetric(comparisonsForTarget, targetMetric);

  logKeyNodeComparisons(coinId, comparisonsForTarget);

  const weakDipComparison = findLatestWeakEntryDipComparison(comparisonsForTarget, effectiveTargetMetric);
  const weakDipRecoveryQuality = classifyEntryRecoveryAfterWeakDip(effectiveTargetMetric, weakDipComparison, entryStartOtcIndex, comparisonsForTarget);
  if (weakDipRecoveryQuality) {
    if (weakDipRecoveryQuality !== '低质量进场') {
      console.log(
        `[QualityCheck] CoinID ${coinId}: Entry recovered after weak dip, target=${effectiveTargetMetric.date}` +
        `(${effectiveTargetMetric.otc_index}/${effectiveTargetMetric.explosion_index}) -> ${weakDipRecoveryQuality}`
      );
    }
    return weakDipRecoveryQuality;
  }

  const latestDipComparison = [...comparisonsForTarget].reverse().find(comparison => comparison.toRole === 'after');
  if (
    latestDipComparison
    && Number.isFinite(latestDipComparison.changePercent)
    && latestDipComparison.changePercent <= ENTRY_DIP_WEAKENING_THRESHOLD_PERCENT
  ) {
    console.log(
      `[QualityCheck] CoinID ${coinId}: Latest entry dip node weakened, ` +
      `${latestDipComparison.fromDate}(${latestDipComparison.fromOtcIndex}) -> ` +
      `${latestDipComparison.toDate}(${latestDipComparison.toOtcIndex}) -> 低质量进场`
    );
    return '低质量进场';
  }

  const bayesianQuality = scoreBayesianPeriodQuality({
    phase: 'entry',
    comparisons: comparisonsForTarget,
  });

  console.log(
    `[QualityCheck] CoinID ${coinId}: Entry Bayesian quality=${bayesianQuality.label}, ` +
    `probability=${formatProbability(bayesianQuality.probability)}`
  );

  return bayesianQuality.label;
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

  const bayesianQuality = scoreBayesianPeriodQuality({
    phase: 'exit',
    comparisons,
  });

  console.log(
    `[QualityCheck] CoinID ${coinId}: Exit Bayesian quality=${bayesianQuality.label}, ` +
    `probability=${formatProbability(bayesianQuality.probability)}`
  );

  return bayesianQuality.label;
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


// --- 路由：导出所有数据 ---
router.get('/export-all', async (req, res) => {
  try {
    console.log('[EXPORT_DB] Request received to export all database data.');
    res.setTimeout(300000); // 5分钟超时，以防数据量过大

    const [
        allCoinsInfo,
        allHistoricalMetricsRaw,
        allLiquidityHistory,
        allOptionTunings,
        allTrendingCoinsHistory,
        dateRange
    ] = await Promise.all([
        Coin.findAll({ order: [['symbol', 'ASC']] }),
        DailyMetric.findAll({ include: [{ model: Coin, as: 'coin', attributes: ['symbol'] }], order: [['date', 'DESC'], ['coin_id', 'ASC']] }),
        LiquidityOverview.findAll({ order: [['date', 'DESC']] }),
        OptionTuning ? OptionTuning.findAll({ order: [['date', 'DESC'], ['timestamp', 'DESC'], ['id', 'DESC']] }) : [],
        TrendingCoin.findAll({ order: [['date', 'DESC'], ['symbol', 'ASC']] }),
        DailyMetric.findOne({
            attributes: [
                [sequelize.fn('MIN', sequelize.col('date')), 'startDate'],
                [sequelize.fn('MAX', sequelize.col('date')), 'endDate'],
            ],
            raw: true,
        })
    ]);
    // console.log(`[EXPORT_DB] Fetched ${allCoinsInfo.length} coins, ${allHistoricalMetricsRaw.length} metrics, ${allLiquidityHistory.length} liquidity, ${allTrendingCoinsHistory.length} trending.`);

    // 获取最新处理过的数据 (复用 /latest 的逻辑会更好，但这里为了导出独立性重新获取)
    // 这里简化处理，实际应用中可以调用一个内部函数来获取 latestProcessedData
    let latestProcessedData = null;
    if (dateRange && dateRange.endDate) {
        // 简单的模拟 /latest 的输出结构，实际中应更精确
        const latestMetricsForExport = allHistoricalMetricsRaw.filter(m => m.date === dateRange.endDate);
        const latestLiquidityForExport = allLiquidityHistory.find(l => l.date === dateRange.endDate);
        const latestOptionTuningForExport = allOptionTunings.find(t => t.date === dateRange.endDate);
        const latestTrendingForExport = allTrendingCoinsHistory.filter(t => t.date === dateRange.endDate);
        latestProcessedData = {
            date: dateRange.endDate,
            metrics: latestMetricsForExport.map(m => ({ ...m.toJSON(), coin: m.coin.toJSON() })), // 确保 coin 被正确序列化
            liquidity: latestLiquidityForExport || null,
            optionTuning: serializeOptionTuning(latestOptionTuningForExport),
            trendingCoins: latestTrendingForExport,
        };
    }
    
    // 准备用于图表的历史数据 (示例：最近30天的主流币种)
    // 实际应用中可以更灵活地配置哪些币种和多长时间的数据
    const historicalChartData = {};
    const chartSymbols = ['BTC', 'ETH', 'BNB', 'SOL']; // 示例
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

    for (const symbol of chartSymbols) {
        const coin = allCoinsInfo.find(c => c.symbol === symbol);
        if (coin) {
            const metricsForSymbol = allHistoricalMetricsRaw
                .filter(m => m.coin_id === coin.id && m.date >= thirtyDaysAgoStr)
                .sort((a,b) => new Date(a.date) - new Date(b.date)) // 确保按日期升序
                .map(m => ({ // 转换为前端图表期望的格式
                    date: m.date,
                    otc_index: m.otc_index,
                    explosion_index: m.explosion_index,
                    schelling_point: m.schelling_point,
                    entry_exit_type: m.entry_exit_type,
                    entry_exit_day: m.entry_exit_day,
                }));
            if (metricsForSymbol.length > 0) {
                historicalChartData[symbol] = metricsForSymbol;
            }
        }
    }


    const exportData = {
      metadata: {
        exportDate: new Date().toISOString(),
        appVersion: process.env.APP_VERSION || '1.0.0', // 从环境变量获取版本
        dataRangeStart: dateRange ? dateRange.startDate : null,
        dataRangeEnd: dateRange ? dateRange.endDate : null,
      },
      allCoinsInfo,
      allHistoricalMetricsRaw,
      allLiquidityHistory,
      allOptionTunings,
      allTrendingCoinsHistory,
      latestProcessedData: latestProcessedData || {}, // 确保有默认值
      historicalChartData,
    };

    res.json(exportData);
    console.log('[EXPORT_DB] All data export completed.');

  } catch (error) {
    console.error('[EXPORT_DB] Error exporting database data:', error);
    res.status(500).json({ success: false, error: 'Failed to export database data', details: error.message });
  }
});


// --- 路由：批量导入数据库备份数据 ---
router.post('/import-database', async (req, res) => {
  const dumpData = req.body;
  if (!dumpData || typeof dumpData !== 'object' || !dumpData.metadata || !Array.isArray(dumpData.allCoinsInfo) || !Array.isArray(dumpData.allHistoricalMetricsRaw)) {
    console.error('[IMPORT_DB] Invalid database dump format. Missing required root fields or arrays.');
    return res.status(400).json({ success: false, error: 'Invalid database dump format. Required fields (metadata, allCoinsInfo, allHistoricalMetricsRaw) missing or not arrays.' });
  }

  console.log(`[IMPORT_DB] Received database import request. Export Date: ${dumpData.metadata.exportDate}, App Version: ${dumpData.metadata.appVersion}`);
  const transaction = await sequelize.transaction();

  try {
    let counts = { coins: 0, metrics: 0, liquidity: 0, optionTunings: 0, trending: 0 };

    // 1. 导入/更新 Coins
    if (dumpData.allCoinsInfo.length > 0) {
      console.log(`[IMPORT_DB] Processing ${dumpData.allCoinsInfo.length} coins...`);
      for (const cData of dumpData.allCoinsInfo) {
        if (!cData || !cData.symbol) { console.warn('[IMPORT_DB] Skipping coin with no symbol.'); continue; }
        const symbolUpper = cData.symbol.toUpperCase();
        const coinPayload = {
          symbol: symbolUpper,
          name: cData.name || symbolUpper,
          current_price: typeof cData.current_price === 'number' ? cData.current_price : null,
          logo_url: cData.logo_url || null,
          // 保留其他 Coin 模型字段，如果 dumpData 中有的话
          circulating_supply: typeof cData.circulating_supply === 'number' ? cData.circulating_supply : null,
          market_cap: typeof cData.market_cap === 'number' ? cData.market_cap : null,
          // ... etc.
        };
        const [instance, created] = await Coin.findOrCreate({ where: { symbol: symbolUpper }, defaults: coinPayload, transaction });
        if (!created) await instance.update(coinPayload, { transaction });
        counts.coins++;
      }
    }

    // 获取最新的 Coin ID 映射
    const coinSymbolToIdMap = new Map(
        (await Coin.findAll({ attributes: ['id', 'symbol'], transaction })).map(c => [c.symbol.toUpperCase(), c.id])
    );
    console.log(`[IMPORT_DB] Coin map created with ${coinSymbolToIdMap.size} entries.`);

    // 2. 导入/更新 DailyMetrics
    if (dumpData.allHistoricalMetricsRaw.length > 0) {
      console.log(`[IMPORT_DB] Processing ${dumpData.allHistoricalMetricsRaw.length} metrics...`);
      for (const mData of dumpData.allHistoricalMetricsRaw) {
        if (!mData || !mData.date) { console.warn('[IMPORT_DB] Skipping metric with no date.'); continue; }
        const coinSymbol = mData.coin?.symbol?.toUpperCase() || mData.symbol?.toUpperCase(); // 兼容旧的dump可能没有嵌套coin
        const coinId = coinSymbol ? coinSymbolToIdMap.get(coinSymbol) : mData.coin_id;

        if (!coinId) { console.warn(`[IMPORT_DB] Skipping metric for unknown coin (symbol: ${coinSymbol}, date: ${mData.date}).`); continue; }
        
        // 解析时间信息
        const metricTimeInfo = parseRecordTime(mData.date, mData.timestamp, mData.time_precision || mData.timePrecision);

        const metricPayload = {
          coin_id: coinId,
          date: metricTimeInfo.date,
          timestamp: metricTimeInfo.timestamp,
          time_precision: metricTimeInfo.precision,
          otc_index: typeof mData.otc_index === 'number' ? mData.otc_index : null,
          explosion_index: typeof mData.explosion_index === 'number' ? mData.explosion_index : null,
          schelling_point: typeof mData.schelling_point === 'number' ? mData.schelling_point : null,
          entry_exit_type: mData.entry_exit_type || 'neutral',
          entry_exit_day: typeof mData.entry_exit_day === 'number' ? mData.entry_exit_day : 0,
          near_threshold: !!mData.near_threshold,
          momentum_indicators: serializeMomentumIndicators(mData.momentum_indicators || mData.momentumIndicators),
        };
        const [instance, created] = await DailyMetric.findOrCreate({ where: buildVersionWhere({ coin_id: coinId }, metricTimeInfo), defaults: metricPayload, transaction });
        if (!created) await instance.update(metricPayload, { transaction });
        counts.metrics++;
      }
    }

    // 3. 导入/更新 LiquidityOverview
    if (Array.isArray(dumpData.allLiquidityHistory) && dumpData.allLiquidityHistory.length > 0) {
        console.log(`[IMPORT_DB] Processing ${dumpData.allLiquidityHistory.length} liquidity entries...`);
        for (const lData of dumpData.allLiquidityHistory) {
            if (!lData || !lData.date) { console.warn('[IMPORT_DB] Skipping liquidity entry with no date.'); continue; }
            // 解析时间信息
            const liquidityTimeInfo = parseRecordTime(lData.date, lData.timestamp, lData.time_precision || lData.timePrecision);

            const liquidityPayload = {
                date: liquidityTimeInfo.date,
                timestamp: liquidityTimeInfo.timestamp,
                time_precision: liquidityTimeInfo.precision,
                btc_fund_change: typeof lData.btc_fund_change === 'number' ? lData.btc_fund_change : null,
                eth_fund_change: typeof lData.eth_fund_change === 'number' ? lData.eth_fund_change : null,
                sol_fund_change: typeof lData.sol_fund_change === 'number' ? lData.sol_fund_change : null,
                total_market_fund_change: typeof lData.total_market_fund_change === 'number' ? lData.total_market_fund_change : null,
                comments: lData.comments || null,
            };
            const [instance, created] = await LiquidityOverview.findOrCreate({ where: buildVersionWhere({}, liquidityTimeInfo), defaults: liquidityPayload, transaction });
            if (!created) await instance.update(liquidityPayload, { transaction });
            counts.liquidity++;
        }
    }

    // 4. 导入/更新 OptionTunings
    if (OptionTuning && Array.isArray(dumpData.allOptionTunings) && dumpData.allOptionTunings.length > 0) {
        console.log(`[IMPORT_DB] Processing ${dumpData.allOptionTunings.length} option tuning entries...`);
        for (const optionData of dumpData.allOptionTunings) {
            if (!optionData || !optionData.date) { console.warn('[IMPORT_DB] Skipping option tuning entry with no date.'); continue; }
            const optionTimeInfo = parseRecordTime(optionData.date, optionData.timestamp, optionData.time_precision || optionData.timePrecision);
            const normalizedOptionTuning = normalizeOptionTuning(optionData);
            if (!normalizedOptionTuning) { console.warn('[IMPORT_DB] Skipping empty option tuning entry.'); continue; }

            const optionTuningPayload = {
                date: optionTimeInfo.date,
                timestamp: optionTimeInfo.timestamp,
                time_precision: optionTimeInfo.precision,
                ...normalizedOptionTuning,
            };
            const [instance, created] = await OptionTuning.findOrCreate({ where: buildVersionWhere({}, optionTimeInfo), defaults: optionTuningPayload, transaction });
            if (!created) await instance.update(optionTuningPayload, { transaction });
            counts.optionTunings++;
        }
    }

    // 5. 导入/更新 TrendingCoins
    if (Array.isArray(dumpData.allTrendingCoinsHistory) && dumpData.allTrendingCoinsHistory.length > 0) {
        console.log(`[IMPORT_DB] Processing ${dumpData.allTrendingCoinsHistory.length} trending coin entries...`);
        for (const tData of dumpData.allTrendingCoinsHistory) {
            if (!tData || !tData.date || !tData.symbol) { console.warn('[IMPORT_DB] Skipping trending coin with no date or symbol.'); continue; }
            const symbolUpper = tData.symbol.toUpperCase();
            // 解析时间信息
            const trendTimeInfo = parseRecordTime(tData.date, tData.timestamp, tData.time_precision || tData.timePrecision);

            const trendPayload = {
                date: trendTimeInfo.date,
                timestamp: trendTimeInfo.timestamp,
                time_precision: trendTimeInfo.precision,
                symbol: symbolUpper,
                otc_index: typeof tData.otc_index === 'number' ? tData.otc_index : null,
                explosion_index: typeof tData.explosion_index === 'number' ? tData.explosion_index : null,
                schelling_point: typeof tData.schelling_point === 'number' ? tData.schelling_point : null,
                entry_exit_type: tData.entry_exit_type || 'neutral',
                entry_exit_day: typeof tData.entry_exit_day === 'number' ? tData.entry_exit_day : 0,
            };
            const [instance, created] = await TrendingCoin.findOrCreate({ where: buildVersionWhere({ symbol: symbolUpper }, trendTimeInfo), defaults: trendPayload, transaction });
            if (!created) await instance.update(trendPayload, { transaction });
            counts.trending++;
        }
    }

    await transaction.commit();
    console.log('[IMPORT_DB] Database import successful. Transaction committed.');
    res.json({
      success: true,
      message: 'Database imported successfully.',
      summary: counts
    });

  } catch (error) {
    if (transaction && !transaction.finished && transaction.connection) { // Check if connection exists before rollback
        try {
            await transaction.rollback();
            console.log("[IMPORT_DB] Transaction rolled back due to error.");
        } catch (rollbackError) {
            console.error("[IMPORT_DB] Transaction rollback failed:", rollbackError);
        }
    }
    console.error('[IMPORT_DB] Error during database import:', error);
    res.status(500).json({ success: false, error: 'Failed to import database', details: error.message, stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined });
  }
});


// --- 路由：按日期获取数据 ---
router.get('/by-date/:date', async (req, res) => {
  try {
    const { date } = req.params;
    console.log(`[BY_DATE] Request received for date: ${date}`);

    // 验证日期格式
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format. Expected YYYY-MM-DD'
      });
    }

    const dateVersions = await DailyMetric.findAll({
      where: { date },
      attributes: [
        'date',
        'timestamp',
        'time_precision',
        [sequelize.fn('COUNT', sequelize.col('id')), 'metricsCount'],
      ],
      group: ['date', 'timestamp', 'time_precision'],
      order: [['timestamp', 'ASC']],
      raw: true,
    });
    const selectedVersion = dateVersions[dateVersions.length - 1] || null;

    // 获取指定日期最新版本的所有币种数据
    const metricsForDate = await DailyMetric.findAll({
      where: buildDateVersionWhere(date, selectedVersion),
      include: [{
        model: Coin,
        as: 'coin',
        attributes: ['id', 'symbol', 'name', 'current_price', 'logo_url']
      }],
      order: [['coin_id', 'ASC']]
    });

    if (metricsForDate.length === 0) {
      return res.status(404).json({
        success: false,
        error: `No data found for date ${date}`
      });
    }

    // 获取前一个有数据的日期用于对比
    const previousDateStr = await getPreviousDateWithData(date);

    let previousMetrics = [];
    if (previousDateStr) {
      const previousVersion = await getLatestMetricVersionForDate(previousDateStr);
      previousMetrics = await DailyMetric.findAll({
        where: buildDateVersionWhere(previousDateStr, previousVersion),
        include: [{
          model: Coin,
          as: 'coin',
          attributes: ['id', 'symbol']
        }]
      });
    }

    // 创建前一天数据的映射
    const previousDataMap = {};
    previousMetrics.forEach(metric => {
      previousDataMap[metric.coin.symbol] = metric;
    });

    // 处理数据，添加变化百分比和完整质量判断
    const processedCoins = await Promise.all(metricsForDate.map(async (metric) => {
      const coin = metric.coin;
      const previousData = previousDataMap[coin.symbol];

      // 计算变化百分比
      const otcChangePercent = previousData ?
        calculateChangePercent(metric.otc_index, previousData.otc_index) : null;
      const explosionChangePercent = previousData ?
        calculateChangePercent(metric.explosion_index, previousData.explosion_index) : null;

      // 计算完整的历史质量判断
      let periodQuality = '数据不足';
      let historicalMetrics = [];
      try {
        // 获取该币种截止到指定日期的历史数据
        historicalMetrics = await DailyMetric.findAll({
          where: {
            coin_id: coin.id,
            date: { [Op.lte]: date } // 只使用指定日期及之前的数据
          },
          order: [['date', 'DESC'], ['timestamp', 'DESC'], ['id', 'DESC']],
          limit: QUALITY_LOOKBACK_DAYS,
          raw: true
        });

        if (historicalMetrics.length >= 2) {
          // 使用完整的质量判断算法，但基于历史数据
          periodQuality = await calculatePeriodQualityForDate(coin.id, date, historicalMetrics);
        }
      } catch (error) {
        console.error(`[BY_DATE] Error calculating quality for coin ${coin.id}:`, error);
        periodQuality = '计算出错';
      }

      const previousDayData = previousData ? {
        otc_index: previousData.otc_index,
        explosion_index: previousData.explosion_index,
        schelling_point: previousData.schelling_point,
        date: previousData.date
      } : null;

      return attachStrategySignal({
        id: coin.id,
        symbol: coin.symbol,
        name: coin.name,
        current_price: coin.current_price,
        logo_url: coin.logo_url,
        otcIndex: metric.otc_index,
        explosionIndex: metric.explosion_index,
        schellingPoint: metric.schelling_point,
        entryExitType: metric.entry_exit_type,
        entryExitDay: metric.entry_exit_day,
        nearThreshold: metric.near_threshold,
        momentumIndicators: normalizeMomentumIndicators(metric.momentum_indicators),
        date: metric.date,
        timestamp: metric.timestamp,
        timePrecision: metric.time_precision,
        // 变化数据
        previousDay: previousData ? {
          otcIndex: previousData.otc_index,
          explosionIndex: previousData.explosion_index,
          date: previousData.date
        } : null,
        previousDayData: previousDayData,
        otcChangePercent,
        explosionChangePercent,
        // 完整的质量判断
        period_quality: periodQuality,
        risk_notes: buildPeriodRiskNotes(metric)
      }, historicalMetrics);
    }));

    // 获取流动性概况
    const liquidityOverview = await LiquidityOverview.findOne({
      where: buildDateVersionWhere(date, selectedVersion),
      order: [['timestamp', 'DESC'], ['id', 'DESC']]
    });

    const optionTuning = OptionTuning ? await OptionTuning.findOne({
      where: buildDateVersionWhere(date, selectedVersion),
      order: [['timestamp', 'DESC'], ['id', 'DESC']]
    }) : null;

    // 获取热门币种
    const trendingCoins = await TrendingCoin.findAll({
      where: buildDateVersionWhere(date, selectedVersion),
      order: [['symbol', 'ASC']]
    });

    const response = {
      success: true,
      date,
      selectedVersion,
      dateVersions,
      previousDate: previousDateStr,
      coins: processedCoins,
      liquidityOverview,
      optionTuning: serializeOptionTuning(optionTuning),
      trendingCoins,
      totalCoins: processedCoins.length
    };

    console.log(`[BY_DATE] Successfully returned ${processedCoins.length} coins for date ${date}`);
    res.json(response);

  } catch (error) {
    console.error('[BY_DATE] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Error fetching data for date',
      details: error.message
    });
  }
});

router.get('/available-dates', async (req, res) => {
  try {
    const dateRange = await DailyMetric.findOne({
      attributes: [
        [sequelize.fn('MIN', sequelize.col('date')), 'oldestDate'],
        [sequelize.fn('MAX', sequelize.col('date')), 'newestDate'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'totalMetricsCount'],
        [sequelize.fn('COUNT', sequelize.fn('DISTINCT', sequelize.col('date'))), 'distinctDatesCount'],
      ],
      raw: true,
    });

    const distinctDates = await DailyMetric.findAll({
      attributes: [[sequelize.fn('DISTINCT', sequelize.col('date')), 'date']],
      order: [['date', 'DESC']],
      raw: true,
    });

    const dates = distinctDates
      .map(item => item.date)
      .filter(date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date));

    res.json({
      success: true,
      oldestDate: dateRange?.oldestDate || null,
      newestDate: dateRange?.newestDate || null,
      totalMetricsCount: dateRange?.totalMetricsCount || 0,
      distinctDatesCount: dateRange?.distinctDatesCount || 0,
      dates,
    });
  } catch (error) {
    console.error('[AVAILABLE_DATES] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Error fetching available dates',
      details: error.message,
    });
  }
});

// --- 调试路由 ---
router.get('/debug/date-range', async (req, res) => {
  try {
    const dateRange = await DailyMetric.findOne({
      attributes: [
        [sequelize.fn('MIN', sequelize.col('date')), 'oldestDate'],
        [sequelize.fn('MAX', sequelize.col('date')), 'newestDate'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'totalMetricsCount'],
        [sequelize.fn('COUNT', sequelize.fn('DISTINCT', sequelize.col('date'))), 'distinctDatesCount'],
      ],
      raw: true,
    });
    const distinctDates = await DailyMetric.findAll({
      attributes: [[sequelize.fn('DISTINCT', sequelize.col('date')), 'date']],
      order: [['date', 'DESC']],
      raw: true,
    });

    res.json({
      success: true,
      ...dateRange,
      dates: distinctDates.map(d => d.date),
    });
  } catch (error) {
    console.error('[DEBUG_DATERANGE] Error:', error);
    res.status(500).json({ success: false, error: 'Error fetching date range', details: error.message });
  }
});

router.post('/debug/add-test-data', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ success: false, error: 'This endpoint is disabled in production' });
  }
  try {
    const today = new Date();
    const date = today.toISOString().split('T')[0];
    const testData = {
      date,
      coins: [
        { symbol: 'BTC', name: 'Bitcoin', otcIndex: 1627, explosionIndex: 195, schellingPoint: 98500, entryExitType: 'entry', entryExitDay: 26 },
        { symbol: 'ETH', name: 'Ethereum', otcIndex: 1430, explosionIndex: 180, schellingPoint: 1850, entryExitType: 'exit', entryExitDay: 105 },
      ],
      liquidity: { btcFundChange: 10, ethFundChange: 5, solFundChange: 2, totalMarketFundChange: 17, comments: "Test liquidity" },
      trendingCoins: [ { symbol: 'DOGE', date: date, otcIndex: 100, explosionIndex: 50 } ]
    };
    const result = await storeProcessedData(testData); // storeProcessedData now uses transactions
    res.json({ success: true, message: 'Test data added successfully', result });
  } catch (error) {
    console.error('[DEBUG_ADDTEST] Error adding test data:', error);
    res.status(500).json({ success: false, error: 'Failed to add test data', details: error.message });
  }
});

router.calculatePeriodQuality = calculatePeriodQuality;
router.__qualityTestUtils = {
  QUALITY_LOOKBACK_DAYS,
  buildKeyNodeComparisons,
  scoreBayesianPeriodQuality,
  calculatePeriodQualityForDate,
  normalizeMomentumIndicators,
  serializeMomentumIndicators,
  buildPeriodRiskNotes,
};
router.__optionTuningTestUtils = {
  normalizeOptionTuning,
  serializeOptionTuning,
  storeProcessedData,
};

module.exports = router;
