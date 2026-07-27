const express = require('express');
const {
  buildBtcVolatilityHistory,
  buildBtcVolatilitySnapshot,
} = require('../utils/btcVolatility');

const router = express.Router();
const CACHE_TTL_MS = 60 * 1000;
const HISTORY_CACHE_MAX_ENTRIES = 64;
const DEFAULT_LOOKBACK_HOURS = 24 * 30;
const MIN_LOOKBACK_HOURS = 6;
const MAX_LOOKBACK_HOURS = 24 * 120;
const DEFAULT_HISTORY_RESOLUTION = '60';
// 只放行 Deribit 直接支持或能整除聚合的粒度：
// 例如 61 既不是直连粒度也无法按 60 聚合，会退化成 1 秒粒度拉取最多 120 天
const SUPPORTED_HISTORY_RESOLUTIONS = ['60', '300', '900', '1800', '3600', '14400', '43200', '86400', '1D'];

let cache = {
  expiresAt: 0,
  data: null,
};
const historyCache = new Map();

/**
 * lookbackHours 只做范围裁剪不取整时，720.0001/720.0002 会各成一个缓存键，
 * 配合无上限的 Map 就是一条内存增长路径，这里统一取整。
 */
function normalizeLookbackHours(value) {
  const parsed = Number(value);
  const hours = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LOOKBACK_HOURS;
  return Math.min(Math.max(Math.floor(hours), MIN_LOOKBACK_HOURS), MAX_LOOKBACK_HOURS);
}

function normalizeHistoryResolution(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_HISTORY_RESOLUTION;
  const raw = String(value).trim();
  const canonical = raw.toLowerCase() === '1d' ? '1D' : raw;
  return SUPPORTED_HISTORY_RESOLUTIONS.includes(canonical) ? canonical : null;
}

// 过期项此前只是被跳过、从未删除，这里顺带清理并给 Map 加容量上限
function pruneHistoryCache(now) {
  historyCache.forEach((entry, key) => {
    if (!entry || entry.expiresAt <= now) historyCache.delete(key);
  });
  while (historyCache.size >= HISTORY_CACHE_MAX_ENTRIES) {
    const oldestKey = historyCache.keys().next().value;
    if (oldestKey === undefined) break;
    historyCache.delete(oldestKey);
  }
}

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
    const lookbackHours = normalizeLookbackHours(req.query.lookbackHours);
    const resolution = normalizeHistoryResolution(req.query.resolution);

    if (!resolution) {
      return res.status(400).json({
        success: false,
        error: `不支持的 resolution，可选值：${SUPPORTED_HISTORY_RESOLUTIONS.join('、')}`,
      });
    }

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
    pruneHistoryCache(now);
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
