const { Op } = require('sequelize');

const BINANCE_USDM_KLINES_URL = 'https://fapi.binance.com/fapi/v1/klines';
const BINANCE_SPOT_KLINES_URL = 'https://api.binance.com/api/v3/klines';
const YAHOO_FINANCE_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const DEFAULT_MARKET = 'binance_usdm_perpetual';
const BINANCE_SPOT_MARKET = 'binance_spot';
const YAHOO_FINANCE_MARKET = 'yahoo_finance';
const DERIBIT_BTC_DVOL_MARKET = 'deribit_btc_dvol';
const DERIBIT_BTC_DVOL_SYMBOL = 'BTC-DVOL';
const DEFAULT_INTERVAL = '1d';
const DEFAULT_LIMIT = 365;
const MAX_LIMIT = 1500;
const YAHOO_FINANCE_SYNC_MIN_INTERVAL_MS = 15 * 60 * 1000;
const { buildBtcVolatilityHistory } = require('./btcVolatility');

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
  BRENT: 'BZ=F',
  BRENT_OIL: 'BZ=F',
  CIRCLE: 'CRCL',
  CN_AI_ETF: '159819.SZ',
  CN_INDEX: '000300.SS',
  CN_ROBOT: '562500.SS',
  ESTATE: 'VNQ',
  GOLD: 'GLD',
  NASDAO: '^IXIC',
  NASDAQ: '^IXIC',
  OIL: 'USO',
  RE: 'VNQ',
  REAL_ESTATE: 'VNQ',
  SILVER: 'SLV',
};

const DERIBIT_BTC_DVOL_COIN_SYMBOLS = new Set(['VEGA']);
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
  const normalized = String(interval || DEFAULT_INTERVAL).trim();
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

function resolveYahooSymbol(symbol) {
  const normalized = String(symbol || '').trim().toUpperCase();
  if (!normalized) {
    throw new Error('Coin symbol is required');
  }
  return YAHOO_SYMBOL_ALIASES[normalized] || normalized;
}

function shouldUseDeribitBtcDvol(symbol) {
  return DERIBIT_BTC_DVOL_COIN_SYMBOLS.has(String(symbol || '').trim().toUpperCase());
}

function shouldUseYahooFinance(symbol) {
  return YAHOO_FINANCE_COIN_SYMBOLS.has(String(symbol || '').trim().toUpperCase());
}

function getPreferredKlineMarket(symbol) {
  if (shouldUseDeribitBtcDvol(symbol)) return DERIBIT_BTC_DVOL_MARKET;
  if (shouldUseYahooFinance(symbol)) return YAHOO_FINANCE_MARKET;
  return null;
}

function normalizeYahooInterval(interval = DEFAULT_INTERVAL) {
  const normalized = normalizeInterval(interval);
  if (normalized === '4h') return '1h';
  if (normalized === '1w') return '1wk';
  if (normalized === '1M') return '1mo';
  return normalized;
}

function normalizeLimit(limit = DEFAULT_LIMIT) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function buildYahooSyncCacheKey({
  coinSymbol,
  interval = DEFAULT_INTERVAL,
  limit = DEFAULT_LIMIT,
  startTime,
  endTime,
} = {}) {
  return [
    String(coinSymbol || '').trim().toUpperCase(),
    normalizeInterval(interval),
    normalizeLimit(limit),
    startTime ? String(toTimestampMs(startTime, 'startTime')) : '',
    endTime ? String(toTimestampMs(endTime, 'endTime')) : '',
  ].join(':');
}

function shouldSkipYahooSync({
  coinSymbol,
  interval = DEFAULT_INTERVAL,
  limit = DEFAULT_LIMIT,
  startTime,
  endTime,
  minSyncIntervalMs = 0,
  now = Date.now(),
} = {}) {
  const minInterval = Number(minSyncIntervalMs);
  if (!shouldUseYahooFinance(coinSymbol) || !Number.isFinite(minInterval) || minInterval <= 0) {
    return { skip: false };
  }

  const key = buildYahooSyncCacheKey({ coinSymbol, interval, limit, startTime, endTime });
  const nowMs = toTimestampMs(now, 'now');
  const lastSyncedAt = yahooSyncCache.get(key);
  if (Number.isFinite(lastSyncedAt) && nowMs - lastSyncedAt < minInterval) {
    return {
      skip: true,
      key,
      lastSyncedAt,
      nextAllowedAt: lastSyncedAt + minInterval,
    };
  }

  return { skip: false, key };
}

function rememberYahooSync(cacheKey, now = Date.now()) {
  if (!cacheKey) return;
  yahooSyncCache.set(cacheKey, toTimestampMs(now, 'now'));
}

function clearYahooSyncCache() {
  yahooSyncCache.clear();
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
  const currentBucketStart = Math.floor(nowMs / intervalMs) * intervalMs;
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
  CoinModel,
  DailyMetricModel,
  CoinKlineModel,
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
  const coins = await CoinModel.findAll({
    attributes: ['id', 'symbol', 'name'],
    order: [['symbol', 'ASC']],
    raw: true,
  });
  const items = [];
  let skippedCovered = 0;
  let skippedNoMetrics = 0;
  let skippedInvalidMetrics = 0;

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

    const metricTimestamp = resolveMetricTimestampMs(metric);
    if (!Number.isFinite(metricTimestamp)) {
      skippedInvalidMetrics += 1;
      continue;
    }

    const startTime = alignTimestampToIntervalStart(metricTimestamp, normalizedInterval);
    const intervalMs = INTERVAL_MS[normalizedInterval];
    const rawLatestMetric = await DailyMetricModel.findOne({
      where: { coin_id: coin.id },
      order: [['date', 'DESC'], ['timestamp', 'DESC'], ['id', 'DESC']],
      raw: true,
    });
    const latestMetric = toPlainRow(rawLatestMetric) || metric;
    const latestMetricTimestamp = resolveMetricTimestampMs(latestMetric);
    const metricEndTime = Number.isFinite(latestMetricTimestamp)
      ? alignTimestampToIntervalStart(latestMetricTimestamp, normalizedInterval) + intervalMs - 1
      : startTime + intervalMs - 1;
    const market = getPreferredKlineMarket(coin.symbol);
    const klineWhere = {
      coin_id: coin.id,
      interval: normalizedInterval,
    };
    if (market) {
      klineWhere.market = market;
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

    if (Number.isFinite(earliestKlineTime) && earliestKlineTime <= startTime) {
      skippedCovered += 1;
      continue;
    }

    items.push({
      coinId: coin.id,
      coinSymbol: String(coin.symbol).toUpperCase(),
      coinName: coin.name || String(coin.symbol).toUpperCase(),
      market: market || null,
      interval: normalizedInterval,
      startTime,
      endTime: Number.isFinite(earliestKlineTime) ? earliestKlineTime - 1 : metricEndTime,
      metricStartTime: startTime,
      earliestKlineTime: Number.isFinite(earliestKlineTime) ? earliestKlineTime : null,
    });
  }

  return {
    interval: normalizedInterval,
    totalCoins: coins.length,
    items,
    skippedCovered,
    skippedNoMetrics,
    skippedInvalidMetrics,
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
    cursor = alignTimestampToIntervalStart(chunkEnd + 1, normalizedInterval);
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
} = {}) {
  const yahooSymbol = resolveYahooSymbol(symbol);
  const params = new URLSearchParams({
    interval: normalizeYahooInterval(interval),
    includePrePost: 'false',
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
  fetchImpl = global.fetch,
} = {}) {
  const url = buildYahooFinanceChartUrl({
    symbol,
    interval,
    startTime,
    endTime,
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
  const intervalMs = INTERVAL_MS[normalizedInterval] || INTERVAL_MS['1d'];
  const resolvedTradingSymbol = tradingSymbol || result?.meta?.symbol || resolveYahooSymbol(coinSymbol);
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
      interval: normalizedInterval,
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

  return rows;
}

async function fetchMarketKlinesWithFallback(options) {
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
  interval = DEFAULT_INTERVAL,
  limit = DEFAULT_LIMIT,
  startTime,
  endTime,
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
  const yahooSyncCheck = shouldSkipYahooSync({
    coinSymbol: coin.symbol,
    interval: normalizedInterval,
    limit: normalizedLimit,
    startTime,
    endTime,
    minSyncIntervalMs,
    now,
  });

  if (!force && yahooSyncCheck.skip) {
    return {
      coinId: coin.id,
      coinSymbol: String(coin.symbol).toUpperCase(),
      tradingSymbol: resolveYahooSymbol(coin.symbol),
      market: YAHOO_FINANCE_MARKET,
      fallbackReason: null,
      interval: normalizedInterval,
      fetched: 0,
      saved: 0,
      skipped: true,
      nextAllowedAt: new Date(yahooSyncCheck.nextAllowedAt).toISOString(),
    };
  }

  if (shouldUseDeribitBtcDvol(coin.symbol)) {
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

  const binanceSymbol = normalizeTradingSymbol(coin.symbol);
  const fetched = await fetchMarketKlinesWithFallback({
    coinSymbol: coin.symbol,
    binanceSymbol,
    interval: normalizedInterval,
    limit: normalizedLimit,
    startTime,
    endTime,
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

  if (shouldUseYahooFinance(coin.symbol)) {
    const cacheKey = yahooSyncCheck.key || buildYahooSyncCacheKey({
      coinSymbol: coin.symbol,
      interval: normalizedInterval,
      limit: normalizedLimit,
      startTime,
      endTime,
    });
    rememberYahooSync(cacheKey, now);
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
  startTime,
  endTime,
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

  if (startTime || endTime) {
    where.open_time = {};
    if (startTime) where.open_time[Op.gte] = new Date(toNumber(startTime, 'startTime'));
    if (endTime) where.open_time[Op.lte] = new Date(toNumber(endTime, 'endTime'));
  }

  return CoinKlineModel.findAll({
    where,
    order: [['open_time', 'DESC']],
    limit: normalizeLimit(limit),
    raw: true,
  });
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
  DERIBIT_BTC_DVOL_MARKET,
  DERIBIT_BTC_DVOL_SYMBOL,
  DEFAULT_INTERVAL,
  DEFAULT_LIMIT,
  DEFAULT_MARKET,
  MAX_LIMIT,
  YAHOO_FINANCE_MARKET,
  buildCoinKlineBackfillChunks,
  buildBinanceSpotKlinesUrl,
  buildBinanceUsdmKlinesUrl,
  buildYahooFinanceChartUrl,
  clearYahooSyncCache,
  fetchBinanceSpotKlines,
  fetchBinanceUsdmKlines,
  fetchDeribitBtcDvolKlines,
  fetchMarketKlinesWithFallback,
  fetchYahooFinanceChart,
  findCoinKlineBackfillGaps,
  findStoredCoinKlines,
  getPreferredKlineMarket,
  alignTimestampToIntervalStart,
  normalizeInterval,
  normalizeLimit,
  normalizeTradingSymbol,
  parseBinanceKlineRow,
  parseYahooChartResult,
  resolveYahooSymbol,
  shouldRefreshStoredCoinKlines,
  shouldUseYahooFinance,
  serializeCoinKline,
  syncCoinKlines,
};
