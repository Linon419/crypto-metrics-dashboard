// server/routes/data.js
const express = require('express');
const router = express.Router();
const { Coin, DailyMetric, LiquidityOverview, TrendingCoin } = require('../models');
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
// 获取最新数据
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