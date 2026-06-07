const express = require('express');
const {
  buildBtcVolatilityHistory,
  buildBtcVolatilitySnapshot,
} = require('../utils/btcVolatility');

const router = express.Router();
const CACHE_TTL_MS = 60 * 1000;

let cache = {
  expiresAt: 0,
  data: null,
};
const historyCache = new Map();

router.get('/btc', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const now = Date.now();

    if (!forceRefresh && cache.data && cache.expiresAt > now) {
      return res.json({
        success: true,
        cached: true,
        data: cache.data,
      });
    }

    const data = await buildBtcVolatilitySnapshot({ now });
    cache = {
      expiresAt: now + CACHE_TTL_MS,
      data,
    };

    return res.json({
      success: true,
      cached: false,
      data,
    });
  } catch (error) {
    console.error('Error fetching BTC volatility:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch BTC volatility',
    });
  }
});

router.get('/btc/history', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const lookbackHours = Math.min(Math.max(Number(req.query.lookbackHours) || 24 * 30, 6), 24 * 120);
    const resolution = String(req.query.resolution || '60');
    const cacheKey = `${lookbackHours}:${resolution}`;
    const now = Date.now();
    const cached = historyCache.get(cacheKey);

    if (!forceRefresh && cached && cached.expiresAt > now) {
      return res.json({
        success: true,
        cached: true,
        data: cached.data,
      });
    }

    const data = await buildBtcVolatilityHistory({ now, lookbackHours, resolution });
    historyCache.set(cacheKey, {
      expiresAt: now + CACHE_TTL_MS,
      data,
    });

    return res.json({
      success: true,
      cached: false,
      data,
    });
  } catch (error) {
    console.error('Error fetching BTC volatility history:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch BTC volatility history',
    });
  }
});

router.__volatilityCacheTestUtils = {
  clearCache() {
    cache = {
      expiresAt: 0,
      data: null,
    };
    historyCache.clear();
  },
};

module.exports = router;
