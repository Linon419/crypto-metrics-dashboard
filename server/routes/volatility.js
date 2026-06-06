const express = require('express');
const { buildBtcVolatilitySnapshot } = require('../utils/btcVolatility');

const router = express.Router();
const CACHE_TTL_MS = 60 * 1000;

let cache = {
  expiresAt: 0,
  data: null,
};

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

router.__volatilityCacheTestUtils = {
  clearCache() {
    cache = {
      expiresAt: 0,
      data: null,
    };
  },
};

module.exports = router;
