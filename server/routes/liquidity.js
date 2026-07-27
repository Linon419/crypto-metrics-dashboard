// server/routes/liquidity.js
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { LiquidityOverview } = require('../models');
const { requireAdmin } = require('../middleware/auth');

// 获取所有流动性概况数据
router.get('/', async (req, res) => {
  try {
    const { date, startDate, endDate } = req.query;
    
    // 构建查询条件：date 为精确匹配，优先级高于 startDate/endDate 区间；
    // 区间条件必须放进同一个对象，展开字符串会得到 {"0":"2",...} 让 Sequelize 报 Invalid value
    const where = {};
    if (date) {
      where.date = date;
    } else {
      const dateRange = {};
      if (startDate) dateRange[Op.gte] = startDate;
      if (endDate) dateRange[Op.lte] = endDate;
      if (Object.getOwnPropertySymbols(dateRange).length > 0) where.date = dateRange;
    }

    const liquidityData = await LiquidityOverview.findAll({
      where,
      order: [['date', 'ASC'], ['timestamp', 'ASC'], ['id', 'ASC']]
    });
    
    res.json(liquidityData);
  } catch (error) {
    console.error('Error fetching liquidity data:', error);
    res.status(500).json({ error: 'Failed to fetch liquidity data' });
  }
});

// 获取特定日期的流动性概况
router.get('/:date', async (req, res) => {
  try {
    const { date } = req.params;
    
    const liquidityData = await LiquidityOverview.findOne({
      where: { date },
      order: [['timestamp', 'DESC'], ['id', 'DESC']]
    });
    
    if (!liquidityData) {
      return res.status(404).json({ error: 'Liquidity data not found for the specified date' });
    }
    
    res.json(liquidityData);
  } catch (error) {
    console.error(`Error fetching liquidity data for ${req.params.date}:`, error);
    res.status(500).json({ error: 'Failed to fetch liquidity data' });
  }
});

// 添加或更新流动性概况
router.post('/', requireAdmin, async (req, res) => {
  try {
    const {
      date,
      btc_fund_change,
      eth_fund_change,
      sol_fund_change,
      total_market_fund_change,
      comments,
      daily_reminder
    } = req.body;
    
    // 验证必要字段
    if (!date) {
      return res.status(400).json({ error: 'Date is required' });
    }
    
    // 查找是否存在同一天的记录：同一天可能有多个版本，必须命中最新的那条，
    // 否则读接口返回新版本、写接口改老版本，前端看起来像没生效
    const [liquidityData, created] = await LiquidityOverview.findOrCreate({
      where: { date },
      order: [['timestamp', 'DESC'], ['id', 'DESC']],
      defaults: {
        date,
        timestamp: new Date(),
        time_precision: 'day',
        btc_fund_change,
        eth_fund_change,
        sol_fund_change,
        total_market_fund_change,
        comments,
        daily_reminder
      }
    });
    
    // 如果记录已存在，则更新
    if (!created) {
      await liquidityData.update({
        btc_fund_change: btc_fund_change !== undefined ? btc_fund_change : liquidityData.btc_fund_change,
        eth_fund_change: eth_fund_change !== undefined ? eth_fund_change : liquidityData.eth_fund_change,
        sol_fund_change: sol_fund_change !== undefined ? sol_fund_change : liquidityData.sol_fund_change,
        total_market_fund_change: total_market_fund_change !== undefined ? total_market_fund_change : liquidityData.total_market_fund_change,
        comments: comments || liquidityData.comments,
        daily_reminder: daily_reminder || liquidityData.daily_reminder
      });
    }
    
    res.status(created ? 201 : 200).json(liquidityData);
  } catch (error) {
    console.error('Error adding/updating liquidity data:', error);
    res.status(500).json({ error: 'Failed to add/update liquidity data' });
  }
});

// 删除流动性概况
router.delete('/:date', requireAdmin, async (req, res) => {
  try {
    const { date } = req.params;
    
    // 与 GET /:date 保持一致，按最新版本定义删除目标
    const liquidityData = await LiquidityOverview.findOne({
      where: { date },
      order: [['timestamp', 'DESC'], ['id', 'DESC']]
    });

    if (!liquidityData) {
      return res.status(404).json({ error: 'Liquidity data not found for the specified date' });
    }

    await liquidityData.destroy();
    
    res.json({ message: 'Liquidity data deleted successfully' });
  } catch (error) {
    console.error(`Error deleting liquidity data for ${req.params.date}:`, error);
    res.status(500).json({ error: 'Failed to delete liquidity data' });
  }
});

module.exports = router;
