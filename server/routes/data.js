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
  classifyPeriodQuality,
} = require('../utils/periodQuality');
const { buildPeriodRiskNotes } = require('../utils/periodRiskNotes');
const { evaluateStrategySignal } = require('../utils/strategySignals');
const { requireAdmin } = require('../middleware/auth');

// 指标归一化/序列化/版本查询与持久化已抽至 utils/dailyMetrics
const {
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
} = require('../utils/dailyMetrics');

// --- 路由：处理原始数据输入并存储 ---
router.post('/input', requireAdmin, async (req, res) => {
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


// 进退场期质量评估已抽至 utils/periodQualityEvaluation，此处仅保留引入
const { calculatePeriodQuality, calculatePeriodQualityForDate } = require('../utils/periodQualityEvaluation');


// --- 路由：导出所有数据 ---
router.get('/export-all', requireAdmin, async (req, res) => {
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
router.post('/import-database', requireAdmin, async (req, res) => {
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
                // 导出侧一直带着 daily_reminder，导入侧漏掉会让「导出→导入」丢失全部每日提醒
                daily_reminder: lData.daily_reminder || null,
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

// --- 调试路由（仅管理员可用）---
router.get('/debug/date-range', requireAdmin, async (req, res) => {
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

router.post('/debug/add-test-data', requireAdmin, async (req, res) => {
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
  classifyPeriodQuality,
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
