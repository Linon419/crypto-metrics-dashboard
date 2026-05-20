const BINANCE_USDM_KLINES_URL = 'https://fapi.binance.com/fapi/v1/klines';
const DEFAULT_SYMBOL = 'BTCUSDT';
const ONE_MINUTE_MS = 60 * 1000;

function toTimestampMs(value) {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  return timestamp;
}

function floorToMinuteMs(value) {
  return Math.floor(toTimestampMs(value) / ONE_MINUTE_MS) * ONE_MINUTE_MS;
}

function parseKline(kline) {
  if (!Array.isArray(kline) || kline.length < 7) {
    throw new Error('Invalid Binance kline payload');
  }

  const openTime = Number(kline[0]);
  const closePrice = Number(kline[4]);
  const closeTime = Number(kline[6]);

  if (!Number.isFinite(openTime) || !Number.isFinite(closePrice) || !Number.isFinite(closeTime)) {
    throw new Error('Binance kline payload contains invalid numeric fields');
  }

  return {
    kline_open_time: new Date(openTime),
    kline_close_time: new Date(closeTime),
    close_price: closePrice,
  };
}

function buildKlineUrl({ symbol = DEFAULT_SYMBOL, timestamp }) {
  const startTime = floorToMinuteMs(timestamp);
  const params = new URLSearchParams({
    symbol,
    interval: '1m',
    startTime: String(startTime),
    endTime: String(startTime + ONE_MINUTE_MS),
    limit: '1',
  });

  return `${BINANCE_USDM_KLINES_URL}?${params.toString()}`;
}

async function fetchBinanceUsdmPerpetualMinuteClose({
  symbol = DEFAULT_SYMBOL,
  timestamp,
  fetchImpl = global.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable in this Node runtime');
  }

  const url = buildKlineUrl({ symbol, timestamp });
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'crypto-metrics-dashboard/0.1',
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Binance futures kline request failed: ${response.status} ${body}`.trim());
  }

  const payload = await response.json();
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error('Binance futures kline response is empty');
  }

  return {
    symbol,
    market: 'binance_usdm_perpetual',
    published_at: new Date(toTimestampMs(timestamp)),
    ...parseKline(payload[0]),
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  BINANCE_USDM_KLINES_URL,
  DEFAULT_SYMBOL,
  buildKlineUrl,
  fetchBinanceUsdmPerpetualMinuteClose,
  floorToMinuteMs,
  parseKline,
  sleep,
};
