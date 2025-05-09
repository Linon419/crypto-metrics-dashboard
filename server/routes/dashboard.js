// server/routes/dashboard.js
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Coin, DailyMetric, LiquidityOverview, TrendingCoin } = require('../models');

// 获取仪表盘数据
router.get('/', async (req, res) => {
  try {
    // 获取查询日期，默认为今天
    let { date } = req.query;
    if (!date) {
      date = new Date().toISOString().split('T')[0]; // 格式：YYYY-MM-DD
    }
    
    // 获取币种列表及其最新指标
    const coinsWithMetrics = await Coin.findAll({
      include: [{
        model: DailyMetric,
        as: 'metrics',
        where: { date },
        required: false, // LEFT JOIN，即使没有指标数据也返回币种
        limit: 1,
        order: [['date', 'DESC']]
      }],
      order: [['symbol', 'ASC']]
    });
    
    // 格式化币种数据
    const coins = coinsWithMetrics.map(coin => {
      const metrics = coin.metrics && coin.metrics.length > 0 ? coin.metrics[0] : null;
      return {
        id: coin.id,
        symbol: coin.symbol,
        name: coin.name,
        current_price: coin.current_price,
        logo_url: coin.logo_url,
        metrics: metrics ? {
          otc_index: metrics.otc_index,
          explosion_index: metrics.explosion_index,
          schelling_point: metrics.schelling_point,
          entry_exit_type: metrics.entry_exit_type,
          entry_exit_day: metrics.entry_exit_day,
          near_threshold: metrics.near_threshold
        } : null
      };
    });
    
    // 获取流动性概况
    const liquidity = await LiquidityOverview.findOne({
      where: { date }
    });
    
    // 获取热点币种
    const trendingCoins = await TrendingCoin.findAll({
      where: { date },
      order: [['explosion_index', 'DESC']]
    });
    
    // 获取进场和退场币种
    const entryCoins = coins.filter(coin => 
      coin.metrics && coin.metrics.entry_exit_type === 'entry'
    );
    
    const exitCoins = coins.filter(coin => 
      coin.metrics && coin.metrics.entry_exit_type === 'exit'
    );
    
    // 获取接近阈值的币种
    const nearThresholdCoins = coins.filter(coin => 
      coin.metrics && coin.metrics.near_threshold
    );
    
    // 整合仪表盘数据
    const dashboardData = {
      date,
      coins,
      liquidity,
      trendingCoins,
      statistics: {
        total_coins: coins.length,
        entry_coins: entryCoins.length,
        exit_coins: exitCoins.length,
        near_threshold_coins: nearThresholdCoins.length
      },
      highlights: {
        entry_coins: entryCoins.slice(0, 5), // 取前5个
        exit_coins: exitCoins.slice(0, 5),
        near_threshold_coins: nearThresholdCoins
      }
    };
    
    res.json(dashboardData);
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// 获取历史数据趋势
router.get('/trends', async (req, res) => {
  try {
    const { symbol, metric, startDate, endDate, limit } = req.query;
    
    // 构建查询条件
    const where = {};
    if (startDate) where.date = { [Op.gte]: startDate };
    if (endDate) where.date = { ...where.date, [Op.lte]: endDate };
    
    // 查询所有币种还是特定币种
    let coinWhere = {};
    if (symbol) {
      coinWhere.symbol = symbol.toUpperCase();
    }
    
    // 查询指标数据
    let metrics;
    if (symbol) {
      // 查询特定币种的指标
      const coin = await Coin.findOne({ where: { symbol: symbol.toUpperCase() } });
      if (!coin) {
        return res.status(404).json({ error: 'Coin not found' });
      }
      
      metrics = await DailyMetric.findAll({
        where: {
          ...where,
          coin_id: coin.id
        },
        order: [['date', 'ASC']],
        limit: limit ? parseInt(limit) : undefined
      });
    } else {
      // 查询所有币种的指标
      metrics = await DailyMetric.findAll({
        where,
        include: [{
          model: Coin,
          as: 'coin',
          attributes: ['symbol', 'name'],
          where: coinWhere
        }],
        order: [['date', 'ASC']],
        limit: limit ? parseInt(limit) : undefined
      });
    }
    
    // 格式化趋势数据
    const trends = {};
    
    // 如果查询特定指标
    if (metric) {
      const validMetrics = ['otc_index', 'explosion_index', 'schelling_point'];
      if (!validMetrics.includes(metric)) {
        return res.status(400).json({ error: 'Invalid metric name' });
      }
      
      // 按币种分组
      metrics.forEach(m => {
        const coinSymbol = symbol || m.coin.symbol;
        if (!trends[coinSymbol]) {
          trends[coinSymbol] = {
            symbol: coinSymbol,
            name: m.coin ? m.coin.name : coinSymbol,
            data: []
          };
        }
        
        trends[coinSymbol].data.push({
          date: m.date,
          value: m[metric]
        });
      });
    } else {
      // 返回所有指标
      metrics.forEach(m => {
        const coinSymbol = symbol || m.coin.symbol;
        if (!trends[coinSymbol]) {
          trends[coinSymbol] = {
            symbol: coinSymbol,
            name: m.coin ? m.coin.name : coinSymbol,
            otc_index: [],
            explosion_index: [],
            schelling_point: []
          };
        }
        
        trends[coinSymbol].otc_index.push({
          date: m.date,
          value: m.otc_index
        });
        
        trends[coinSymbol].explosion_index.push({
          date: m.date,
          value: m.explosion_index
        });
        
        trends[coinSymbol].schelling_point.push({
          date: m.date,
          value: m.schelling_point
        });
      });
    }
    
    res.json(Object.values(trends));
  } catch (error) {
    console.error('Error fetching trends data:', error);
    res.status(500).json({ error: 'Failed to fetch trends data' });
  }
});

module.exports = router;