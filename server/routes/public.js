// server/routes/public.js
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Coin, DailyMetric } = require('../models');
const dataRoutes = require('./data');

const CRYPTO_SYMBOLS = [
  'BTC', 'ETH', 'BNB', 'SOL', 'DOGE', 'LTC', 'LDO', 'CRV', 'LINK', 'ADA', 'UNI',
  'ONDO', 'AAVE', 'AVAX', 'PEPE', 'SUI', 'SEI', 'WLD', 'HYPE', 'TRUMP', 'PUMP', 'ZEC'
];

function formatTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

router.get('/top-otc-crypto', async (req, res) => {
  try {
    const latestMetricDateEntry = await DailyMetric.findOne({
      attributes: ['date'],
      order: [['date', 'DESC']],
      raw: true
    });

    if (!latestMetricDateEntry || !latestMetricDateEntry.date) {
      return res.status(404).json({ success: false, error: 'No metrics data found' });
    }

    const latestDate = latestMetricDateEntry.date;
    const metrics = await DailyMetric.findAll({
      where: {
        date: latestDate,
        otc_index: { [Op.ne]: null }
      },
      include: [{
        model: Coin,
        as: 'coin',
        attributes: ['id', 'symbol', 'name'],
        where: { symbol: CRYPTO_SYMBOLS },
        required: true
      }],
      order: [['otc_index', 'DESC']],
      limit: 5
    });

    const calculatePeriodQuality = dataRoutes.calculatePeriodQuality;
    const items = await Promise.all(metrics.map(async (metric) => {
      const periodQuality = typeof calculatePeriodQuality === 'function'
        ? await calculatePeriodQuality(metric.coin_id)
        : null;
      const timestamp = formatTimestamp(metric.timestamp);

      return {
        symbol: metric.coin?.symbol || null,
        name: metric.coin?.name || metric.coin?.symbol || null,
        otc_index: metric.otc_index,
        period_quality: periodQuality,
        time: timestamp || metric.date,
        date: metric.date,
        timestamp: timestamp
      };
    }));

    res.json({
      success: true,
      date: latestDate,
      count: items.length,
      items
    });
  } catch (error) {
    console.error('[PUBLIC_TOP_OTC] Error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch top OTC crypto', details: error.message });
  }
});

router.get('/bottom-otc-crypto', async (req, res) => {
  try {
    const latestMetricDateEntry = await DailyMetric.findOne({
      attributes: ['date'],
      order: [['date', 'DESC']],
      raw: true
    });

    if (!latestMetricDateEntry || !latestMetricDateEntry.date) {
      return res.status(404).json({ success: false, error: 'No metrics data found' });
    }

    const latestDate = latestMetricDateEntry.date;
    const metrics = await DailyMetric.findAll({
      where: {
        date: latestDate,
        otc_index: { [Op.ne]: null }
      },
      include: [{
        model: Coin,
        as: 'coin',
        attributes: ['id', 'symbol', 'name'],
        where: { symbol: CRYPTO_SYMBOLS },
        required: true
      }],
      order: [['otc_index', 'ASC']],
      limit: 5
    });

    const calculatePeriodQuality = dataRoutes.calculatePeriodQuality;
    const items = await Promise.all(metrics.map(async (metric) => {
      const periodQuality = typeof calculatePeriodQuality === 'function'
        ? await calculatePeriodQuality(metric.coin_id)
        : null;
      const timestamp = formatTimestamp(metric.timestamp);

      return {
        symbol: metric.coin?.symbol || null,
        name: metric.coin?.name || metric.coin?.symbol || null,
        otc_index: metric.otc_index,
        period_quality: periodQuality,
        time: timestamp || metric.date,
        date: metric.date,
        timestamp: timestamp
      };
    }));

    res.json({
      success: true,
      date: latestDate,
      count: items.length,
      items
    });
  } catch (error) {
    console.error('[PUBLIC_BOTTOM_OTC] Error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch bottom OTC crypto', details: error.message });
  }
});

module.exports = router;
