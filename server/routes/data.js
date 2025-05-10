// server/routes/data.js
const express = require('express');
const router = express.Router();
const db = require('../models');
const { Coin, DailyMetric, LiquidityOverview, TrendingCoin, sequelize } = db; // 从 db 中获取 sequelize
const { Op } = require('sequelize');

const openaiService = require('../services/openaiService');

// --- 辅助函数：计算百分比变化 ---
function calculateChangePercent(current, previous) {
  if (typeof current !== 'number' || typeof previous !== 'number') return null;
  if (previous === 0) {
    return current === 0 ? 0 : Infinity; // 从0到非0是无限大，0到0是0%
  }
  return ((current - previous) / previous) * 100;
}

// --- 路由：处理原始数据输入并存储 ---
router.post('/input', async (req, res) => {
  const { rawData } = req.body;
  if (!rawData || typeof rawData !== 'string' || rawData.trim() === '') {
    return res.status(400).json({ success: false, error: 'Raw data is required and must be a non-empty string' });
  }

  console.log(`[DATA_INPUT] Received raw data input request, length: ${rawData.length}`);

  try {
    console.log('[DATA_INPUT] Calling OpenAI to process data...');
    const processedData = await openaiService.processRawData(rawData);
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
    const result = await storeProcessedData(processedData);
    console.log('[DATA_INPUT] Data storage complete.');

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
    res.status(500).json({
      success: false,
      error: 'Error processing or storing data',
      details: processingError.message,
      stack: process.env.NODE_ENV !== 'production' ? processingError.stack : undefined
    });
  }
});

// --- 辅助函数：存储 OpenAI 处理后的数据 ---
async function storeProcessedData(data) {
  console.log('======== [STORE_DATA] STARTING DATA STORAGE ========');
  // console.log('[STORE_DATA] Received data:', JSON.stringify(data, null, 2));

  const { date, coins = [], liquidity, trendingCoins = [] } = data;
  const storageResult = { coins: [], liquidityUpdated: false, trendingCoins: [] };
  const transaction = await sequelize.transaction(); // 使用事务

  try {
    console.log(`[STORE_DATA] Processing data for date: ${date}`);
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
          date: date,
          otc_index: typeof coinData.otcIndex === 'number' ? coinData.otcIndex : null,
          explosion_index: typeof coinData.explosionIndex === 'number' ? coinData.explosionIndex : null,
          schelling_point: typeof coinData.schellingPoint === 'number' ? coinData.schellingPoint : null,
          entry_exit_type: coinData.entryExitType || 'neutral',
          entry_exit_day: typeof coinData.entryExitDay === 'number' ? coinData.entryExitDay : 0,
          near_threshold: !!coinData.nearThreshold
        };
        // console.log('[STORE_DATA] Metric payload:', JSON.stringify(metricPayload, null, 2));

        const [metricInstance, metricCreated] = await DailyMetric.findOrCreate({
          where: { coin_id: coinInstance.id, date: date },
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
        date: date,
        btc_fund_change: typeof liquidity.btcFundChange === 'number' ? liquidity.btcFundChange : null,
        eth_fund_change: typeof liquidity.ethFundChange === 'number' ? liquidity.ethFundChange : null,
        sol_fund_change: typeof liquidity.solFundChange === 'number' ? liquidity.solFundChange : null,
        total_market_fund_change: typeof liquidity.totalMarketFundChange === 'number' ? liquidity.totalMarketFundChange : null,
        comments: liquidity.comments || null
      };
      const [liqInstance, liqCreated] = await LiquidityOverview.findOrCreate({
        where: { date: date },
        defaults: liquidityPayload,
        transaction
      });
      if (!liqCreated) {
        await liqInstance.update(liquidityPayload, { transaction });
      }
      storageResult.liquidityUpdated = true;
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
                date: date,
                symbol: trendSymbolUpper,
                otc_index: typeof trendData.otcIndex === 'number' ? trendData.otcIndex : null,
                explosion_index: typeof trendData.explosionIndex === 'number' ? trendData.explosionIndex : null,
                schelling_point: typeof trendData.schellingPoint === 'number' ? trendData.schellingPoint : null,
                entry_exit_type: trendData.entryExitType || 'neutral',
                entry_exit_day: typeof trendData.entryExitDay === 'number' ? trendData.entryExitDay : 0,
            };
            const [trendInstance, trendCreated] = await TrendingCoin.findOrCreate({
                where: { date: date, symbol: trendSymbolUpper },
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
    throw error; // 重新抛出错误，让上层处理
  }
}

// --- 辅助函数：获取前一天日期字符串 ---
function getPreviousDateString(dateString) {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null; // 无效日期处理
  date.setDate(date.getDate() - 1);
  return date.toISOString().split('T')[0];
}

// --- 路由：获取最新数据 (增强版，包含前一天对比和百分比变化) ---
router.get('/latest', async (req, res) => {
  try {
    console.log('[LATEST_DATA] Request received for latest data (enhanced).');

    const latestMetricDateEntry = await DailyMetric.findOne({
      attributes: ['date'],
      order: [['date', 'DESC']],
      raw: true, // 获取原始数据对象
    });

    if (!latestMetricDateEntry || !latestMetricDateEntry.date) {
      console.log('[LATEST_DATA] No metrics data found in database.');
      return res.status(404).json({ success: false, error: 'No metrics data found' });
    }

    const latestDate = latestMetricDateEntry.date;
    const previousDate = getPreviousDateString(latestDate);
    console.log(`[LATEST_DATA] Latest date: ${latestDate}, Previous date: ${previousDate}`);

    const commonIncludeCoin = {
      model: Coin,
      as: 'coin',
      attributes: ['id', 'symbol', 'name', 'current_price', 'logo_url']
    };

    const latestDayMetrics = await DailyMetric.findAll({
      where: { date: latestDate },
      include: [commonIncludeCoin]
    });
    // console.log(`[LATEST_DATA] Found ${latestDayMetrics.length} metrics for ${latestDate}.`);

    let previousDayMetricsMap = new Map();
    if (previousDate) {
      const previousDayMetricsRaw = await DailyMetric.findAll({
        where: { date: previousDate },
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
      };
    });

    const liquidity = await LiquidityOverview.findOne({ where: { date: latestDate } });
    const trendingCoinsRaw = await TrendingCoin.findAll({ where: { date: latestDate } });
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
      trendingCoins: trendingCoins,
    });

  } catch (error) {
    console.error('[LATEST_DATA] Error fetching latest data:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch latest data', details: error.message });
  }
});


// --- 路由：导出所有数据 ---
router.get('/export-all', async (req, res) => {
  try {
    console.log('[EXPORT_DB] Request received to export all database data.');
    res.setTimeout(300000); // 5分钟超时，以防数据量过大

    const [
        allCoinsInfo,
        allHistoricalMetricsRaw,
        allLiquidityHistory,
        allTrendingCoinsHistory,
        dateRange
    ] = await Promise.all([
        Coin.findAll({ order: [['symbol', 'ASC']] }),
        DailyMetric.findAll({ include: [{ model: Coin, as: 'coin', attributes: ['symbol'] }], order: [['date', 'DESC'], ['coin_id', 'ASC']] }),
        LiquidityOverview.findAll({ order: [['date', 'DESC']] }),
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
        const latestTrendingForExport = allTrendingCoinsHistory.filter(t => t.date === dateRange.endDate);
        latestProcessedData = {
            date: dateRange.endDate,
            metrics: latestMetricsForExport.map(m => ({ ...m.toJSON(), coin: m.coin.toJSON() })), // 确保 coin 被正确序列化
            liquidity: latestLiquidityForExport || null,
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
    let counts = { coins: 0, metrics: 0, liquidity: 0, trending: 0 };

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
        
        const metricPayload = {
          coin_id: coinId,
          date: mData.date,
          otc_index: typeof mData.otc_index === 'number' ? mData.otc_index : null,
          explosion_index: typeof mData.explosion_index === 'number' ? mData.explosion_index : null,
          schelling_point: typeof mData.schelling_point === 'number' ? mData.schelling_point : null,
          entry_exit_type: mData.entry_exit_type || 'neutral',
          entry_exit_day: typeof mData.entry_exit_day === 'number' ? mData.entry_exit_day : 0,
          near_threshold: !!mData.near_threshold,
        };
        const [instance, created] = await DailyMetric.findOrCreate({ where: { coin_id: coinId, date: mData.date }, defaults: metricPayload, transaction });
        if (!created) await instance.update(metricPayload, { transaction });
        counts.metrics++;
      }
    }

    // 3. 导入/更新 LiquidityOverview
    if (Array.isArray(dumpData.allLiquidityHistory) && dumpData.allLiquidityHistory.length > 0) {
        console.log(`[IMPORT_DB] Processing ${dumpData.allLiquidityHistory.length} liquidity entries...`);
        for (const lData of dumpData.allLiquidityHistory) {
            if (!lData || !lData.date) { console.warn('[IMPORT_DB] Skipping liquidity entry with no date.'); continue; }
            const liquidityPayload = {
                date: lData.date,
                btc_fund_change: typeof lData.btc_fund_change === 'number' ? lData.btc_fund_change : null,
                eth_fund_change: typeof lData.eth_fund_change === 'number' ? lData.eth_fund_change : null,
                sol_fund_change: typeof lData.sol_fund_change === 'number' ? lData.sol_fund_change : null,
                total_market_fund_change: typeof lData.total_market_fund_change === 'number' ? lData.total_market_fund_change : null,
                comments: lData.comments || null,
            };
            const [instance, created] = await LiquidityOverview.findOrCreate({ where: { date: lData.date }, defaults: liquidityPayload, transaction });
            if (!created) await instance.update(liquidityPayload, { transaction });
            counts.liquidity++;
        }
    }

    // 4. 导入/更新 TrendingCoins
    if (Array.isArray(dumpData.allTrendingCoinsHistory) && dumpData.allTrendingCoinsHistory.length > 0) {
        console.log(`[IMPORT_DB] Processing ${dumpData.allTrendingCoinsHistory.length} trending coin entries...`);
        for (const tData of dumpData.allTrendingCoinsHistory) {
            if (!tData || !tData.date || !tData.symbol) { console.warn('[IMPORT_DB] Skipping trending coin with no date or symbol.'); continue; }
            const symbolUpper = tData.symbol.toUpperCase();
            const trendPayload = {
                date: tData.date,
                symbol: symbolUpper,
                otc_index: typeof tData.otc_index === 'number' ? tData.otc_index : null,
                explosion_index: typeof tData.explosion_index === 'number' ? tData.explosion_index : null,
                schelling_point: typeof tData.schelling_point === 'number' ? tData.schelling_point : null,
                entry_exit_type: tData.entry_exit_type || 'neutral',
                entry_exit_day: typeof tData.entry_exit_day === 'number' ? tData.entry_exit_day : 0,
            };
            const [instance, created] = await TrendingCoin.findOrCreate({ where: { date: tData.date, symbol: symbolUpper }, defaults: trendPayload, transaction });
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

module.exports = router;