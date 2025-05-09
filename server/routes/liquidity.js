// server/routes/liquidity.js
const express = require('express');
const router = express.Router();
const { LiquidityOverview } = require('../models');

// 获取所有流动性概况数据
router.get('/', async (req, res) => {
  try {
    const { date } = req.query;
    
    // 构建查询条件
    const where = {};
    if (date) where.date = date;
    
    const liquidityData = await LiquidityOverview.findAll({
      where,
      order: [['date', 'DESC']]
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
      where: { date }
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
router.post('/', async (req, res) => {
  try {
    const { 
      date, 
      btc_fund_change, 
      eth_fund_change, 
      sol_fund_change, 
      total_market_fund_change,
      comments 
    } = req.body;
    
    // 验证必要字段
    if (!date) {
      return res.status(400).json({ error: 'Date is required' });
    }
    
    // 查找是否存在同一天的记录
    const [liquidityData, created] = await LiquidityOverview.findOrCreate({
      where: { date },
      defaults: {
        btc_fund_change,
        eth_fund_change,
        sol_fund_change,
        total_market_fund_change,
        comments
      }
    });
    
    // 如果记录已存在，则更新
    if (!created) {
      await liquidityData.update({
        btc_fund_change: btc_fund_change !== undefined ? btc_fund_change : liquidityData.btc_fund_change,
        eth_fund_change: eth_fund_change !== undefined ? eth_fund_change : liquidityData.eth_fund_change,
        sol_fund_change: sol_fund_change !== undefined ? sol_fund_change : liquidityData.sol_fund_change,
        total_market_fund_change: total_market_fund_change !== undefined ? total_market_fund_change : liquidityData.total_market_fund_change,
        comments: comments || liquidityData.comments
      });
    }
    
    res.status(created ? 201 : 200).json(liquidityData);
  } catch (error) {
    console.error('Error adding/updating liquidity data:', error);
    res.status(500).json({ error: 'Failed to add/update liquidity data' });
  }
});

// 删除流动性概况
router.delete('/:date', async (req, res) => {
  try {
    const { date } = req.params;
    
    const liquidityData = await LiquidityOverview.findOne({
      where: { date }
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