const assert = require('assert');

const {
  DERIBIT_BTC_DVOL_MARKET,
  DERIBIT_BTC_DVOL_SYMBOL,
  buildBinanceUsdmKlinesUrl,
  buildYahooFinanceChartUrl,
  findStoredCoinKlines,
  getPreferredKlineMarket,
  parseBinanceKlineRow,
  resolveYahooSymbol,
  syncCoinKlines,
} = require('../utils/coinKlines');

async function run() {
  const row = [
    Date.UTC(2026, 0, 1),
    '100.5',
    '111.25',
    '95.75',
    '108.125',
    '1234.5',
    Date.UTC(2026, 0, 1, 23, 59, 59, 999),
    '130000',
    2500,
    '620.2',
    '65500',
    '0',
  ];

  const parsed = parseBinanceKlineRow(row, {
    coinId: 7,
    coinSymbol: 'BTC',
    tradingSymbol: 'BTCUSDT',
    interval: '1d',
  });

  assert.deepStrictEqual(parsed, {
    coin_id: 7,
    coin_symbol: 'BTC',
    trading_symbol: 'BTCUSDT',
    market: 'binance_usdm_perpetual',
    interval: '1d',
    open_time: new Date(Date.UTC(2026, 0, 1)),
    close_time: new Date(Date.UTC(2026, 0, 1, 23, 59, 59, 999)),
    open_price: 100.5,
    high_price: 111.25,
    low_price: 95.75,
    close_price: 108.125,
    volume: 1234.5,
    quote_volume: 130000,
    trade_count: 2500,
  });

  const url = buildBinanceUsdmKlinesUrl({
    symbol: 'ETHUSDT',
    interval: '4h',
    limit: 300,
    startTime: Date.UTC(2026, 0, 1),
    endTime: Date.UTC(2026, 1, 1),
  });

  assert.match(url, /\/fapi\/v1\/klines\?/);
  assert.match(url, /symbol=ETHUSDT/);
  assert.match(url, /interval=4h/);
  assert.match(url, /limit=300/);
  assert.match(url, /startTime=1767225600000/);
  assert.match(url, /endTime=1769904000000/);

  const maxLimitUrl = buildBinanceUsdmKlinesUrl({
    symbol: 'BTC',
    interval: '4h',
    limit: 9999,
  });
  assert.match(maxLimitUrl, /limit=1500/);

  const upserted = [];
  const fakeModel = {
    async upsert(payload) {
      upserted.push(payload);
    },
  };
  const fetchImpl = async () => ({
    ok: true,
    json: async () => [row],
  });

  const result = await syncCoinKlines({
    coin: { id: 7, symbol: 'BTC' },
    interval: '1d',
    limit: 1,
    fetchImpl,
    CoinKlineModel: fakeModel,
  });

  assert.strictEqual(result.saved, 1);
  assert.strictEqual(result.tradingSymbol, 'BTCUSDT');
  assert.strictEqual(upserted.length, 1);
  assert.strictEqual(upserted[0].open_price, 100.5);
  assert.strictEqual(upserted[0].close_price, 108.125);

  const fallbackUrls = [];
  const spotUpserted = [];
  const spotModel = {
    async upsert(payload) {
      spotUpserted.push(payload);
    },
  };
  const fallbackFetchImpl = async (url) => {
    fallbackUrls.push(String(url));
    if (String(url).includes('/fapi/')) {
      return {
        ok: false,
        text: async () => '{"code":-1121,"msg":"Invalid symbol."}',
      };
    }
    return {
      ok: true,
      json: async () => [row],
    };
  };

  const fallbackResult = await syncCoinKlines({
    coin: { id: 8, symbol: 'AIOZ' },
    interval: '1d',
    limit: 1,
    fetchImpl: fallbackFetchImpl,
    CoinKlineModel: spotModel,
  });

  assert.strictEqual(fallbackResult.market, 'binance_spot');
  assert.match(fallbackUrls[0], /fapi\/v1\/klines/);
  assert.match(fallbackUrls[1], /api\/v3\/klines/);
  assert.strictEqual(spotUpserted[0].market, 'binance_spot');

  assert.strictEqual(resolveYahooSymbol('CIRCLE'), 'CRCL');
  assert.strictEqual(resolveYahooSymbol('NASDAQ'), '^IXIC');
  assert.strictEqual(resolveYahooSymbol('CN_AI_ETF'), '159819.SZ');
  assert.strictEqual(resolveYahooSymbol('CN_INDEX'), '000300.SS');
  assert.strictEqual(resolveYahooSymbol('CN_ROBOT'), '562500.SS');
  assert.strictEqual(getPreferredKlineMarket('VEGA'), DERIBIT_BTC_DVOL_MARKET);
  assert.strictEqual(getPreferredKlineMarket('BTC'), null);
  const yahooUrl = buildYahooFinanceChartUrl({ symbol: 'CRCL', interval: '1d', range: '1y' });
  assert.match(yahooUrl, /query1\.finance\.yahoo\.com\/v8\/finance\/chart\/CRCL/);
  assert.match(yahooUrl, /interval=1d/);
  assert.match(yahooUrl, /range=1y/);

  const yahooUrls = [];
  const yahooUpserted = [];
  const yahooModel = {
    async upsert(payload) {
      yahooUpserted.push(payload);
    },
  };
  const yahooFetchImpl = async (url) => {
    yahooUrls.push(String(url));
    if (String(url).includes('/fapi/') || String(url).includes('/api/v3/')) {
      return {
        ok: false,
        text: async () => '{"code":-1121,"msg":"Invalid symbol."}',
      };
    }
    return {
      ok: true,
      json: async () => ({
        chart: {
          result: [{
            meta: { symbol: 'CRCL' },
            timestamp: [Date.UTC(2026, 0, 2) / 1000],
            indicators: {
              quote: [{
                open: [70],
                high: [74],
                low: [66],
                close: [72],
                volume: [987654],
              }],
            },
          }],
          error: null,
        },
      }),
    };
  };

  const yahooResult = await syncCoinKlines({
    coin: { id: 9, symbol: 'CIRCLE' },
    interval: '1d',
    limit: 1,
    fetchImpl: yahooFetchImpl,
    CoinKlineModel: yahooModel,
  });

  assert.strictEqual(yahooResult.market, 'yahoo_finance');
  assert.strictEqual(yahooResult.tradingSymbol, 'CRCL');
  assert.match(yahooUrls[2], /finance\/chart\/CRCL/);
  assert.strictEqual(yahooUpserted.length, 1);
  assert.strictEqual(yahooUpserted[0].market, 'yahoo_finance');
  assert.strictEqual(yahooUpserted[0].trading_symbol, 'CRCL');
  assert.strictEqual(yahooUpserted[0].close_price, 72);

  const dvolUrls = [];
  const dvolUpserted = [];
  const dvolModel = {
    async upsert(payload) {
      dvolUpserted.push(payload);
    },
  };
  const dvolFetchImpl = async (url) => {
    dvolUrls.push(String(url));
    return {
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        result: {
          data: [
            [Date.UTC(2026, 0, 2, 0), 36, 38, 35, 37],
            [Date.UTC(2026, 0, 2, 1), 37, 39, 36, 38],
          ],
        },
      }),
    };
  };

  const dvolResult = await syncCoinKlines({
    coin: { id: 10, symbol: 'VEGA' },
    interval: '1h',
    limit: 2,
    fetchImpl: dvolFetchImpl,
    CoinKlineModel: dvolModel,
  });

  assert.strictEqual(dvolResult.market, DERIBIT_BTC_DVOL_MARKET);
  assert.strictEqual(dvolResult.tradingSymbol, DERIBIT_BTC_DVOL_SYMBOL);
  assert.match(dvolUrls[0], /deribit\.com\/api\/v2\/public\/get_volatility_index_data/);
  assert.match(dvolUrls[0], /currency=BTC/);
  assert.strictEqual(dvolUpserted.length, 2);
  assert.strictEqual(dvolUpserted[0].coin_symbol, 'VEGA');
  assert.strictEqual(dvolUpserted[0].market, DERIBIT_BTC_DVOL_MARKET);
  assert.strictEqual(dvolUpserted[0].trading_symbol, DERIBIT_BTC_DVOL_SYMBOL);
  assert.strictEqual(dvolUpserted[1].close_price, 38);

  let storedWhere = null;
  await findStoredCoinKlines({
    coinId: 10,
    interval: '1h',
    market: DERIBIT_BTC_DVOL_MARKET,
    limit: 2,
    CoinKlineModel: {
      async findAll(options) {
        storedWhere = options.where;
        return [];
      },
    },
  });
  assert.strictEqual(storedWhere.market, DERIBIT_BTC_DVOL_MARKET);

  console.log('coinKlines.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
