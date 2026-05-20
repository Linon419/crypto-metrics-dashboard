const express = require('express');
const router = express.Router();
const path = require('path');
const { Worker } = require('worker_threads');
const { Coin, DailyMetric, BtcPricePoint } = require('../models');

const CACHE_TTL_MS = Number(process.env.BTC_PREDICTION_CACHE_TTL_MS || 10 * 60 * 1000);
let predictionCache = null;
let pendingPrediction = null;

async function loadBtcMetrics() {
  const btcCoin = await Coin.findOne({ where: { symbol: 'BTC' } });
  if (!btcCoin) {
    const error = new Error('BTC coin is missing from database');
    error.statusCode = 404;
    throw error;
  }

  const metrics = await DailyMetric.findAll({
    where: { coin_id: btcCoin.id },
    order: [['date', 'ASC'], ['timestamp', 'ASC'], ['id', 'ASC']],
    raw: true,
  });
  const metricIds = metrics.map(metric => metric.id).filter(Boolean);

  if (metricIds.length === 0) {
    return metrics;
  }

  await BtcPricePoint.sync();
  const pricePoints = await BtcPricePoint.findAll({
    where: { daily_metric_id: metricIds },
    raw: true,
  });
  const priceByMetricId = new Map(pricePoints.map(point => [point.daily_metric_id, point]));

  return metrics.map((metric) => {
    const pricePoint = priceByMetricId.get(metric.id);
    if (!pricePoint) return metric;

    return {
      ...metric,
      btc_publish_price: pricePoint.close_price,
      btc_publish_price_at: pricePoint.published_at,
      btc_publish_kline_open_time: pricePoint.kline_open_time,
      btc_publish_kline_close_time: pricePoint.kline_close_time,
      btc_publish_price_source: pricePoint.market,
      btc_publish_price_symbol: pricePoint.symbol,
      btc_publish_price_updated_at: pricePoint.updatedAt,
    };
  });
}

function buildMetricsSignature(metrics) {
  const lastMetric = metrics[metrics.length - 1] || {};
  const latestUpdatedAt = metrics.reduce((latest, metric) => {
    const metricUpdatedAt = new Date(metric.updatedAt || metric.createdAt || 0).getTime();
    const priceUpdatedAt = new Date(metric.btc_publish_price_updated_at || 0).getTime();
    const value = Math.max(
      Number.isFinite(metricUpdatedAt) ? metricUpdatedAt : 0,
      Number.isFinite(priceUpdatedAt) ? priceUpdatedAt : 0
    );
    return value > latest ? value : latest;
  }, 0);
  const priceRows = metrics.filter(metric => metric.btc_publish_price !== null && metric.btc_publish_price !== undefined).length;

  return [
    metrics.length,
    priceRows,
    lastMetric.id || '',
    lastMetric.date || '',
    lastMetric.timestamp || '',
    lastMetric.btc_publish_price || '',
    latestUpdatedAt,
  ].join('|');
}

function isCacheFresh(signature) {
  return predictionCache
    && predictionCache.signature === signature
    && Date.now() - predictionCache.createdAt < CACHE_TTL_MS;
}

function shouldRefresh(query) {
  return ['1', 'true', 'yes'].includes(String(query.refresh || '').toLowerCase());
}

function runBacktestInWorker(metrics) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, '../utils/btcPredictionWorker.js'), {
      workerData: { metrics },
    });
    let settled = false;

    const settle = (handler, value) => {
      if (settled) return;
      settled = true;
      handler(value);
    };

    worker.once('message', (message) => {
      if (message?.success) {
        settle(resolve, message.result);
        return;
      }
      settle(reject, new Error(message?.error || 'BTC prediction worker failed'));
    });

    worker.once('error', error => settle(reject, error));
    worker.once('exit', (code) => {
      if (code !== 0) {
        settle(reject, new Error(`BTC prediction worker exited with code ${code}`));
      }
    });
  });
}

router.get('/btc/backtest', async (req, res) => {
  try {
    const metrics = await loadBtcMetrics();
    const signature = buildMetricsSignature(metrics);
    const forceRefresh = shouldRefresh(req.query);

    if (!forceRefresh && isCacheFresh(signature)) {
      res.set('X-Prediction-Cache', 'HIT');
      return res.json({
        success: true,
        ...predictionCache.result,
      });
    }

    if (!forceRefresh && pendingPrediction?.signature === signature) {
      res.set('X-Prediction-Cache', 'PENDING');
      const result = await pendingPrediction.promise;
      return res.json({
        success: true,
        ...result,
      });
    }

    res.set('X-Prediction-Cache', 'MISS');
    pendingPrediction = {
      signature,
      promise: runBacktestInWorker(metrics)
        .then((result) => {
          predictionCache = {
            signature,
            result,
            createdAt: Date.now(),
          };
          return result;
        })
        .finally(() => {
          if (pendingPrediction?.signature === signature) {
            pendingPrediction = null;
          }
        }),
    };

    const result = await pendingPrediction.promise;
    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Error building BTC prediction backtest:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Failed to build BTC prediction backtest',
    });
  }
});

router.__predictionCacheTestUtils = {
  buildMetricsSignature,
  clearCache: () => {
    predictionCache = null;
    pendingPrediction = null;
  },
};

module.exports = router;
