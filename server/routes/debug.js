// 在server/routes/debug.js中添加
const express = require('express');
const router = express.Router();
const { Coin, DailyMetric } = require('../models');

// 查看数据库中实际存在的数据
router.get('/db-status', async (req, res) => {
  try {
    const coins = await Coin.findAll({ attributes: ['id', 'symbol'] });
    const metrics = await DailyMetric.findAll({ limit: 5 });
    const metricsCount = await DailyMetric.count();
    const dates = await DailyMetric.findAll({
      attributes: ['date'],
      group: ['date'],
      order: [['date', 'DESC']],
      limit: 10
    });
    
    res.json({
      coins,
      metricsCount,
      sampleMetrics: metrics,
      dates: dates.map(d => d.date)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

