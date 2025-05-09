// server/routes/metrics.js
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { DailyMetric, Coin } = require('../models');

// 获取所有指标数据
router.get('/', async (req, res) => {
  try {
    const { date } = req.query;
    
    // 构建查询条件
    const where = {};
    if (date) where.date = date;
    
    const metrics = await DailyMetric.findAll({
      where,
      include: [{
        model: Coin,
        as: 'coin',
        attributes: ['symbol', 'name']
      }],
      order: [['date', 'DESC']]
    });
    
    res.json(metrics);
  } catch (error) {
    console.error('Error fetching metrics:', error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

// 添加新的指标数据
router.post('/', async (req, res) => {
  try {
    const { 
      coin_id, 
      date, 
      otc_index, 
      explosion_index, 
      schelling_point, 
      entry_exit_type, 
      entry_exit_day, 
      near_threshold 
    } = req.body;
    
    // 验证必要字段
    if (!coin_id || !date) {
      return res.status(400).json({ error: 'Coin ID and date are required' });
    }
    
    // 检查币种是否存在
    const coin = await Coin.findByPk(coin_id);
    if (!coin) {
      return res.status(404).json({ error: 'Coin not found' });
    }
    
    // 检查是否已存在同一天的记录
    const existingMetric = await DailyMetric.findOne({
      where: {
        coin_id,
        date
      }
    });
    
    if (existingMetric) {
      // 更新现有记录
      await existingMetric.update({
        otc_index,
        explosion_index,
        schelling_point,
        entry_exit_type,
        entry_exit_day,
        near_threshold
      });
      
      return res.json(existingMetric);
    }
    
    // 创建新记录
    const newMetric = await DailyMetric.create({
      coin_id,
      date,
      otc_index,
      explosion_index,
      schelling_point,
      entry_exit_type,
      entry_exit_day,
      near_threshold: near_threshold || false
    });
    
    res.status(201).json(newMetric);
  } catch (error) {
    console.error('Error adding metric:', error);
    res.status(500).json({ error: 'Failed to add metric' });
  }
});

// 更新指标数据
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      otc_index, 
      explosion_index, 
      schelling_point, 
      entry_exit_type, 
      entry_exit_day, 
      near_threshold 
    } = req.body;
    
    const metric = await DailyMetric.findByPk(id);
    if (!metric) {
      return res.status(404).json({ error: 'Metric not found' });
    }
    
    // 更新指标
    await metric.update({
      otc_index: otc_index !== undefined ? otc_index : metric.otc_index,
      explosion_index: explosion_index !== undefined ? explosion_index : metric.explosion_index,
      schelling_point: schelling_point !== undefined ? schelling_point : metric.schelling_point,
      entry_exit_type: entry_exit_type || metric.entry_exit_type,
      entry_exit_day: entry_exit_day !== undefined ? entry_exit_day : metric.entry_exit_day,
      near_threshold: near_threshold !== undefined ? near_threshold : metric.near_threshold
    });
    
    res.json(metric);
  } catch (error) {
    console.error(`Error updating metric ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to update metric' });
  }
});

// 删除指标数据
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const metric = await DailyMetric.findByPk(id);
    if (!metric) {
      return res.status(404).json({ error: 'Metric not found' });
    }
    
    // 删除指标
    await metric.destroy();
    
    res.json({ message: 'Metric deleted successfully' });
  } catch (error) {
    console.error(`Error deleting metric ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to delete metric' });
  }
});

module.exports = router;