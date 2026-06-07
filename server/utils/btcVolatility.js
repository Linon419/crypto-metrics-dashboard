const BINANCE_USDM_KLINES_URL = 'https://fapi.binance.com/fapi/v1/klines';
const DERIBIT_API_URL = 'https://www.deribit.com/api/v2/public/get_volatility_index_data';
const DEFAULT_ATR_PERIOD = 14;
const ONE_HOUR_MS = 60 * 60 * 1000;

function toNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }
  return number;
}

function parseBinanceDailyKline(kline) {
  if (!Array.isArray(kline) || kline.length < 7) {
    throw new Error('Invalid Binance daily kline payload');
  }

  return {
    openTime: new Date(toNumber(kline[0], 'openTime')),
    open: toNumber(kline[1], 'open'),
    high: toNumber(kline[2], 'high'),
    low: toNumber(kline[3], 'low'),
    close: toNumber(kline[4], 'close'),
    closeTime: new Date(toNumber(kline[6], 'closeTime')),
  };
}

function calculateTrueRange(kline, previousClose) {
  return Math.max(
    kline.high - kline.low,
    Math.abs(kline.high - previousClose),
    Math.abs(kline.low - previousClose)
  );
}

function calculateAtr(klines, period = DEFAULT_ATR_PERIOD) {
  if (!Array.isArray(klines) || klines.length < period + 1) {
    throw new Error(`At least ${period + 1} daily klines are required to calculate ATR(${period})`);
  }

  const recent = klines.slice(-(period + 1));
  const trueRanges = [];

  for (let index = 1; index < recent.length; index += 1) {
    trueRanges.push(calculateTrueRange(recent[index], recent[index - 1].close));
  }

  const sum = trueRanges.reduce((total, value) => total + value, 0);
  return sum / period;
}

function calculateDailyRv({ atr, currentPrice }) {
  if (!Number.isFinite(atr) || atr <= 0) {
    throw new Error(`Invalid ATR: ${atr}`);
  }
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    throw new Error(`Invalid current price: ${currentPrice}`);
  }

  return atr / currentPrice;
}

function calculateDailyIvFromDvol(dvolAnnualizedPercent) {
  const dvol = toNumber(dvolAnnualizedPercent, 'DVOL');
  if (dvol <= 0) {
    throw new Error(`Invalid DVOL: ${dvolAnnualizedPercent}`);
  }

  return (dvol / 100) / Math.sqrt(365);
}

function classifyVolatilityComparison({ dailyRv, dailyIv }) {
  if (!Number.isFinite(dailyRv) || !Number.isFinite(dailyIv) || dailyRv <= 0 || dailyIv <= 0) {
    return {
      label: '数据不足',
      bias: 'neutral',
      spread: null,
      ratio: null,
    };
  }

  const spread = dailyIv - dailyRv;
  const ratio = dailyIv / dailyRv;

  if (ratio >= 1.1) {
    return { label: 'IV溢价', bias: 'iv_premium', spread, ratio };
  }
  if (ratio <= 0.9) {
    return { label: 'RV高于IV', bias: 'rv_premium', spread, ratio };
  }
  return { label: '接近', bias: 'balanced', spread, ratio };
}

function buildBinanceDailyKlinesUrl({ symbol = 'BTCUSDT', limit = DEFAULT_ATR_PERIOD + 1 } = {}) {
  const params = new URLSearchParams({
    symbol,
    interval: '1d',
    limit: String(limit),
  });

  return `${BINANCE_USDM_KLINES_URL}?${params.toString()}`;
}

function buildDeribitDvolUrl({ currency = 'BTC', lookbackHours = 6, now = Date.now() } = {}) {
  const params = new URLSearchParams({
    currency,
    start_timestamp: String(now - lookbackHours * ONE_HOUR_MS),
    end_timestamp: String(now),
    resolution: '60',
  });

  return `${DERIBIT_API_URL}?${params.toString()}`;
}

async function fetchJson(url, fetchImpl) {
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
    throw new Error(`Market data request failed: ${response.status} ${body}`.trim());
  }

  return response.json();
}

async function fetchBinanceDailyKlines({ symbol = 'BTCUSDT', period = DEFAULT_ATR_PERIOD, fetchImpl = global.fetch } = {}) {
  const url = buildBinanceDailyKlinesUrl({ symbol, limit: period + 1 });
  const payload = await fetchJson(url, fetchImpl);
  if (!Array.isArray(payload) || payload.length < period + 1) {
    throw new Error('Binance daily kline response does not contain enough rows');
  }

  return payload.map(parseBinanceDailyKline);
}

async function fetchDeribitDvol({ currency = 'BTC', fetchImpl = global.fetch, now = Date.now() } = {}) {
  const url = buildDeribitDvolUrl({ currency, now });
  const payload = await fetchJson(url, fetchImpl);
  const rows = payload?.result?.data;

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Deribit DVOL response is empty');
  }

  const latest = rows[rows.length - 1];
  return parseDeribitDvolCandle(latest);
}

function parseDeribitDvolCandle(row) {
  if (!Array.isArray(row) || row.length < 5) {
    throw new Error('Invalid Deribit DVOL candle payload');
  }

  return {
    timestamp: new Date(toNumber(row[0], 'dvolTimestamp')).toISOString(),
    open: toNumber(row[1], 'dvolOpen'),
    high: toNumber(row[2], 'dvolHigh'),
    low: toNumber(row[3], 'dvolLow'),
    close: toNumber(row[4], 'dvolClose'),
  };
}

async function fetchDeribitDvolCandles({
  currency = 'BTC',
  fetchImpl = global.fetch,
  lookbackHours = 24 * 30,
  now = Date.now(),
  resolution = '60',
} = {}) {
  const params = new URLSearchParams({
    currency,
    start_timestamp: String(now - lookbackHours * ONE_HOUR_MS),
    end_timestamp: String(now),
    resolution: String(resolution),
  });
  const url = `${DERIBIT_API_URL}?${params.toString()}`;
  const payload = await fetchJson(url, fetchImpl);
  const rows = payload?.result?.data;

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Deribit DVOL history response is empty');
  }

  return rows.map(parseDeribitDvolCandle);
}

async function buildBtcVolatilityHistory({
  fetchImpl = global.fetch,
  lookbackHours = 24 * 30,
  now = Date.now(),
  resolution = '60',
} = {}) {
  const candles = await fetchDeribitDvolCandles({
    fetchImpl,
    lookbackHours,
    now,
    resolution,
  });

  return {
    symbol: 'BTC',
    source: 'Deribit BTC DVOL',
    resolution: String(resolution),
    lookbackHours,
    candles,
    timestamps: {
      generatedAt: new Date(now).toISOString(),
      firstCandleAt: candles[0]?.timestamp || null,
      lastCandleAt: candles[candles.length - 1]?.timestamp || null,
    },
  };
}

async function buildBtcVolatilitySnapshot({ fetchImpl = global.fetch, period = DEFAULT_ATR_PERIOD, now = Date.now() } = {}) {
  const [klines, dvol] = await Promise.all([
    fetchBinanceDailyKlines({ period, fetchImpl }),
    fetchDeribitDvol({ fetchImpl, now }),
  ]);

  const atr = calculateAtr(klines, period);
  const latestKline = klines[klines.length - 1];
  const currentPrice = latestKline.close;
  const dailyRv = calculateDailyRv({ atr, currentPrice });
  const dailyIv = calculateDailyIvFromDvol(dvol.close);
  const comparison = classifyVolatilityComparison({ dailyRv, dailyIv });

  return {
    symbol: 'BTC',
    period,
    currentPrice,
    atr,
    dailyRv,
    dvolAnnualizedPercent: dvol.close,
    dailyIv,
    comparison,
    sources: {
      rv: 'Binance USD-M BTCUSDT 1d klines',
      iv: 'Deribit BTC DVOL',
    },
    timestamps: {
      generatedAt: new Date(now).toISOString(),
      latestKlineOpenTime: latestKline.openTime.toISOString(),
      latestKlineCloseTime: latestKline.closeTime.toISOString(),
      dvolTimestamp: dvol.timestamp,
    },
  };
}

module.exports = {
  BINANCE_USDM_KLINES_URL,
  DERIBIT_API_URL,
  DEFAULT_ATR_PERIOD,
  buildBinanceDailyKlinesUrl,
  buildBtcVolatilityHistory,
  buildBtcVolatilitySnapshot,
  buildDeribitDvolUrl,
  calculateAtr,
  calculateDailyIvFromDvol,
  calculateDailyRv,
  calculateTrueRange,
  classifyVolatilityComparison,
  fetchBinanceDailyKlines,
  fetchDeribitDvol,
  fetchDeribitDvolCandles,
  parseBinanceDailyKline,
  parseDeribitDvolCandle,
};
