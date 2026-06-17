const assert = require('assert');

const {
  buildBinanceKlineStreamName,
  buildBinanceKlineStreamUrl,
  buildCoinKlineUpsertPayload,
  parseBinanceKlineStreamMessage,
} = require('../utils/binanceKlineStream');

async function run() {
  assert.strictEqual(
    buildBinanceKlineStreamName({ symbol: 'BTC', interval: '4h' }),
    'btcusdt@kline_4h',
  );
  assert.strictEqual(
    buildBinanceKlineStreamUrl({ symbol: 'BTC', interval: '4h' }),
    'wss://fstream.binance.com/market/ws/btcusdt@kline_4h',
  );

  const parsed = parseBinanceKlineStreamMessage({
    e: 'kline',
    E: 1771420800123,
    s: 'BTCUSDT',
    k: {
      t: 1771420800000,
      T: 1771435199999,
      s: 'BTCUSDT',
      i: '4h',
      o: '81000.10',
      c: '81234.50',
      h: '82000.00',
      l: '80500.25',
      v: '1234.56',
      n: 9876,
      x: true,
      q: '100000000.12',
    },
  });

  assert.deepStrictEqual(parsed, {
    type: 'kline',
    eventTime: '2026-02-18T13:20:00.123Z',
    coinSymbol: 'BTC',
    tradingSymbol: 'BTCUSDT',
    interval: '4h',
    isClosed: true,
    kline: {
      openTime: '2026-02-18T13:20:00.000Z',
      closeTime: '2026-02-18T17:19:59.999Z',
      market: 'binance_usdm_perpetual',
      tradingSymbol: 'BTCUSDT',
      open: 81000.1,
      high: 82000,
      low: 80500.25,
      close: 81234.5,
      volume: 1234.56,
      quoteVolume: 100000000.12,
      tradeCount: 9876,
    },
  });

  assert.deepStrictEqual(buildCoinKlineUpsertPayload(parsed, { id: 7, symbol: 'BTC' }), {
    coin_id: 7,
    coin_symbol: 'BTC',
    trading_symbol: 'BTCUSDT',
    market: 'binance_usdm_perpetual',
    interval: '4h',
    open_time: new Date('2026-02-18T13:20:00.000Z'),
    close_time: new Date('2026-02-18T17:19:59.999Z'),
    open_price: 81000.1,
    high_price: 82000,
    low_price: 80500.25,
    close_price: 81234.5,
    volume: 1234.56,
    quote_volume: 100000000.12,
    trade_count: 9876,
  });

  console.log('klineWebSocket.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
