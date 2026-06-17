const DEFAULT_BINANCE_STREAM_BASE_URL = 'wss://fstream.binance.com/market';
const DEFAULT_MARKET = 'binance_usdm_perpetual';

function normalizeTradingSymbol(symbol) {
  const normalized = String(symbol || '').trim().toUpperCase();
  if (!normalized) {
    throw new Error('Coin symbol is required');
  }
  return normalized.endsWith('USDT') ? normalized : `${normalized}USDT`;
}

function normalizeCoinSymbol(symbol) {
  return normalizeTradingSymbol(symbol).replace(/USDT$/, '');
}

function normalizeInterval(interval = '1d') {
  const normalized = String(interval || '1d').trim();
  if (!normalized) {
    throw new Error('Kline interval is required');
  }
  return normalized;
}

function toNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }
  return number;
}

function toIsoTime(value, fieldName) {
  const date = new Date(toNumber(value, fieldName));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }
  return date.toISOString();
}

function buildBinanceKlineStreamName({ symbol, interval = '1d' } = {}) {
  return `${normalizeTradingSymbol(symbol).toLowerCase()}@kline_${normalizeInterval(interval)}`;
}

function buildBinanceKlineStreamUrl({
  symbol,
  interval = '1d',
  baseUrl = DEFAULT_BINANCE_STREAM_BASE_URL,
} = {}) {
  const normalizedBaseUrl = String(baseUrl || DEFAULT_BINANCE_STREAM_BASE_URL).replace(/\/$/, '');
  return `${normalizedBaseUrl}/ws/${buildBinanceKlineStreamName({ symbol, interval })}`;
}

function parseBinanceKlineStreamMessage(message) {
  const payload = typeof message === 'string' || Buffer.isBuffer(message)
    ? JSON.parse(String(message))
    : message;
  const data = payload?.data || payload;
  const kline = data?.k;

  if (!kline || data?.e !== 'kline') {
    throw new Error('Invalid Binance kline stream payload');
  }

  const tradingSymbol = normalizeTradingSymbol(kline.s || data.s);
  const interval = normalizeInterval(kline.i);

  return {
    type: 'kline',
    eventTime: toIsoTime(data.E, 'eventTime'),
    coinSymbol: normalizeCoinSymbol(tradingSymbol),
    tradingSymbol,
    interval,
    isClosed: Boolean(kline.x),
    kline: {
      openTime: toIsoTime(kline.t, 'openTime'),
      closeTime: toIsoTime(kline.T, 'closeTime'),
      market: DEFAULT_MARKET,
      tradingSymbol,
      open: toNumber(kline.o, 'open'),
      high: toNumber(kline.h, 'high'),
      low: toNumber(kline.l, 'low'),
      close: toNumber(kline.c, 'close'),
      volume: toNumber(kline.v, 'volume'),
      quoteVolume: toNumber(kline.q, 'quoteVolume'),
      tradeCount: Math.trunc(toNumber(kline.n, 'tradeCount')),
    },
  };
}

function buildCoinKlineUpsertPayload(liveMessage, coin) {
  if (!coin?.id || !coin?.symbol) {
    throw new Error('Coin with id and symbol is required');
  }
  const kline = liveMessage?.kline;
  if (!kline) {
    throw new Error('Live kline payload is required');
  }

  return {
    coin_id: coin.id,
    coin_symbol: String(coin.symbol).trim().toUpperCase(),
    trading_symbol: liveMessage.tradingSymbol,
    market: kline.market || DEFAULT_MARKET,
    interval: liveMessage.interval,
    open_time: new Date(kline.openTime),
    close_time: new Date(kline.closeTime),
    open_price: kline.open,
    high_price: kline.high,
    low_price: kline.low,
    close_price: kline.close,
    volume: kline.volume,
    quote_volume: kline.quoteVolume,
    trade_count: kline.tradeCount,
  };
}

module.exports = {
  DEFAULT_BINANCE_STREAM_BASE_URL,
  buildBinanceKlineStreamName,
  buildBinanceKlineStreamUrl,
  buildCoinKlineUpsertPayload,
  parseBinanceKlineStreamMessage,
};
