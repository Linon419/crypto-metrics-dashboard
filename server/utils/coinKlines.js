const { Op } = require('sequelize');
const {
  KLINE_MARKETS,
  findLatestMetricDate,
  getChinaFuturesSinaTradingSymbol,
  getYahooTradingSymbol,
  normalizeBinanceTradingSymbol,
  resolveEffectiveKlineMapping,
  shouldUseChinaFuturesSina,
} = require('./coinKlineMappings');

const BINANCE_USDM_KLINES_URL = 'https://fapi.binance.com/fapi/v1/klines';
const BINANCE_SPOT_KLINES_URL = 'https://api.binance.com/api/v3/klines';
const YAHOO_FINANCE_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const CHINA_FUTURES_SINA_JSONP_URL = 'https://stock2.finance.sina.com.cn/futures/api/jsonp.php';
const DEFAULT_MARKET = 'binance_usdm_perpetual';
const BINANCE_SPOT_MARKET = 'binance_spot';
const YAHOO_FINANCE_MARKET = 'yahoo_finance';
const DERIBIT_BTC_DVOL_MARKET = 'deribit_btc_dvol';
const CHINA_FUTURES_SINA_MARKET = 'china_futures_sina';
const DERIBIT_BTC_DVOL_SYMBOL = 'BTC-DVOL';
const DEFAULT_INTERVAL = '1d';
const DEFAULT_LIMIT = 365;
const MAX_LIMIT = 1500;
const MAX_STORED_RANGE_LIMIT = 60000;
const YAHOO_FINANCE_SYNC_MIN_INTERVAL_MS = 15 * 60 * 1000;
const { buildBtcVolatilityHistory } = require('./btcVolatility');
const { ensureKlineIntervalEnabled } = require('./klineIntervalPolicy');

const SUPPORTED_INTERVALS = new Set([
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '6h',
  '8h',
  '12h',
  '1d',
  '3d',
  '1w',
  '1M',
]);

const YAHOO_SYMBOL_ALIASES = {
  A_SHARES: 'ASHR',
  A_SHARES_INDEX: 'ASHR',
  CIRCLE: 'CRCL',
  CN_AI_ETF: '159819.SZ',
  CN_INDEX: '000300.SS',
  CN_ROBOT: '562500.SS',
  ESTATE: '^HSNP',
  GOLD: 'XAU',
  NASDAO: '^IXIC',
  NASDAQ: '^IXIC',
  OIL: 'BZ=F',
  SILVER: 'SLV',
};

const DERIBIT_BTC_DVOL_COIN_SYMBOLS = new Set(['VEGA']);
// 需要节流的第三方免费行情源
const THROTTLED_SYNC_MARKETS = new Set([YAHOO_FINANCE_MARKET, CHINA_FUTURES_SINA_MARKET]);
const yahooSyncCache = new Map();
const YAHOO_FINANCE_COIN_SYMBOLS = new Set([
  ...Object.keys(YAHOO_SYMBOL_ALIASES),
  'AAOI',
  'AAPL',
  'AMZN',
  'AXTI',
  'BABA',
  'COIN',
  'GOOG',
  'HOOD',
  'MSFT',
  'MU',
  'NVDA',
  'ORCL',
  'PLTR',
  'SNDK',
  'TSLA',
]);

const INTERVAL_MS = {
  '1m': 60 * 1000,
  '3m': 3 * 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '2h': 2 * 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '8h': 8 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
  '1M': 30 * 24 * 60 * 60 * 1000,
};

function toNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }
  return number;
}

function toTimestampMs(value, fieldName = 'timestamp') {
  if (value instanceof Date) {
    const time = value.getTime();
    if (Number.isFinite(time)) return time;
  }
  return toNumber(value, fieldName);
}

function readResponseHeader(headers, name) {
  if (!headers || typeof headers.get !== 'function') return null;
  return headers.get(name)
    || headers.get(String(name).toLowerCase())
    || headers.get(String(name).toUpperCase())
    || null;
}

function parseRetryAfterMs(headers) {
  const value = readResponseHeader(headers, 'retry-after');
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }

  const dateTime = Date.parse(value);
  if (Number.isFinite(dateTime)) {
    return Math.max(0, dateTime - Date.now());
  }

  return null;
}

function parseBinanceRateLimitHeaders(headers) {
  const usedWeight1m = Number(readResponseHeader(headers, 'x-mbx-used-weight-1m'));
  const usedWeight = Number(readResponseHeader(headers, 'x-mbx-used-weight'));
  const retryAfterMs = parseRetryAfterMs(headers);
  const rateLimit = {};

  if (Number.isFinite(usedWeight1m)) {
    rateLimit.usedWeight1m = usedWeight1m;
  }
  if (Number.isFinite(usedWeight)) {
    rateLimit.usedWeight = usedWeight;
  }
  if (Number.isFinite(retryAfterMs)) {
    rateLimit.retryAfterMs = retryAfterMs;
  }

  return Object.keys(rateLimit).length > 0 ? rateLimit : null;
}

function attachRateLimitMetadata(payload, rateLimit) {
  if (!payload || !rateLimit) return payload;
  Object.defineProperty(payload, '__rateLimit', {
    value: rateLimit,
    enumerable: false,
    configurable: true,
  });
  return payload;
}

function createKlineRequestError(message, response, body) {
  const error = new Error(`${message}: ${response.status} ${body || ''}`.trim());
  error.status = response.status;
  error.retryAfterMs = parseRetryAfterMs(response.headers);
  error.rateLimit = parseBinanceRateLimitHeaders(response.headers);
  return error;
}

function isRateLimitStatusCode(status) {
  return status === 429 || status === 418;
}

function normalizeInterval(interval = DEFAULT_INTERVAL) {
  const normalized = ensureKlineIntervalEnabled(interval, DEFAULT_INTERVAL);
  if (!SUPPORTED_INTERVALS.has(normalized)) {
    throw new Error(`Unsupported kline interval: ${interval}`);
  }
  return normalized;
}

function normalizeTradingSymbol(symbol) {
  const normalized = String(symbol || '').trim().toUpperCase();
  if (!normalized) {
    throw new Error('Coin symbol is required');
  }
  return normalized.endsWith('USDT') ? normalized : `${normalized}USDT`;
}

function resolveYahooSymbol(symbol, klineMapping) {
  if (klineMapping?.enabled && klineMapping.market === YAHOO_FINANCE_MARKET) {
    return klineMapping.trading_symbol;
  }
  const normalized = String(symbol || '').trim().toUpperCase();
  if (!normalized) {
    throw new Error('Coin symbol is required');
  }
  return getYahooTradingSymbol(normalized) || YAHOO_SYMBOL_ALIASES[normalized] || normalized;
}

function shouldUseDeribitBtcDvol(symbol, klineMapping) {
  if (klineMapping?.enabled && klineMapping.market === DERIBIT_BTC_DVOL_MARKET) {
    return true;
  }
  return DERIBIT_BTC_DVOL_COIN_SYMBOLS.has(String(symbol || '').trim().toUpperCase());
}

function shouldUseYahooFinance(symbol, klineMapping) {
  if (klineMapping?.enabled) {
    return klineMapping.market === YAHOO_FINANCE_MARKET;
  }
  return YAHOO_FINANCE_COIN_SYMBOLS.has(String(symbol || '').trim().toUpperCase());
}

function shouldBlendYahooHistory(symbol, klineMapping) {
  const market = klineMapping?.enabled ? klineMapping.market : null;
  return YAHOO_FINANCE_COIN_SYMBOLS.has(String(symbol || '').trim().toUpperCase())
    && (market === DEFAULT_MARKET || market === BINANCE_SPOT_MARKET);
}

function shouldUseChinaFuturesSinaMarket(symbol, klineMapping) {
  if (klineMapping?.enabled && klineMapping.market === CHINA_FUTURES_SINA_MARKET) {
    return true;
  }
  return shouldUseChinaFuturesSina(symbol);
}

function getPreferredKlineMarket(symbol, klineMapping) {
  const effectiveMapping = klineMapping
    ? resolveEffectiveKlineMapping({ symbol }, klineMapping)
    : null;
  if (effectiveMapping?.enabled && effectiveMapping.market) return effectiveMapping.market;
  if (shouldUseDeribitBtcDvol(symbol)) return DERIBIT_BTC_DVOL_MARKET;
  if (shouldUseChinaFuturesSinaMarket(symbol)) return CHINA_FUTURES_SINA_MARKET;
  if (shouldUseYahooFinance(symbol)) return YAHOO_FINANCE_MARKET;
  return null;
}

// Yahoo 没有 4h 粒度，只能按 1h 拉取原始K线，再自行聚合成真正的 4h 蜡烛
const YAHOO_AGGREGATED_SOURCE_INTERVALS = {
  '4h': '1h',
};

function resolveYahooSourceInterval(interval = DEFAULT_INTERVAL) {
  const normalized = normalizeInterval(interval);
  return YAHOO_AGGREGATED_SOURCE_INTERVALS[normalized] || normalized;
}

function normalizeYahooInterval(interval = DEFAULT_INTERVAL) {
  const sourceInterval = resolveYahooSourceInterval(interval);
  if (sourceInterval === '1w') return '1wk';
  if (sourceInterval === '1M') return '1mo';
  return sourceInterval;
}

function normalizeChinaFuturesSinaIntervalType(interval = DEFAULT_INTERVAL) {
  const normalized = normalizeInterval(interval);
  const intervalTypes = {
    '15m': '15',
    '30m': '30',
    '1h': '60',
    '4h': '240',
    '1d': 'D',
  };
  const type = intervalTypes[normalized];
  if (!type) {
    throw new Error(`Unsupported China futures Sina interval: ${interval}`);
  }
  return type;
}

function normalizeLimit(limit = DEFAULT_LIMIT) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function normalizeStoredKlineLimit({
  interval = DEFAULT_INTERVAL,
  limit = DEFAULT_LIMIT,
  startTime,
  endTime,
} = {}) {
  const baseLimit = normalizeLimit(limit);
  if (startTime === undefined || startTime === null || endTime === undefined || endTime === null) {
    return baseLimit;
  }

  const intervalMs = INTERVAL_MS[normalizeInterval(interval)];
  const start = toTimestampMs(startTime, 'startTime');
  const end = toTimestampMs(endTime, 'endTime');
  if (!Number.isFinite(intervalMs) || intervalMs <= 0 || end < start) {
    return baseLimit;
  }

  const rangeLimit = Math.ceil((end - start + 1) / intervalMs) + 2;
  return Math.min(Math.max(baseLimit, rangeLimit), MAX_STORED_RANGE_LIMIT);
}

function buildKlineSyncCacheKey({
  market,
  coinSymbol,
  interval = DEFAULT_INTERVAL,
  limit = DEFAULT_LIMIT,
  startTime,
  endTime,
  includePrePost = false,
} = {}) {
  return [
    String(market || ''),
    String(coinSymbol || '').trim().toUpperCase(),
    normalizeInterval(interval),
    normalizeLimit(limit),
    startTime ? String(toTimestampMs(startTime, 'startTime')) : '',
    endTime ? String(toTimestampMs(endTime, 'endTime')) : '',
    includePrePost ? 'prepost' : 'regular',
  ].join(':');
}

// Yahoo 与新浪国内期货都是第三方免费接口，需要节流，避免每个请求都打真实 HTTP
function resolveThrottledSyncMarket(coinSymbol, klineMapping) {
  const market = getPreferredKlineMarket(coinSymbol, klineMapping);
  return THROTTLED_SYNC_MARKETS.has(market) ? market : null;
}

function resolveThrottledMarketTradingSymbol(market, coinSymbol, klineMapping) {
  if (klineMapping?.trading_symbol) return klineMapping.trading_symbol;
  if (market === CHINA_FUTURES_SINA_MARKET) return getChinaFuturesSinaTradingSymbol(coinSymbol);
  return resolveYahooSymbol(coinSymbol, klineMapping);
}

function shouldSkipMarketSync({
  coinSymbol,
  klineMapping,
  interval = DEFAULT_INTERVAL,
  limit = DEFAULT_LIMIT,
  startTime,
  endTime,
  includePrePost = false,
  minSyncIntervalMs = 0,
  now = Date.now(),
} = {}) {
  const minInterval = Number(minSyncIntervalMs);
  const market = resolveThrottledSyncMarket(coinSymbol, klineMapping);
  if (!market) {
    return { skip: false, market: null };
  }

  const key = buildKlineSyncCacheKey({
    market,
    coinSymbol: klineMapping?.trading_symbol || coinSymbol,
    interval,
    limit,
    startTime,
    endTime,
    includePrePost,
  });
  if (!Number.isFinite(minInterval) || minInterval <= 0) {
    return { skip: false, market, key };
  }

  const nowMs = toTimestampMs(now, 'now');
  const lastSyncedAt = yahooSyncCache.get(key);
  if (Number.isFinite(lastSyncedAt) && nowMs - lastSyncedAt < minInterval) {
    return {
      skip: true,
      market,
      key,
      lastSyncedAt,
      nextAllowedAt: lastSyncedAt + minInterval,
    };
  }

  return { skip: false, market, key };
}

function rememberKlineSync(cacheKey, now = Date.now()) {
  if (!cacheKey) return;
  yahooSyncCache.set(cacheKey, toTimestampMs(now, 'now'));
}

function clearYahooSyncCache() {
  yahooSyncCache.clear();
}

function shouldFilterYahooZeroVolumeRows(tradingSymbol) {
  const symbol = String(tradingSymbol || '').trim().toUpperCase();
  if (!symbol) return false;
  if (symbol.startsWith('^')) return false;
  if (['XAU', 'XAG'].includes(symbol)) return false;
  if (/[.=]/.test(symbol)) return false;
  return true;
}

// 各市场的K线相位不同（国内期货日线开在 UTC 16:00、美股日线开在 UTC 13:30），
// 直接假设 UTC 整点对齐会把这些行情永远判成过期，这里按实际观测到的相位推算周期起点
function resolveIntervalPhaseMs(rows = [], intervalMs) {
  const phaseCounts = new Map();
  let dominantPhase = 0;
  let dominantCount = 0;

  rows.forEach((row) => {
    const value = row?.open_time ?? row?.openTime;
    const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
    if (!Number.isFinite(time)) return;

    const phase = ((time % intervalMs) + intervalMs) % intervalMs;
    const count = (phaseCounts.get(phase) || 0) + 1;
    phaseCounts.set(phase, count);
    if (count > dominantCount) {
      dominantCount = count;
      dominantPhase = phase;
    }
  });

  return dominantPhase;
}

function shouldRefreshStoredCoinKlines({
  rows = [],
  interval = DEFAULT_INTERVAL,
  endTime,
  now = Date.now(),
} = {}) {
  if (endTime !== undefined && endTime !== null) return false;
  if (!Array.isArray(rows) || rows.length === 0) return true;

  const intervalMs = INTERVAL_MS[normalizeInterval(interval)];
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return false;

  const nowMs = toTimestampMs(now, 'now');
  const phaseMs = resolveIntervalPhaseMs(rows, intervalMs);
  const currentBucketStart = Math.floor((nowMs - phaseMs) / intervalMs) * intervalMs + phaseMs;
  const latestOpenTime = rows.reduce((latest, row) => {
    const value = row?.open_time ?? row?.openTime;
    const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(time) && time > latest ? time : latest;
  }, -Infinity);

  return Number.isFinite(latestOpenTime) && latestOpenTime < currentBucketStart;
}

function toPlainRow(row) {
  if (!row) return null;
  if (typeof row.get === 'function') return row.get({ plain: true });
  return row;
}

function resolveMetricTimestampMs(metric = {}) {
  if (metric.timestamp) {
    const timestampTime = new Date(metric.timestamp).getTime();
    if (Number.isFinite(timestampTime)) return timestampTime;
  }

  if (typeof metric.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(metric.date)) {
    const dateTime = new Date(`${metric.date}T00:00:00.000Z`).getTime();
    if (Number.isFinite(dateTime)) return dateTime;
  }

  if (metric.date) {
    const dateTime = new Date(metric.date).getTime();
    if (Number.isFinite(dateTime)) return dateTime;
  }

  return null;
}

function alignTimestampToIntervalStart(timestampMs, interval = DEFAULT_INTERVAL) {
  const intervalMs = INTERVAL_MS[normalizeInterval(interval)];
  const parsedTimestamp = toTimestampMs(timestampMs, 'timestamp');
  return Math.floor(parsedTimestamp / intervalMs) * intervalMs;
}

async function findCoinKlineBackfillGaps({
  interval = DEFAULT_INTERVAL,
  marketFilter = null,
  refreshCovered = false,
  CoinModel,
  DailyMetricModel,
  CoinKlineModel,
  CoinKlineMappingModel,
} = {}) {
  if (!CoinModel?.findAll) {
    throw new Error('Coin model is required');
  }
  if (!DailyMetricModel?.findOne) {
    throw new Error('DailyMetric model is required');
  }
  if (!CoinKlineModel?.findOne) {
    throw new Error('CoinKline model is required');
  }

  const normalizedInterval = normalizeInterval(interval);
  const rawCoins = await CoinModel.findAll({
    attributes: ['id', 'symbol', 'name'],
    order: [['symbol', 'ASC']],
    raw: true,
  });
  const latestMetricDate = await findLatestMetricDate(DailyMetricModel);
  const coins = rawCoins;
  const items = [];
  let skippedCovered = 0;
  let skippedNoMetrics = 0;
  let skippedInvalidMetrics = 0;
  let skippedStaleMetrics = 0;
  let skippedMarket = 0;

  for (const rawCoin of coins) {
    const coin = toPlainRow(rawCoin);
    if (!coin?.id || !coin?.symbol) continue;

    const rawMetric = await DailyMetricModel.findOne({
      where: { coin_id: coin.id },
      order: [['date', 'ASC'], ['timestamp', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
    const metric = toPlainRow(rawMetric);

    if (!metric) {
      skippedNoMetrics += 1;
      continue;
    }

    const rawLatestMetric = await DailyMetricModel.findOne({
      where: { coin_id: coin.id },
      order: [['date', 'DESC'], ['timestamp', 'DESC'], ['id', 'DESC']],
      raw: true,
    });
    const latestMetric = toPlainRow(rawLatestMetric) || metric;
    if (
      latestMetricDate
      && latestMetric?.date
      && String(latestMetric.date) !== String(latestMetricDate)
    ) {
      skippedStaleMetrics += 1;
      continue;
    }

    const metricTimestamp = resolveMetricTimestampMs(metric);
    if (!Number.isFinite(metricTimestamp)) {
      skippedInvalidMetrics += 1;
      continue;
    }

    const startTime = alignTimestampToIntervalStart(metricTimestamp, normalizedInterval);
    const intervalMs = INTERVAL_MS[normalizedInterval];
    const latestMetricTimestamp = resolveMetricTimestampMs(latestMetric);
    const metricEndTime = Number.isFinite(latestMetricTimestamp)
      ? alignTimestampToIntervalStart(latestMetricTimestamp, normalizedInterval) + intervalMs - 1
      : startTime + intervalMs - 1;
    const rawKlineMapping = CoinKlineMappingModel?.findOne
      ? await CoinKlineMappingModel.findOne({
        where: { coin_id: coin.id },
        raw: true,
      })
      : null;
    const effectiveMapping = resolveEffectiveKlineMapping(coin, rawKlineMapping);
    const market = getPreferredKlineMarket(coin.symbol, effectiveMapping);
    const tradingSymbol = effectiveMapping?.trading_symbol || null;

    if (marketFilter && market !== marketFilter) {
      skippedMarket += 1;
      continue;
    }

    const klineWhere = {
      coin_id: coin.id,
      interval: normalizedInterval,
    };
    if (market) {
      klineWhere.market = market;
    }
    if (tradingSymbol) {
      klineWhere.trading_symbol = tradingSymbol;
    }

    const rawEarliestKline = await CoinKlineModel.findOne({
      where: klineWhere,
      order: [['open_time', 'ASC']],
      raw: true,
    });
    const earliestKline = toPlainRow(rawEarliestKline);
    const earliestKlineTime = earliestKline?.open_time
      ? new Date(earliestKline.open_time).getTime()
      : null;

    if (!refreshCovered && Number.isFinite(earliestKlineTime) && earliestKlineTime <= startTime) {
      skippedCovered += 1;
      continue;
    }

    items.push({
      coinId: coin.id,
      coinSymbol: String(coin.symbol).toUpperCase(),
      coinName: coin.name || String(coin.symbol).toUpperCase(),
      market: market || null,
      ...(effectiveMapping ? { klineMapping: effectiveMapping } : {}),
      interval: normalizedInterval,
      startTime,
      endTime: refreshCovered
        ? metricEndTime
        : (Number.isFinite(earliestKlineTime) ? earliestKlineTime - 1 : metricEndTime),
      metricStartTime: startTime,
      earliestKlineTime: Number.isFinite(earliestKlineTime) ? earliestKlineTime : null,
    });
  }

  return {
    interval: normalizedInterval,
    totalCoins: rawCoins.length,
    items,
    skippedCovered,
    skippedNoMetrics,
    skippedInvalidMetrics,
    skippedStaleMetrics,
    skippedMarket,
  };
}

function buildCoinKlineBackfillChunks({
  startTime,
  endTime,
  interval = DEFAULT_INTERVAL,
  limit = MAX_LIMIT,
  maxChunks = 100,
} = {}) {
  const normalizedInterval = normalizeInterval(interval);
  const normalizedLimit = normalizeLimit(limit);
  const intervalMs = INTERVAL_MS[normalizedInterval];
  const start = alignTimestampToIntervalStart(startTime, normalizedInterval);
  const parsedMaxChunks = Number(maxChunks);
  const chunkLimit = Number.isFinite(parsedMaxChunks) && parsedMaxChunks > 0
    ? Math.floor(parsedMaxChunks)
    : 100;

  if (endTime === undefined || endTime === null) {
    return [{ startTime: start, endTime: null }];
  }

  const end = toTimestampMs(endTime, 'endTime');
  if (end < start) return [];

  const chunks = [];
  let cursor = start;
  while (cursor <= end && chunks.length < chunkLimit) {
    const chunkEnd = Math.min(end, cursor + intervalMs * normalizedLimit - 1);
    chunks.push({ startTime: cursor, endTime: chunkEnd });
    // chunkEnd + 1 未落在周期边界时向下对齐会倒退到 chunkEnd 之前，
    // 导致游标原地打转、同一分片一直重复到 maxChunks，这里强制单调前进
    const alignedCursor = alignTimestampToIntervalStart(chunkEnd + 1, normalizedInterval);
    cursor = Math.max(alignedCursor, chunkEnd + 1);
  }

  return chunks;
}

function resolveDvolResolutionForInterval(interval = DEFAULT_INTERVAL) {
  const normalized = normalizeInterval(interval);
  if (normalized === '15m') return '900';
  if (normalized === '1h') return '3600';
  if (normalized === '4h') return '14400';
  if (normalized === '1d') return '1D';
  return String(INTERVAL_MS[normalized] / 1000);
}

function resolveDvolLookbackHours({ interval = DEFAULT_INTERVAL, limit = DEFAULT_LIMIT, startTime, endTime } = {}) {
  const now = endTime ? toNumber(endTime, 'endTime') : Date.now();
  if (startTime) {
    const start = toNumber(startTime, 'startTime');
    return Math.max(1, Math.ceil((now - start) / (60 * 60 * 1000)) + 1);
  }

  const intervalMs = INTERVAL_MS[normalizeInterval(interval)] || INTERVAL_MS[DEFAULT_INTERVAL];
  return Math.max(1, Math.ceil((normalizeLimit(limit) + 5) * intervalMs / (60 * 60 * 1000)));
}

function parseBinanceKlineRow(row, {
  coinId,
  coinSymbol,
  tradingSymbol,
  interval = DEFAULT_INTERVAL,
  market = DEFAULT_MARKET,
} = {}) {
  if (!Array.isArray(row) || row.length < 11) {
    throw new Error('Invalid Binance kline payload');
  }

  return {
    coin_id: coinId,
    coin_symbol: String(coinSymbol || '').toUpperCase(),
    trading_symbol: normalizeTradingSymbol(tradingSymbol || coinSymbol),
    market,
    interval: normalizeInterval(interval),
    open_time: new Date(toNumber(row[0], 'openTime')),
    close_time: new Date(toNumber(row[6], 'closeTime')),
    open_price: toNumber(row[1], 'open'),
    high_price: toNumber(row[2], 'high'),
    low_price: toNumber(row[3], 'low'),
    close_price: toNumber(row[4], 'close'),
    volume: toNumber(row[5], 'volume'),
    quote_volume: toNumber(row[7], 'quoteVolume'),
    trade_count: Math.trunc(toNumber(row[8], 'tradeCount')),
  };
}

function buildBinanceUsdmKlinesUrl({
  symbol,
  interval = DEFAULT_INTERVAL,
  limit = DEFAULT_LIMIT,
  startTime,
  endTime,
} = {}) {
  const params = new URLSearchParams({
    symbol: normalizeTradingSymbol(symbol),
    interval: normalizeInterval(interval),
    limit: String(normalizeLimit(limit)),
  });

  if (startTime !== undefined && startTime !== null) {
    params.set('startTime', String(toNumber(startTime, 'startTime')));
  }
  if (endTime !== undefined && endTime !== null) {
    params.set('endTime', String(toNumber(endTime, 'endTime')));
  }

  return `${BINANCE_USDM_KLINES_URL}?${params.toString()}`;
}

function buildBinanceSpotKlinesUrl({
  symbol,
  interval = DEFAULT_INTERVAL,
  limit = DEFAULT_LIMIT,
  startTime,
  endTime,
} = {}) {
  const params = new URLSearchParams({
    symbol: normalizeTradingSymbol(symbol),
    interval: normalizeInterval(interval),
    limit: String(normalizeLimit(limit)),
  });

  if (startTime !== undefined && startTime !== null) {
    params.set('startTime', String(toNumber(startTime, 'startTime')));
  }
  if (endTime !== undefined && endTime !== null) {
    params.set('endTime', String(toNumber(endTime, 'endTime')));
  }

  return `${BINANCE_SPOT_KLINES_URL}?${params.toString()}`;
}

function buildYahooFinanceChartUrl({
  symbol,
  interval = DEFAULT_INTERVAL,
  range,
  startTime,
  endTime,
  includePrePost = false,
} = {}) {
  const yahooSymbol = resolveYahooSymbol(symbol);
  const params = new URLSearchParams({
    interval: normalizeYahooInterval(interval),
    includePrePost: includePrePost ? 'true' : 'false',
    events: 'history',
  });

  if (startTime || endTime) {
    if (startTime) params.set('period1', String(Math.floor(toNumber(startTime, 'startTime') / 1000)));
    if (endTime) params.set('period2', String(Math.floor(toNumber(endTime, 'endTime') / 1000)));
  } else {
    params.set('range', range || (normalizeInterval(interval) === '1d' ? '2y' : '60d'));
  }

  return `${YAHOO_FINANCE_CHART_URL}/${encodeURIComponent(yahooSymbol)}?${params.toString()}`;
}

function buildChinaFuturesSinaUrl({
  symbol,
  interval = DEFAULT_INTERVAL,
  limit = DEFAULT_LIMIT,
  timestamp = Date.now(),
} = {}) {
  const tradingSymbol = String(symbol || '').trim().toUpperCase();
  if (!tradingSymbol) {
    throw new Error('China futures Sina symbol is required');
  }

  const type = normalizeChinaFuturesSinaIntervalType(interval);
  const normalizedLimit = normalizeLimit(limit);
  const stamp = new Date(toTimestampMs(timestamp, 'timestamp'))
    .toISOString()
    .replace(/\D/g, '')
    .slice(0, 14);
  const callback = `var _${tradingSymbol}_${type}_${stamp}=`;
  const service = type === 'D'
    ? 'InnerFuturesNewService.getDailyKLine'
    : 'InnerFuturesNewService.getFewMinLine';
  const params = new URLSearchParams({ symbol: tradingSymbol });

  if (type === 'D') {
    params.set('datalen', String(normalizedLimit));
  } else {
    params.set('type', type);
  }

  return `${CHINA_FUTURES_SINA_JSONP_URL}/${encodeURIComponent(callback)}/${service}?${params.toString()}`;
}

async function fetchKlinesFromUrl(url, fetchImpl, errorPrefix) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable in this Node runtime');
  }

  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'crypto-metrics-dashboard/0.1',
    },
  });
  const rateLimit = parseBinanceRateLimitHeaders(response.headers);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw createKlineRequestError(errorPrefix, response, body);
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error(`${errorPrefix}: invalid response`);
  }
  return attachRateLimitMetadata(payload, rateLimit);
}

async function fetchBinanceUsdmKlines({
  symbol,
  interval = DEFAULT_INTERVAL,
  limit = DEFAULT_LIMIT,
  startTime,
  endTime,
  fetchImpl = global.fetch,
} = {}) {
  const url = buildBinanceUsdmKlinesUrl({
    symbol,
    interval,
    limit,
    startTime,
    endTime,
  });
  return fetchKlinesFromUrl(url, fetchImpl, 'Binance futures kline request failed');
}

async function fetchBinanceSpotKlines({
  symbol,
  interval = DEFAULT_INTERVAL,
  limit = DEFAULT_LIMIT,
  startTime,
  endTime,
  fetchImpl = global.fetch,
} = {}) {
  const url = buildBinanceSpotKlinesUrl({
    symbol,
    interval,
    limit,
    startTime,
    endTime,
  });
  return fetchKlinesFromUrl(url, fetchImpl, 'Binance spot kline request failed');
}

async function fetchYahooFinanceChart({
  symbol,
  interval = DEFAULT_INTERVAL,
  limit = DEFAULT_LIMIT,
  startTime,
  endTime,
  includePrePost = false,
  fetchImpl = global.fetch,
} = {}) {
  const url = buildYahooFinanceChartUrl({
    symbol,
    interval,
    startTime,
    endTime,
    includePrePost,
  });
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'Mozilla/5.0 crypto-metrics-dashboard/0.1',
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Yahoo Finance chart request failed: ${response.status} ${body}`.trim());
  }

  const payload = await response.json();
  const error = payload?.chart?.error;
  if (error) {
    throw new Error(`Yahoo Finance chart request failed: ${error.code || 'error'} ${error.description || ''}`.trim());
  }

  const result = payload?.chart?.result?.[0];
  if (!result) {
    throw new Error('Yahoo Finance chart response is empty');
  }

  const rows = parseYahooChartResult(result, {
    coinSymbol: symbol,
    tradingSymbol: result.meta?.symbol || resolveYahooSymbol(symbol),
    interval,
  });

  return rows.slice(-normalizeLimit(limit));
}

function parseChinaFuturesSinaJsonp(text) {
  const rawText = String(text || '');
  const start = rawText.indexOf('(');
  const end = rawText.lastIndexOf(')');
  if (start < 0 || end <= start) {
    throw new Error('China futures Sina response is not JSONP');
  }

  const payload = JSON.parse(rawText.slice(start + 1, end));
  if (payload && !Array.isArray(payload) && payload.__ERROR) {
    throw new Error(`China futures Sina request failed: ${payload.__ERRORMSG || payload.__ERROR}`);
  }
  if (!Array.isArray(payload)) {
    throw new Error('China futures Sina response is empty');
  }

  return payload;
}

function parseChinaFuturesSinaTimestamp(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return Date.parse(`${text}T00:00:00+08:00`);
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    return Date.parse(`${text.replace(' ', 'T')}+08:00`);
  }
  return Date.parse(text);
}

function parseChinaFuturesSinaKlineRows(rows, {
  coinId,
  coinSymbol,
  tradingSymbol,
  interval = DEFAULT_INTERVAL,
} = {}) {
  if (!Array.isArray(rows)) {
    throw new Error('Invalid China futures Sina kline payload');
  }

  const normalizedInterval = normalizeInterval(interval);
  const intervalMs = INTERVAL_MS[normalizedInterval] || INTERVAL_MS['1d'];
  const resolvedTradingSymbol = String(tradingSymbol || getChinaFuturesSinaTradingSymbol(coinSymbol)).toUpperCase();

  return rows
    .map((row) => {
      const openTimeMs = parseChinaFuturesSinaTimestamp(row?.d);
      if (!Number.isFinite(openTimeMs)) return null;

      return {
        coin_id: coinId,
        coin_symbol: String(coinSymbol || '').toUpperCase(),
        trading_symbol: resolvedTradingSymbol,
        market: CHINA_FUTURES_SINA_MARKET,
        interval: normalizedInterval,
        open_time: new Date(openTimeMs),
        close_time: new Date(openTimeMs + intervalMs - 1),
        open_price: toNumber(row.o, 'open'),
        high_price: toNumber(row.h, 'high'),
        low_price: toNumber(row.l, 'low'),
        close_price: toNumber(row.c, 'close'),
        volume: toNumber(row.v || 0, 'volume'),
        quote_volume: toNumber(row.p || 0, 'openInterest'),
        trade_count: 0,
      };
    })
    .filter(Boolean);
}

async function fetchChinaFuturesSinaKlines({
  symbol,
  interval = DEFAULT_INTERVAL,
  limit = DEFAULT_LIMIT,
  startTime,
  endTime,
  fetchImpl = global.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable in this Node runtime');
  }

  const url = buildChinaFuturesSinaUrl({ symbol, interval, limit });
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/javascript,text/javascript,*/*',
      'user-agent': 'Mozilla/5.0 crypto-metrics-dashboard/0.1',
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`China futures Sina request failed: ${response.status} ${body}`.trim());
  }

  const text = await response.text();
  const rawRows = parseChinaFuturesSinaJsonp(text);
  const startMs = startTime ? toNumber(startTime, 'startTime') : null;
  const endMs = endTime ? toNumber(endTime, 'endTime') : null;
  const rows = parseChinaFuturesSinaKlineRows(rawRows, {
    coinSymbol: symbol,
    tradingSymbol: symbol,
    interval,
  });

  return rows
    .filter(row => (startMs === null || row.open_time.getTime() >= startMs)
      && (endMs === null || row.open_time.getTime() <= endMs))
    .slice(-normalizeLimit(limit));
}

async function fetchDeribitBtcDvolKlines({
  interval = DEFAULT_INTERVAL,
  limit = DEFAULT_LIMIT,
  startTime,
  endTime,
  fetchImpl = global.fetch,
} = {}) {
  const normalizedInterval = normalizeInterval(interval);
  const normalizedLimit = normalizeLimit(limit);
  const now = endTime ? toNumber(endTime, 'endTime') : Date.now();
  const lookbackHours = resolveDvolLookbackHours({
    interval: normalizedInterval,
    limit: normalizedLimit,
    startTime,
    endTime,
  });
  const history = await buildBtcVolatilityHistory({
    fetchImpl,
    lookbackHours,
    now,
    resolution: resolveDvolResolutionForInterval(normalizedInterval),
  });
  const intervalMs = INTERVAL_MS[normalizedInterval] || INTERVAL_MS[DEFAULT_INTERVAL];
  const startMs = startTime ? toNumber(startTime, 'startTime') : null;
  const endMs = endTime ? toNumber(endTime, 'endTime') : null;

  return history.candles
    .map((candle) => {
      const openTimeMs = Date.parse(candle.timestamp);
      return {
        coin_symbol: 'VEGA',
        trading_symbol: DERIBIT_BTC_DVOL_SYMBOL,
        market: DERIBIT_BTC_DVOL_MARKET,
        interval: normalizedInterval,
        open_time: new Date(openTimeMs),
        close_time: new Date(openTimeMs + intervalMs - 1),
        open_price: candle.open,
        high_price: candle.high,
        low_price: candle.low,
        close_price: candle.close,
        volume: 0,
        quote_volume: 0,
        trade_count: 0,
      };
    })
    .filter(row => Number.isFinite(row.open_time.getTime()))
    .filter(row => (startMs === null || row.open_time.getTime() >= startMs)
      && (endMs === null || row.open_time.getTime() <= endMs))
    .slice(-normalizedLimit);
}

// 把细粒度K线按目标周期边界合并成真实蜡烛：开=首根开，高=最高，低=最低，收=末根收，量=求和
function aggregateKlineRowsToInterval(rows = [], interval = DEFAULT_INTERVAL) {
  const normalizedInterval = normalizeInterval(interval);
  const intervalMs = INTERVAL_MS[normalizedInterval];
  const buckets = new Map();

  [...rows]
    .filter(row => Number.isFinite(getStoredKlineOpenTimeMs(row)))
    .sort((left, right) => getStoredKlineOpenTimeMs(left) - getStoredKlineOpenTimeMs(right))
    .forEach((row) => {
      const bucketStart = Math.floor(getStoredKlineOpenTimeMs(row) / intervalMs) * intervalMs;
      const bucket = buckets.get(bucketStart);

      if (!bucket) {
        buckets.set(bucketStart, {
          ...row,
          interval: normalizedInterval,
          open_time: new Date(bucketStart),
          close_time: new Date(bucketStart + intervalMs - 1),
        });
        return;
      }

      bucket.high_price = Math.max(bucket.high_price, row.high_price);
      bucket.low_price = Math.min(bucket.low_price, row.low_price);
      bucket.close_price = row.close_price;
      bucket.volume += row.volume;
      bucket.quote_volume += row.quote_volume;
      bucket.trade_count += row.trade_count;
    });

  return Array.from(buckets.entries())
    .sort(([left], [right]) => left - right)
    .map(([, row]) => row);
}

// Yahoo 会把正在形成的最后一根K线的时间戳返回为当前报价时间（秒级毛刺），
// 这里按上一根K线的相位对齐回它所属的周期，避免每次同步都新增一行脏数据
function alignYahooInProgressRow(rows, intervalMs, regularMarketTimeMs) {
  if (!Array.isArray(rows) || rows.length < 2) return rows;

  const lastRow = rows[rows.length - 1];
  const lastOpenTime = lastRow.open_time.getTime();
  const previousOpenTime = rows[rows.length - 2].open_time.getTime();
  // 正常K线起点一定落在整分钟上，缺少 meta.regularMarketTime 时以此兜底判断
  const isQuoteTimestamp = Number.isFinite(regularMarketTimeMs)
    ? regularMarketTimeMs === lastOpenTime
    : lastOpenTime % 60000 !== 0;

  if (!isQuoteTimestamp) return rows;

  const alignedOpenTime = previousOpenTime
    + Math.floor((lastOpenTime - previousOpenTime) / intervalMs) * intervalMs;
  if (alignedOpenTime === lastOpenTime) return rows;
  // 对齐后与上一根重合时直接丢弃，交给下一次同步刷新那根K线
  if (alignedOpenTime === previousOpenTime) return rows.slice(0, -1);

  return [
    ...rows.slice(0, -1),
    {
      ...lastRow,
      open_time: new Date(alignedOpenTime),
      close_time: new Date(alignedOpenTime + intervalMs - 1),
    },
  ];
}

function parseYahooChartResult(result, {
  coinId,
  coinSymbol,
  tradingSymbol,
  interval = DEFAULT_INTERVAL,
} = {}) {
  const timestamps = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];
  if (!Array.isArray(timestamps) || !quote) {
    throw new Error('Invalid Yahoo Finance chart payload');
  }

  const normalizedInterval = normalizeInterval(interval);
  // Yahoo 实际返回的是 sourceInterval 粒度（4h 请求会拿到 1h），先按真实粒度落行再聚合
  const sourceInterval = resolveYahooSourceInterval(normalizedInterval);
  const intervalMs = INTERVAL_MS[sourceInterval] || INTERVAL_MS['1d'];
  const resolvedTradingSymbol = tradingSymbol || result?.meta?.symbol || resolveYahooSymbol(coinSymbol);
  const regularMarketTime = Number(result?.meta?.regularMarketTime);
  const rows = [];

  timestamps.forEach((timestampSeconds, index) => {
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    if ([open, high, low, close].some(value => value === null || value === undefined)) {
      return;
    }

    const openTimeMs = toNumber(timestampSeconds, 'timestamp') * 1000;
    rows.push({
      coin_id: coinId,
      coin_symbol: String(coinSymbol || '').toUpperCase(),
      trading_symbol: resolvedTradingSymbol,
      market: YAHOO_FINANCE_MARKET,
      interval: sourceInterval,
      open_time: new Date(openTimeMs),
      close_time: new Date(openTimeMs + intervalMs - 1),
      open_price: toNumber(open, 'open'),
      high_price: toNumber(high, 'high'),
      low_price: toNumber(low, 'low'),
      close_price: toNumber(close, 'close'),
      volume: toNumber(quote.volume?.[index] || 0, 'volume'),
      quote_volume: 0,
      trade_count: 0,
    });
  });

  const alignedRows = alignYahooInProgressRow(
    rows,
    intervalMs,
    Number.isFinite(regularMarketTime) ? regularMarketTime * 1000 : null
  );

  return sourceInterval === normalizedInterval
    ? alignedRows
    : aggregateKlineRowsToInterval(alignedRows, normalizedInterval);
}

async function fetchMarketKlinesWithFallback(options) {
  const klineMapping = options.klineMapping || null;

  if (klineMapping?.enabled && klineMapping.market === KLINE_MARKETS.YAHOO_FINANCE) {
    const yahooSymbol = klineMapping.trading_symbol;
    const rows = await fetchYahooFinanceChart({
      ...options,
      symbol: yahooSymbol,
    });
    return {
      rows,
      market: YAHOO_FINANCE_MARKET,
      tradingSymbol: yahooSymbol,
      normalizedRows: true,
      fallbackReason: null,
    };
  }

  if (klineMapping?.enabled && klineMapping.market === KLINE_MARKETS.BINANCE_USDM_PERPETUAL) {
    const tradingSymbol = normalizeBinanceTradingSymbol(klineMapping.trading_symbol);
    const rows = await fetchBinanceUsdmKlines({
      ...options,
      symbol: tradingSymbol,
    });
    return { rows, market: DEFAULT_MARKET, tradingSymbol };
  }

  if (klineMapping?.enabled && klineMapping.market === KLINE_MARKETS.BINANCE_SPOT) {
    const tradingSymbol = normalizeBinanceTradingSymbol(klineMapping.trading_symbol);
    const rows = await fetchBinanceSpotKlines({
      ...options,
      symbol: tradingSymbol,
    });
    return { rows, market: BINANCE_SPOT_MARKET, tradingSymbol };
  }

  if (klineMapping?.enabled && klineMapping.market === KLINE_MARKETS.CHINA_FUTURES_SINA) {
    const tradingSymbol = String(klineMapping.trading_symbol || '').trim().toUpperCase();
    const rows = await fetchChinaFuturesSinaKlines({
      ...options,
      symbol: tradingSymbol,
    });
    return {
      rows,
      market: CHINA_FUTURES_SINA_MARKET,
      tradingSymbol,
      normalizedRows: true,
      fallbackReason: null,
    };
  }

  if (shouldUseYahooFinance(options.coinSymbol)) {
    const yahooSymbol = resolveYahooSymbol(options.coinSymbol);
    const rows = await fetchYahooFinanceChart({
      ...options,
      symbol: yahooSymbol,
    });
    return {
      rows,
      market: YAHOO_FINANCE_MARKET,
      tradingSymbol: yahooSymbol,
      normalizedRows: true,
      fallbackReason: null,
    };
  }

  if (shouldUseChinaFuturesSinaMarket(options.coinSymbol)) {
    const tradingSymbol = getChinaFuturesSinaTradingSymbol(options.coinSymbol);
    const rows = await fetchChinaFuturesSinaKlines({
      ...options,
      symbol: tradingSymbol,
    });
    return {
      rows,
      market: CHINA_FUTURES_SINA_MARKET,
      tradingSymbol,
      normalizedRows: true,
      fallbackReason: null,
    };
  }

  try {
    const rows = await fetchBinanceUsdmKlines({
      ...options,
      symbol: options.binanceSymbol,
    });
    return { rows, market: DEFAULT_MARKET, tradingSymbol: options.binanceSymbol };
  } catch (futuresError) {
    if (isRateLimitStatusCode(futuresError.status)) {
      throw futuresError;
    }
    try {
      const rows = await fetchBinanceSpotKlines({
        ...options,
        symbol: options.binanceSymbol,
      });
      return {
        rows,
        market: BINANCE_SPOT_MARKET,
        tradingSymbol: options.binanceSymbol,
        fallbackReason: futuresError.message,
      };
    } catch (spotError) {
      if (isRateLimitStatusCode(spotError.status)) {
        throw spotError;
      }
      const yahooSymbol = resolveYahooSymbol(options.coinSymbol);
      const rows = await fetchYahooFinanceChart({
        ...options,
        symbol: yahooSymbol,
      });
      return {
        rows,
        market: YAHOO_FINANCE_MARKET,
        tradingSymbol: yahooSymbol,
        normalizedRows: true,
        fallbackReason: `${futuresError.message}; ${spotError.message}`,
      };
    }
  }
}

async function syncCoinKlines({
  coin,
  klineMapping,
  interval = DEFAULT_INTERVAL,
  limit = DEFAULT_LIMIT,
  startTime,
  endTime,
  includePrePost = false,
  force = false,
  minSyncIntervalMs = 0,
  now = Date.now(),
  fetchImpl = global.fetch,
  CoinKlineModel,
} = {}) {
  if (!coin?.id || !coin?.symbol) {
    throw new Error('Coin with id and symbol is required');
  }
  if (!CoinKlineModel?.upsert) {
    throw new Error('CoinKline model is required');
  }

  const normalizedInterval = normalizeInterval(interval);
  const normalizedLimit = normalizeLimit(limit);
  const effectiveMapping = klineMapping
    ? resolveEffectiveKlineMapping(coin, klineMapping)
    : null;
  const marketSyncCheck = shouldSkipMarketSync({
    coinSymbol: coin.symbol,
    klineMapping: effectiveMapping,
    interval: normalizedInterval,
    limit: normalizedLimit,
    startTime,
    endTime,
    includePrePost,
    minSyncIntervalMs,
    now,
  });

  if (!force && marketSyncCheck.skip) {
    return {
      coinId: coin.id,
      coinSymbol: String(coin.symbol).toUpperCase(),
      tradingSymbol: resolveThrottledMarketTradingSymbol(
        marketSyncCheck.market,
        coin.symbol,
        effectiveMapping
      ),
      market: marketSyncCheck.market,
      fallbackReason: null,
      interval: normalizedInterval,
      fetched: 0,
      saved: 0,
      skipped: true,
      nextAllowedAt: new Date(marketSyncCheck.nextAllowedAt).toISOString(),
    };
  }

  if (shouldUseDeribitBtcDvol(coin.symbol, effectiveMapping)) {
    const parsedRows = await fetchDeribitBtcDvolKlines({
      interval: normalizedInterval,
      limit: normalizedLimit,
      startTime,
      endTime,
      fetchImpl,
    });

    for (const payload of parsedRows) {
      await CoinKlineModel.upsert({
        ...payload,
        coin_id: coin.id,
        coin_symbol: String(coin.symbol).toUpperCase(),
      });
    }

    return {
      coinId: coin.id,
      coinSymbol: String(coin.symbol).toUpperCase(),
      tradingSymbol: DERIBIT_BTC_DVOL_SYMBOL,
      market: DERIBIT_BTC_DVOL_MARKET,
      fallbackReason: null,
      interval: normalizedInterval,
      fetched: parsedRows.length,
      saved: parsedRows.length,
      skipped: false,
    };
  }

  const binanceSymbol = effectiveMapping?.market === KLINE_MARKETS.BINANCE_USDM_PERPETUAL
    || effectiveMapping?.market === KLINE_MARKETS.BINANCE_SPOT
    ? effectiveMapping.trading_symbol
    : normalizeTradingSymbol(coin.symbol);
  const fetched = await fetchMarketKlinesWithFallback({
    coinSymbol: coin.symbol,
    binanceSymbol,
    klineMapping: effectiveMapping,
    interval: normalizedInterval,
    limit: normalizedLimit,
    startTime,
    endTime,
    includePrePost,
    fetchImpl,
  });

  const parsedRows = fetched.normalizedRows
    ? fetched.rows.map(row => ({
      ...row,
      coin_id: coin.id,
      coin_symbol: String(coin.symbol).toUpperCase(),
    }))
    : fetched.rows.map(row => parseBinanceKlineRow(row, {
      coinId: coin.id,
      coinSymbol: coin.symbol,
      tradingSymbol: fetched.tradingSymbol,
      interval: normalizedInterval,
      market: fetched.market,
    }));

  for (const payload of parsedRows) {
    await CoinKlineModel.upsert(payload);
  }

  if (marketSyncCheck.market) {
    rememberKlineSync(marketSyncCheck.key, now);
  }

  return {
    coinId: coin.id,
    coinSymbol: String(coin.symbol).toUpperCase(),
    tradingSymbol: fetched.tradingSymbol,
    market: fetched.market,
    fallbackReason: fetched.fallbackReason || null,
    interval: normalizedInterval,
    fetched: fetched.rows.length,
    saved: parsedRows.length,
    skipped: false,
    rateLimit: fetched.rows.__rateLimit || null,
  };
}

async function findStoredCoinKlines({
  coinId,
  interval = DEFAULT_INTERVAL,
  limit = DEFAULT_LIMIT,
  market,
  tradingSymbol,
  coinSymbol,
  startTime,
  endTime,
  includePrePost = false,
  CoinKlineModel,
} = {}) {
  if (!CoinKlineModel?.findAll) {
    throw new Error('CoinKline model is required');
  }

  const where = {
    coin_id: coinId,
    interval: normalizeInterval(interval),
  };

  if (market) {
    where.market = market;
  }
  if (tradingSymbol) {
    where.trading_symbol = String(tradingSymbol).trim();
  }
  const yahooFilterSymbol = tradingSymbol || coinSymbol;
  if (
    market === YAHOO_FINANCE_MARKET
    && !includePrePost
    && shouldFilterYahooZeroVolumeRows(yahooFilterSymbol)
  ) {
    where.volume = { [Op.gt]: 0 };
  }

  if (startTime || endTime) {
    where.open_time = {};
    if (startTime) where.open_time[Op.gte] = new Date(toNumber(startTime, 'startTime'));
    if (endTime) where.open_time[Op.lte] = new Date(toNumber(endTime, 'endTime'));
  }

  return CoinKlineModel.findAll({
    where,
    order: [['open_time', 'DESC']],
    limit: normalizeStoredKlineLimit({
      interval,
      limit,
      startTime,
      endTime,
    }),
    raw: true,
  });
}

function getStoredKlineOpenTimeMs(row) {
  const value = row?.open_time;
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function mergePreferredAndYahooKlines({
  preferredRows = [],
  yahooRows = [],
  interval = DEFAULT_INTERVAL,
  limit = DEFAULT_LIMIT,
  startTime,
  endTime,
} = {}) {
  const validPreferredRows = preferredRows.filter(row => getStoredKlineOpenTimeMs(row) !== null);
  const preferredStartTime = validPreferredRows.reduce((earliest, row) => {
    const timestamp = getStoredKlineOpenTimeMs(row);
    return earliest === null || timestamp < earliest ? timestamp : earliest;
  }, null);
  const rowsByOpenTime = new Map();

  yahooRows.forEach(row => {
    const timestamp = getStoredKlineOpenTimeMs(row);
    if (timestamp === null || (preferredStartTime !== null && timestamp >= preferredStartTime)) return;
    rowsByOpenTime.set(timestamp, row);
  });
  validPreferredRows.forEach(row => {
    rowsByOpenTime.set(getStoredKlineOpenTimeMs(row), row);
  });

  return Array.from(rowsByOpenTime.values())
    .sort((left, right) => getStoredKlineOpenTimeMs(right) - getStoredKlineOpenTimeMs(left))
    .slice(0, normalizeStoredKlineLimit({ interval, limit, startTime, endTime }));
}

function serializeCoinKline(row) {
  return {
    openTime: row.open_time instanceof Date ? row.open_time.toISOString() : new Date(row.open_time).toISOString(),
    closeTime: row.close_time instanceof Date ? row.close_time.toISOString() : new Date(row.close_time).toISOString(),
    market: row.market,
    tradingSymbol: row.trading_symbol,
    open: row.open_price,
    high: row.high_price,
    low: row.low_price,
    close: row.close_price,
    volume: row.volume,
    quoteVolume: row.quote_volume,
    tradeCount: row.trade_count,
  };
}

module.exports = {
  YAHOO_FINANCE_CHART_URL,
  YAHOO_FINANCE_SYNC_MIN_INTERVAL_MS,
  BINANCE_USDM_KLINES_URL,
  BINANCE_SPOT_KLINES_URL,
  BINANCE_SPOT_MARKET,
  CHINA_FUTURES_SINA_MARKET,
  CHINA_FUTURES_SINA_JSONP_URL,
  DERIBIT_BTC_DVOL_MARKET,
  DERIBIT_BTC_DVOL_SYMBOL,
  DEFAULT_INTERVAL,
  DEFAULT_LIMIT,
  DEFAULT_MARKET,
  MAX_LIMIT,
  YAHOO_FINANCE_MARKET,
  buildChinaFuturesSinaUrl,
  buildCoinKlineBackfillChunks,
  buildBinanceSpotKlinesUrl,
  buildBinanceUsdmKlinesUrl,
  buildYahooFinanceChartUrl,
  clearYahooSyncCache,
  fetchBinanceSpotKlines,
  fetchBinanceUsdmKlines,
  fetchChinaFuturesSinaKlines,
  fetchDeribitBtcDvolKlines,
  fetchMarketKlinesWithFallback,
  fetchYahooFinanceChart,
  findCoinKlineBackfillGaps,
  findStoredCoinKlines,
  getPreferredKlineMarket,
  mergePreferredAndYahooKlines,
  alignTimestampToIntervalStart,
  normalizeInterval,
  normalizeLimit,
  normalizeTradingSymbol,
  parseBinanceKlineRow,
  parseChinaFuturesSinaKlineRows,
  parseYahooChartResult,
  resolveYahooSymbol,
  shouldRefreshStoredCoinKlines,
  shouldBlendYahooHistory,
  shouldUseYahooFinance,
  serializeCoinKline,
  syncCoinKlines,
};
