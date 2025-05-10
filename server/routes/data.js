// server/routes/data.js
const express = require('express');
const router = express.Router();
const db = require('../models');
const { Coin, DailyMetric, LiquidityOverview, TrendingCoin } = db;
const { Op } = require('sequelize'); // 确保 Op 已导入

const openaiService = require('../services/openaiService');

// 处理原始数据输入并存储
router.post('/input', async (req, res) => {
  try {
    const { rawData } = req.body;
    
    if (!rawData) {
      return res.status(400).json({ error: 'Raw data is required' });
    }
    
    console.log('接收到原始数据输入请求，长度:', rawData.length);
    
    // 使用OpenAI处理原始数据
    try {
      console.log('开始调用OpenAI处理数据...');
      const processedData = await openaiService.processRawData(rawData);
      console.log('OpenAI处理完成，开始数据验证...');
      
      // 数据验证
      if (!processedData.date || !processedData.coins || !Array.isArray(processedData.coins)) {
        console.error('数据验证失败:', JSON.stringify(processedData, null, 2));
        return res.status(400).json({ 
          error: 'Invalid processed data structure', 
          details: 'Data must include date and coins array'
        });
      }
      
      // 存储处理后的数据
      console.log('开始将处理后的数据存入数据库...');
      const result = await storeProcessedData(processedData);
      console.log('数据存储完成');
      
      res.json({
        success: true,
        date: processedData.date,
        processed: {
          coins: result.coins.length,
          liquidityUpdated: result.liquidityUpdated,
          trendingCoins: result.trendingCoins.length
        }
      });
    } catch (processingError) {
      console.error('处理数据时出错:', processingError);
      res.status(500).json({ 
        error: 'Error processing data', 
        details: processingError.message 
      });
    }
  } catch (error) {
    console.error('数据输入路由错误:', error);
    res.status(500).json({ 
      error: 'Failed to process data',
      details: error.message
    });
  }
});

// 辅助函数：存储处理后的数据
async function storeProcessedData(data) {
  console.log('============ 开始存储数据 ============');
  console.log('处理数据:', JSON.stringify(data, null, 2));
  
  const { date, coins, liquidity, trendingCoins } = data;
  const result = { coins: [], liquidityUpdated: false, trendingCoins: [] };
  
  console.log('数据日期:', date);
  console.log('币种数量:', coins ? coins.length : 0);
  
  // 处理币种和指标数据
  for (const coinData of (coins || [])) {
    console.log(`\n处理币种: ${coinData.symbol}`);
    try {
      // 找到或创建币种
      console.log('尝试查找或创建币种');
      const [coin, coinCreated] = await Coin.findOrCreate({
        where: { symbol: coinData.symbol.toUpperCase() },
        defaults: {
          name: coinData.symbol.toUpperCase(),
          current_price: 0
        }
      });
      
      console.log(`币种 ${coin.symbol} ${coinCreated ? '已创建' : '已存在'}, ID: ${coin.id}`);
      
      // 准备日常指标数据
      const metricData = {
        coin_id: coin.id,
        date: date,
        otc_index: coinData.otcIndex,
        explosion_index: coinData.explosionIndex,
        schelling_point: coinData.schellingPoint,
        entry_exit_type: coinData.entryExitType,
        entry_exit_day: coinData.entryExitDay,
        near_threshold: !!coinData.nearThreshold
      };
      
      console.log('准备保存指标数据:', JSON.stringify(metricData, null, 2));
      
      // 查询是否已存在该日期的记录
      console.log(`查询是否已存在币种 ${coin.id} 在日期 ${date} 的记录`);
      const existingMetric = await DailyMetric.findOne({
        where: {
          coin_id: coin.id,
          date: date
        }
      });
      
      let metric;
      if (existingMetric) {
        console.log('找到现有记录，进行更新');
        // 检查现有记录的字段
        console.log('现有记录:', JSON.stringify(existingMetric, null, 2));
        
        // 更新记录
        await existingMetric.update(metricData);
        metric = existingMetric;
        console.log('记录已更新');
      } else {
        console.log('未找到现有记录，创建新记录');
        // 创建新记录
        metric = await DailyMetric.create(metricData);
        console.log('新记录已创建');
      }
      
      // 验证保存结果
      console.log('检索保存后的记录进行验证');
      const verifiedMetric = await DailyMetric.findByPk(metric.id);
      console.log('验证保存的指标记录:', JSON.stringify(verifiedMetric, null, 2));
      
      result.coins.push({
        symbol: coin.symbol,
        metricId: metric.id,
        created: !existingMetric
      });
    } catch (err) {
      console.error(`处理币种 ${coinData.symbol} 时出错:`, err);
      console.error('错误详情:', err.stack);
    }
  }
  
  // 处理流动性数据
  if (liquidity) {
    console.log('\n处理流动性数据');
    try {
      const [liquidityRecord, created] = await LiquidityOverview.findOrCreate({
        where: { date },
        defaults: {
          btc_fund_change: liquidity.btcFundChange,
          eth_fund_change: liquidity.ethFundChange,
          sol_fund_change: liquidity.solFundChange,
          total_market_fund_change: liquidity.totalMarketFundChange,
          comments: liquidity.comments
        }
      });
      
      // 如果找到已存在的记录，则更新它
      if (!created) {
        console.log('找到现有流动性记录，进行更新');
        await liquidityRecord.update({
          btc_fund_change: liquidity.btcFundChange,
          eth_fund_change: liquidity.ethFundChange,
          sol_fund_change: liquidity.solFundChange,
          total_market_fund_change: liquidity.totalMarketFundChange,
          comments: liquidity.comments
        });
      } else {
        console.log('创建了新的流动性记录');
      }
      
      result.liquidityUpdated = true;
    } catch (err) {
      console.error('处理流动性数据时出错:', err);
    }
  }
  
  // 处理热点币种
  if (trendingCoins && Array.isArray(trendingCoins)) {
    console.log('\n处理热点币种数据');
    for (const trendingCoinData of trendingCoins) {
      try {
        console.log(`处理热点币种: ${trendingCoinData.symbol}`);
        const [trendingCoin, created] = await TrendingCoin.findOrCreate({
          where: {
            date,
            symbol: trendingCoinData.symbol.toUpperCase()
          },
          defaults: {
            otc_index: trendingCoinData.otcIndex,
            explosion_index: trendingCoinData.explosionIndex,
            entry_exit_type: trendingCoinData.entryExitType,
            entry_exit_day: trendingCoinData.entryExitDay,
            schelling_point: trendingCoinData.schellingPoint
          }
        });
        
        // 如果找到已存在的记录，则更新它
        if (!created) {
          console.log('找到现有热点币种记录，进行更新');
          await trendingCoin.update({
            otc_index: trendingCoinData.otcIndex,
            explosion_index: trendingCoinData.explosionIndex,
            entry_exit_type: trendingCoinData.entryExitType,
            entry_exit_day: trendingCoinData.entryExitDay,
            schelling_point: trendingCoinData.schellingPoint
          });
        } else {
          console.log('创建了新的热点币种记录');
        }
        
        result.trendingCoins.push({
          symbol: trendingCoin.symbol,
          created
        });
      } catch (err) {
        console.error(`处理热点币种 ${trendingCoinData.symbol} 时出错:`, err);
      }
    }
  }
  
  console.log('============ 数据存储完成 ============');
  console.log('结果摘要:', JSON.stringify(result, null, 2));
  
  return result;
}

// Helper function to get the date string for the day before
function getPreviousDate(dateString) {
  const date = new Date(dateString);
  date.setDate(date.getDate() - 1);
  return date.toISOString().split('T')[0];
}

// 获取最新数据 (增强版，包含前一天对比数据)
router.get('/latest', async (req, res) => {
  try {
    console.log('请求获取最新数据 (增强版)');
    
    const latestMetricEntry = await DailyMetric.findOne({
      order: [['date', 'DESC']]
    });
    
    if (!latestMetricEntry) {
      console.log('未找到任何指标数据');
      return res.status(404).json({ error: 'No metrics data found' });
    }
    
    const latestDate = latestMetricEntry.date;
    const previousDate = getPreviousDate(latestDate); // 计算前一天的日期
    console.log('最新日期:', latestDate, '; 前一天日期:', previousDate);
    
    // 1. 获取最新日期的所有币种指标
    const latestDayMetrics = await DailyMetric.findAll({
      where: { date: latestDate },
      include: [{
        model: Coin,
        as: 'coin',
        attributes: ['id', 'symbol', 'name', 'current_price', 'logo_url'] // Include id
      }]
    });
    console.log(`找到 ${latestDayMetrics.length} 条 ${latestDate} 的指标记录`);

    // 2. 获取前一天的所有币种指标 (用于对比)
    const previousDayMetricsRaw = await DailyMetric.findAll({
      where: { date: previousDate },
      // No need to include Coin again if we map by coin_id
    });
    console.log(`找到 ${previousDayMetricsRaw.length} 条 ${previousDate} 的指标记录`);

    // 将前一天的数据转换为以 coin_id 为键的 Map，方便查找
    const previousDayMetricsMap = new Map();
    previousDayMetricsRaw.forEach(metric => {
      previousDayMetricsMap.set(metric.coin_id, {
        otc_index: metric.otc_index,
        explosion_index: metric.explosion_index,
        // Add other fields if needed for comparison later
      });
    });

    // 3. 组合数据，加入前一天对比值
    const metricsWithComparison = latestDayMetrics.map(currentMetric => {
      const coinId = currentMetric.coin.id; // coin.id is available due to include
      const previousMetrics = previousDayMetricsMap.get(coinId);
      
      return {
        // ...currentMetric.toJSON(), // Spread all fields from currentMetric
        // Manually list fields to ensure structure and include coin details directly
        id: currentMetric.id, // metric id
        coin_id: coinId,
        date: currentMetric.date,
        otc_index: currentMetric.otc_index,
        explosion_index: currentMetric.explosion_index,
        schelling_point: currentMetric.schelling_point,
        entry_exit_type: currentMetric.entry_exit_type,
        entry_exit_day: currentMetric.entry_exit_day,
        near_threshold: currentMetric.near_threshold,
        coin: currentMetric.coin.toJSON(), // Include the full coin object
        previous_day_data: previousMetrics ? { // Add previous day data if found
          otc_index: previousMetrics.otc_index,
          explosion_index: previousMetrics.explosion_index,
        } : null // Set to null if no previous day data
      };
    });
    
    // 获取流动性概况
    const liquidity = await LiquidityOverview.findOne({
      where: { date: latestDate }
    });
    
    // 获取热点币种 (也可以为它们添加前一天对比，如果 TrendingCoin 模型有历史数据)
    // For simplicity, let's assume trendingCoins don't need previous day data for now,
    // or their structure in the DB would need similar handling.
    const trendingCoins = await TrendingCoin.findAll({
      where: { date: latestDate }
      // Potentially add comparison data here too if needed and feasible
    });
    
    console.log(`找到 ${trendingCoins.length} 条热点币种记录`);
    
    res.json({
      date: latestDate,
      metrics: metricsWithComparison, // 使用包含对比数据的新数组
      liquidity,
      trendingCoins
    });
  } catch (error) {
    console.error('获取最新数据时出错:', error);
    res.status(500).json({ error: 'Failed to fetch latest data' });
  }
});

// 导出所有数据
router.get('/export-all', async (req, res) => {
  try {
    console.log('请求导出所有数据库数据');
    
    // 1. 获取所有币种
    const coins = await Coin.findAll();
    console.log(`找到 ${coins.length} 个币种数据`);
    
    // 2. 获取所有指标数据
    const metrics = await DailyMetric.findAll({
      include: [{
        model: Coin,
        as: 'coin',
        attributes: ['symbol', 'name'] // 只包含必要字段
      }],
      order: [['date', 'DESC']]
    });
    console.log(`找到 ${metrics.length} 条指标数据记录`);
    
    // 3. 获取所有流动性数据
    const liquidity = await LiquidityOverview.findAll({
      order: [['date', 'DESC']]
    });
    console.log(`找到 ${liquidity.length} 条流动性数据记录`);
    
    // 4. 获取所有热点币种数据
    const trendingCoins = await TrendingCoin.findAll({
      order: [['date', 'DESC']]
    });
    console.log(`找到 ${trendingCoins.length} 条热点币种数据记录`);
    
    // 5. 获取所有不同的日期
    const distinctDates = await DailyMetric.findAll({
      attributes: ['date'],
      group: ['date'],
      order: [['date', 'DESC']]
    });
    
    const dateList = distinctDates.map(d => d.date);
    
    // 6. 获取最新日期的详细数据
    const latestDate = dateList.length > 0 ? dateList[0] : null;
    
    // 组装最新数据
    let latestData = null;
    if (latestDate) {
      // 最新日期的币种数据
      const latestCoins = await DailyMetric.findAll({
        where: { date: latestDate },
        include: [{
          model: Coin,
          as: 'coin',
          attributes: ['id', 'symbol', 'name', 'current_price', 'logo_url']
        }]
      });
      
      // 转换为前端期望的格式
      const formattedCoins = latestCoins.map(metric => ({
        id: metric.coin.id,
        symbol: metric.coin.symbol,
        name: metric.coin.name,
        current_price: metric.coin.current_price,
        logo_url: metric.coin.logo_url,
        otcIndex: metric.otc_index,
        explosionIndex: metric.explosion_index,
        schellingPoint: metric.schelling_point,
        entryExitType: metric.entry_exit_type,
        entryExitDay: metric.entry_exit_day,
        nearThreshold: metric.near_threshold
      }));
      
      // 最新日期的流动性数据
      const latestLiquidity = await LiquidityOverview.findOne({
        where: { date: latestDate }
      });
      
      // 最新日期的热点币种
      const latestTrending = await TrendingCoin.findAll({
        where: { date: latestDate }
      });
      
      latestData = {
        date: latestDate,
        coins: formattedCoins,
        liquidity: latestLiquidity,
        trendingCoins: latestTrending
      };
    }
    
    // 7. 为主要币种准备历史数据 (BTC, ETH, BNB, SOL)
    const historicalData = {};
    const mainCoins = ['BTC', 'ETH', 'BNB', 'SOL'];
    
    for (const symbol of mainCoins) {
      const coin = await Coin.findOne({ where: { symbol } });
      if (coin) {
        const coinMetrics = await DailyMetric.findAll({
          where: { coin_id: coin.id },
          order: [['date', 'ASC']],
          limit: 30 // 最多返回30天数据
        });
        
        if (coinMetrics.length > 0) {
          historicalData[symbol] = coinMetrics.map(metric => ({
            date: metric.date,
            otc_index: metric.otc_index,
            explosion_index: metric.explosion_index,
            schelling_point: metric.schelling_point,
            entry_exit_type: metric.entry_exit_type,
            entry_exit_day: metric.entry_exit_day
          }));
        }
      }
    }
    
    // 8. 组装最终导出数据
    const exportData = {
      metadata: {
        exportDate: new Date().toISOString(),
        appVersion: '1.0.0',
        dataLatest: latestDate,
        availableDates: dateList
      },
      coins,
      metrics,
      liquidity,
      trendingCoins,
      latestData,
      historicalData
    };
    
    // 设置更长的超时，因为数据量可能很大
    res.setTimeout(120000); // 2分钟
    res.json(exportData);
    
  } catch (error) {
    console.error('导出数据库数据时出错:', error);
    res.status(500).json({ error: 'Failed to export database data', details: error.message });
  }
});

// 新增：批量导入数据库备份数据
router.post('/import-database', async (req, res) => {
  try {
    const dumpData = req.body;
    
    // 数据格式验证
    if (!dumpData || !dumpData.metadata || !dumpData.coins || !dumpData.metrics) {
      console.error('数据库导入: 格式无效，缺少必要字段');
      return res.status(400).json({ error: 'Invalid database dump format. Required fields missing.' });
    }
    
    console.log(`[IMPORT_DB] Received database import request. Export Date: ${dumpData.metadata.exportDate}, App Version: ${dumpData.metadata.appVersion}`);
    console.log(`[IMPORT_DB] 数据大小: 币种=${dumpData.coins.length}, 指标=${dumpData.metrics.length}, 流动性=${dumpData.liquidity?.length || 0}`);
  
    // 使用事务确保数据一致性
    const transaction = await db.sequelize.transaction();
  
    try {
      let coinsImported = 0;
      let metricsImported = 0;
      let liquidityImported = 0;
      let trendingImported = 0;
  
      // 1. 导入/更新 Coins
      if (Array.isArray(dumpData.coins) && dumpData.coins.length > 0) {
        console.log(`[IMPORT_DB] 开始处理 ${dumpData.coins.length} 个币种数据...`);
        
        for (const cData of dumpData.coins) {
          // 预处理币种数据，确保必要字段存在
          const coinData = {
            symbol: (cData.symbol || '').toUpperCase(),
            name: cData.name || cData.symbol || 'Unknown Coin',
            current_price: cData.current_price !== undefined ? cData.current_price : 0,
            logo_url: cData.logo_url || null
          };
          
          // 跳过无效数据
          if (!coinData.symbol) {
            console.warn('[IMPORT_DB] 跳过无效币种数据: 缺少symbol字段');
            continue;
          }
          
          try {
            // 查找或创建币种
            const [coin, created] = await Coin.findOrCreate({
              where: { symbol: coinData.symbol },
              defaults: coinData,
              transaction
            });
            
            // 如果找到现有币种，更新其属性
            if (!created) {
              await coin.update(coinData, { transaction });
              console.log(`[IMPORT_DB] 更新币种: ${coinData.symbol}`);
            } else {
              console.log(`[IMPORT_DB] 创建币种: ${coinData.symbol}`);
            }
            
            coinsImported++;
            
            // 每处理10个币种输出一次日志
            if (coinsImported % 10 === 0) {
              console.log(`[IMPORT_DB] 已处理 ${coinsImported}/${dumpData.coins.length} 个币种`);
            }
          } catch (err) {
            console.error(`[IMPORT_DB] 处理币种 ${coinData.symbol} 时出错:`, err);
            // 继续处理其他币种
          }
        }
      }
      
      // 获取所有币种的映射关系，用于后续指标数据处理
      const allCoinsFromDB = await Coin.findAll({ 
        attributes: ['id', 'symbol'], 
        transaction 
      });
      
      const coinSymbolToIdMap = new Map();
      allCoinsFromDB.forEach(c => {
        coinSymbolToIdMap.set(c.symbol.toUpperCase(), c.id);
      });
      
      console.log(`[IMPORT_DB] 币种映射表包含 ${coinSymbolToIdMap.size} 个币种`);
  
      // 2. 导入/更新 DailyMetrics
      if (Array.isArray(dumpData.metrics) && dumpData.metrics.length > 0) {
        console.log(`[IMPORT_DB] 开始处理 ${dumpData.metrics.length} 条指标数据...`);
        
        for (const m of dumpData.metrics) {
          // 确定币种ID
          let coinIdToUse = m.coin_id;
          
          // 如果没有coin_id但有coin对象，通过symbol查找币种ID
          if (!coinIdToUse && m.coin && m.coin.symbol) {
            coinIdToUse = coinSymbolToIdMap.get(m.coin.symbol.toUpperCase());
          }
          
          // 如果找不到币种ID，跳过该指标
          if (!coinIdToUse) {
            console.warn(`[IMPORT_DB] 跳过指标: 找不到币种ID (date=${m.date}, symbol=${m.coin?.symbol || 'unknown'})`);
            continue;
          }
          
          try {
            // 预处理指标数据
            const metricData = {
              coin_id: coinIdToUse,
              date: m.date,
              otc_index: m.otc_index !== undefined ? m.otc_index : 0,
              explosion_index: m.explosion_index !== undefined ? m.explosion_index : 0,
              schelling_point: m.schelling_point,
              entry_exit_type: m.entry_exit_type || 'neutral',
              entry_exit_day: m.entry_exit_day !== undefined ? m.entry_exit_day : 0,
              near_threshold: !!m.near_threshold
            };
            
            // 查找或创建指标记录
            const [metric, created] = await DailyMetric.findOrCreate({
              where: { 
                coin_id: metricData.coin_id, 
                date: metricData.date 
              },
              defaults: metricData,
              transaction
            });
            
            // 如果找到现有记录，更新其属性
            if (!created) {
              await metric.update(metricData, { transaction });
            }
            
            metricsImported++;
            
            // 每处理100条指标输出一次日志
            if (metricsImported % 100 === 0) {
              console.log(`[IMPORT_DB] 已处理 ${metricsImported}/${dumpData.metrics.length} 条指标数据`);
            }
          } catch (err) {
            console.error(`[IMPORT_DB] 处理指标数据出错 (coin_id=${coinIdToUse}, date=${m.date}):`, err);
            // 继续处理其他指标
          }
        }
      }
  
      // 3. 导入/更新 LiquidityOverview
      if (Array.isArray(dumpData.liquidity) && dumpData.liquidity.length > 0) {
        console.log(`[IMPORT_DB] 开始处理 ${dumpData.liquidity.length} 条流动性数据...`);
        
        for (const l of dumpData.liquidity) {
          try {
            // 预处理流动性数据
            const liquidityData = {
              date: l.date,
              btc_fund_change: l.btc_fund_change,
              eth_fund_change: l.eth_fund_change,
              sol_fund_change: l.sol_fund_change,
              total_market_fund_change: l.total_market_fund_change,
              comments: l.comments
            };
            
            // 查找或创建流动性记录
            const [liq, created] = await LiquidityOverview.findOrCreate({
              where: { date: liquidityData.date },
              defaults: liquidityData,
              transaction
            });
            
            // 如果找到现有记录，更新其属性
            if (!created) {
              await liq.update(liquidityData, { transaction });
            }
            
            liquidityImported++;
          } catch (err) {
            console.error(`[IMPORT_DB] 处理流动性数据出错 (date=${l.date}):`, err);
            // 继续处理其他流动性数据
          }
        }
      }
      
      // 4. 导入/更新 TrendingCoins
      const trendingToImport = dumpData.trendingCoins || dumpData.latestData?.trendingCoins || [];
      if (Array.isArray(trendingToImport) && trendingToImport.length > 0) {
        console.log(`[IMPORT_DB] 开始处理 ${trendingToImport.length} 条热点币种数据...`);
        
        for (const t of trendingToImport) {
          try {
            // 预处理热点币种数据
            const trendingData = {
              date: t.date,
              symbol: (t.symbol || '').toUpperCase(),
              otc_index: t.otc_index !== undefined ? t.otc_index : 0,
              explosion_index: t.explosion_index !== undefined ? t.explosion_index : 0,
              entry_exit_type: t.entry_exit_type || 'neutral',
              entry_exit_day: t.entry_exit_day !== undefined ? t.entry_exit_day : 0,
              schelling_point: t.schelling_point
            };
            
            // 跳过无效数据
            if (!trendingData.symbol || !trendingData.date) {
              console.warn('[IMPORT_DB] 跳过无效热点币种数据: 缺少symbol或date字段');
              continue;
            }
            
            // 查找或创建热点币种记录
            const [trend, created] = await TrendingCoin.findOrCreate({
              where: { 
                date: trendingData.date, 
                symbol: trendingData.symbol 
              },
              defaults: trendingData,
              transaction
            });
            
            // 如果找到现有记录，更新其属性
            if (!created) {
              await trend.update(trendingData, { transaction });
            }
            
            trendingImported++;
          } catch (err) {
            console.error(`[IMPORT_DB] 处理热点币种数据出错 (symbol=${t.symbol}, date=${t.date}):`, err);
            // 继续处理其他热点币种数据
          }
        }
      }
  
      // 提交事务
      await transaction.commit();
      console.log('[IMPORT_DB] 数据库导入成功，事务已提交');
      
      // 返回成功结果
      res.json({ 
        success: true, 
        message: 'Database imported successfully.',
        summary: { coinsImported, metricsImported, liquidityImported, trendingImported }
      });
    } catch (error) {
      // 如果事务未完成，回滚事务
      if (transaction && !transaction.finished) {
        try {
          await transaction.rollback();
          console.log("[IMPORT_DB] 事务回滚成功");
        } catch (rollbackError) {
          console.error("[IMPORT_DB] 事务回滚失败:", rollbackError);
        }
      }
      
      console.error('[IMPORT_DB] 数据库导入过程中出错:', error);
      res.status(500).json({ 
        error: 'Failed to import database.', 
        details: error.message 
      });
    }
  } catch (error) {
    console.error('[IMPORT_DB] 解析请求数据时出错:', error);
    res.status(400).json({ 
      error: 'Error parsing request data', 
      details: error.message 
    });
  }
});

// 调试路由 - 显示所有支持的字段
router.get('/debug/fields', async (req, res) => {
  try {
    // 获取DailyMetric表的所有字段
    const metric = await DailyMetric.findOne();
    const fields = metric ? Object.keys(metric.toJSON()) : [];
    
    // 获取一个示例记录
    const sample = await DailyMetric.findOne({
      include: [{
        model: Coin,
        as: 'coin',
      }]
    });
    
    res.json({
      fields,
      sample: sample ? sample.toJSON() : null,
      rawSample: sample
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 调试路由 - 检查日期范围
router.get('/debug/date-range', async (req, res) => {
  try {
    // 找到最早和最晚的日期
    const oldestRecord = await DailyMetric.findOne({
      order: [['date', 'ASC']]
    });
    
    const newestRecord = await DailyMetric.findOne({
      order: [['date', 'DESC']]
    });
    
    // 获取不同的日期
    const distinctDates = await DailyMetric.findAll({
      attributes: ['date'],
      group: ['date'],
      order: [['date', 'DESC']]
    });
    
    res.json({
      oldestDate: oldestRecord ? oldestRecord.date : null,
      newestDate: newestRecord ? newestRecord.date : null,
      totalMetricsCount: await DailyMetric.count(),
      distinctDatesCount: distinctDates.length,
      dates: distinctDates.map(d => d.date)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 直接添加测试数据（开发环境使用）
router.post('/debug/add-test-data', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'This endpoint is disabled in production' });
  }
  
  try {
    const today = new Date();
    const date = today.toISOString().split('T')[0];
    
    // 测试数据
    const testCoins = [
      { symbol: 'BTC', otcIndex: 1627, explosionIndex: 195, schellingPoint: 98500, entryExitType: 'entry', entryExitDay: 26 },
      { symbol: 'ETH', otcIndex: 1430, explosionIndex: 180, schellingPoint: 1850, entryExitType: 'exit', entryExitDay: 105 },
      { symbol: 'BNB', otcIndex: 1038, explosionIndex: 126, schellingPoint: 601, entryExitType: 'exit', entryExitDay: 9 }
    ];
    
    const testData = {
      date,
      coins: testCoins
    };
    
    // 存储测试数据
    const result = await storeProcessedData(testData);
    
    res.json({
      message: 'Test data added successfully',
      result
    });
  } catch (error) {
    console.error('添加测试数据时出错:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;