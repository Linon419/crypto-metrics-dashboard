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

function getPreferredKlineMarket(symbol) {
  return shouldUseDeribitBtcDvol(symbol) ? DERIBIT_BTC_DVOL_MARKET : null;
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

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${errorPrefix}: ${response.status} ${body}`.trim());
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error(`${errorPrefix}: invalid response`);
  }
  return payload;
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
  try {
    const rows = await fetchBinanceUsdmKlines({
      ...options,
      symbol: options.binanceSymbol,
    });
    return { rows, market: DEFAULT_MARKET, tradingSymbol: options.binanceSymbol };
  } catch (futuresError) {
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
  if (shouldUseDeribitBtcDvol(coin.symbol)) {
    const parsedRows = await fetchDeribitBtcDvolKlines({
      interval: normalizedInterval,
      limit,
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
    };
  }

  const binanceSymbol = normalizeTradingSymbol(coin.symbol);
  const fetched = await fetchMarketKlinesWithFallback({
    coinSymbol: coin.symbol,
    binanceSymbol,
    interval: normalizedInterval,
    limit,
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

  return {
    coinId: coin.id,
    coinSymbol: String(coin.symbol).toUpperCase(),
    tradingSymbol: fetched.tradingSymbol,
    market: fetched.market,
    fallbackReason: fetched.fallbackReason || null,
    interval: normalizedInterval,
    fetched: fetched.rows.length,
    saved: parsedRows.length,
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
  BINANCE_USDM_KLINES_URL,
  BINANCE_SPOT_KLINES_URL,
  BINANCE_SPOT_MARKET,
  DERIBIT_BTC_DVOL_MARKET,
  DERIBIT_BTC_DVOL_SYMBOL,
  DEFAULT_INTERVAL,
  DEFAULT_LIMIT,
  DEFAULT_MARKET,
  YAHOO_FINANCE_MARKET,
  buildBinanceSpotKlinesUrl,
  buildBinanceUsdmKlinesUrl,
  buildYahooFinanceChartUrl,
  fetchBinanceSpotKlines,
  fetchBinanceUsdmKlines,
  fetchDeribitBtcDvolKlines,
  fetchMarketKlinesWithFallback,
  fetchYahooFinanceChart,
  findStoredCoinKlines,
  getPreferredKlineMarket,
  normalizeInterval,
  normalizeLimit,
  normalizeTradingSymbol,
  parseBinanceKlineRow,
  parseYahooChartResult,
  resolveYahooSymbol,
  serializeCoinKline,
  syncCoinKlines,
};
