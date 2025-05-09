// server/routes/coins.js
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize'); // 添加这一行
const { Coin, DailyMetric } = require('../models');

// 获取所有币种
router.get('/', async (req, res) => {
  try {
    const coins = await Coin.findAll({
      attributes: ['id', 'symbol', 'name', 'current_price', 'logo_url']
    });
    res.json(coins);
  } catch (error) {
    console.error('Error fetching coins:', error);
    res.status(500).json({ error: 'Failed to fetch coins' });
  }
});

// 获取单个币种信息
router.get('/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const coin = await Coin.findOne({
      where: { symbol: symbol.toUpperCase() },
      attributes: ['id', 'symbol', 'name', 'current_price', 'logo_url']
    });
    
    if (!coin) {
      return res.status(404).json({ error: 'Coin not found' });
    }
    
    res.json(coin);
  } catch (error) {
    console.error(`Error fetching coin ${req.params.symbol}:`, error);
    res.status(500).json({ error: 'Failed to fetch coin' });
  }
});

// 获取币种的指标数据
router.get('/:symbol/metrics', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { startDate, endDate } = req.query;
    
    // 查找币种ID
    const coin = await Coin.findOne({
      where: { symbol: symbol.toUpperCase() }
    });
    
    if (!coin) {
      return res.status(404).json({ error: 'Coin not found' });
    }
    
    // 构建查询条件
    const where = { coin_id: coin.id };
    if (startDate) where.date = { [Op.gte]: startDate };
    if (endDate) where.date = { ...where.date, [Op.lte]: endDate };
    
    // 查询指标数据
    const metrics = await DailyMetric.findAll({
      where,
      order: [['date', 'ASC']]
    });
    
    res.json(metrics);
  } catch (error) {
    console.error(`Error fetching metrics for ${req.params.symbol}:`, error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

// 创建新币种
router.post('/', async (req, res) => {
  try {
    const { symbol, name, current_price, logo_url } = req.body;
    
    // 验证必要字段
    if (!symbol || !name) {
      return res.status(400).json({ error: 'Symbol and name are required' });
    }
    
    // 检查是否已存在
    const existingCoin = await Coin.findOne({
      where: { symbol: symbol.toUpperCase() }
    });
    
    if (existingCoin) {
      return res.status(409).json({ error: 'Coin already exists' });
    }
    
    // 创建新币种
    const newCoin = await Coin.create({
      symbol: symbol.toUpperCase(),
      name,
      current_price,
      logo_url
    });
    
    res.status(201).json(newCoin);
  } catch (error) {
    console.error('Error creating coin:', error);
    res.status(500).json({ error: 'Failed to create coin' });
  }
});

// 更新币种信息
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, current_price, logo_url } = req.body;
    
    const coin = await Coin.findByPk(id);
    if (!coin) {
      return res.status(404).json({ error: 'Coin not found' });
    }
    
    // 更新币种
    await coin.update({
      name: name || coin.name,
      current_price: current_price !== undefined ? current_price : coin.current_price,
      logo_url: logo_url || coin.logo_url
    });
    
    res.json(coin);
  } catch (error) {
    console.error(`Error updating coin ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to update coin' });
  }
});

// 删除币种
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const coin = await Coin.findByPk(id);
    if (!coin) {
      return res.status(404).json({ error: 'Coin not found' });
    }
    
    // 删除币种
    await coin.destroy();
    
    res.json({ message: 'Coin deleted successfully' });
  } catch (error) {
    console.error(`Error deleting coin ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to delete coin' });
  }
});

module.exports = router;